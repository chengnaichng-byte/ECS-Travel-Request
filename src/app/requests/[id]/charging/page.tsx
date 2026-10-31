// TR-09 Charging & Allocation — ECS-format (§17). Estimated cost lines are shown first;
// charging then uses the ECS cascade (Company Code → Business Area → CC/WBS → Account) with
// an optional cost allocation (at claim level or per expense item) and computed Accounting
// Entries. Reuses ECS charging masters and the traveller's profile default account. The
// effective split is persisted to ChargingAllocation, which drives approval routing (§13.14).
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { loadRequest, type FullRequest } from '@/modules/pretrip/queries';
import { saveCharging, setUpgradeDeltaAccount, deleteExpense } from '@/modules/pretrip/actions';
import { getSettings } from '@/modules/pretrip/settings';
import { currentPersonaId } from '@/shared/session';
import { canEditRequest } from '@/modules/pretrip/guards';
import { chargingCodes, companyCodes, businessAreas } from '@/data/charging';
import { expenseTypes } from '@/data/expenseTypes';
import { EcsReference, EcsIdentity } from '@/shared/ecs/services';
import { memberName, isNonEmployeeMember, isStudentMember } from '@/modules/pretrip/traveller';
const memberTag = (t: { travellerType?: string | null; employeeId: string }, sep: string) => isStudentMember(t) ? `${sep}student` : (isNonEmployeeMember(t) ? `${sep}guest` : '');
import { computeSummary, fmtSgd } from '@/modules/pretrip/pricing';
import { airfareUpgrade } from '@/modules/pretrip/upgrade';
import { listUpgradeAccounts, accountsForBA, effectiveDeltaCode } from '@/modules/pretrip/upgradeConfig';
import { EXPENSE_CATEGORY } from '@/shared/enums';
import { CostItems } from '@/components/ReviewSections';
import { EstimateLineEditor } from '@/components/EstimateLineEditor';
import { makeOutcomeFor } from '@/modules/pretrip/liveOutcome';
import { ChargingAccountEditor, type AccountOpt, type CostLineX } from '@/components/ChargingAccountEditor';
import { UpgradeDeltaPicker, type UpgradePickLine } from '@/components/UpgradeDeltaPicker';
import { Card, Stepper, Empty } from '@/components/ui';
import { DuplicateWarning } from '@/components/DuplicateWarning';

export const dynamic = 'force-dynamic';

export default async function ChargingStep({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ edit?: string }> }) {
  const { id } = await params;
  const { edit } = await searchParams;
  const req = await loadRequest(id);
  if (!req) notFound();
  const settings = await getSettings();
  const canEdit = canEditRequest(await currentPersonaId(), req);
  const summary = computeSummary(req.expenses, settings.approvalAmountBasis);
  // ?edit=<lineId> opens that manual line's edit form inline (returns to this Charging step on save).
  const editExp = canEdit && edit ? req.expenses.find((e) => e.id === edit && !e.autoDerived) ?? null : null;

  // #14 travel-class upgrade split — the entitlement is derived (Model B); the NTU-funded differential
  // routes to a traveller-selected M6 account from the governing BA's pool.
  const mainAllocRow = req.allocations.find((a) => a.isMain) ?? req.allocations[0];
  const mainCode = mainAllocRow?.chargingCode ?? null;
  const govBA = mainAllocRow?.businessArea ?? null;
  const upgradeAccounts = await listUpgradeAccounts();
  const m6Pool = accountsForBA(upgradeAccounts, govBA);
  const govBAName = businessAreas.find((b) => b.code === govBA)?.name ?? govBA ?? '—';
  const upgradeLines = req.expenses
    .filter((e) => e.category === EXPENSE_CATEGORY.Airfare)
    .map((e) => ({ e, u: airfareUpgrade({ sgdAmount: e.sgdAmount, entitlementFareSgd: e.entitlementFareSgd, upgradeFunding: e.upgradeFunding, upgradeDeltaCode: e.upgradeDeltaCode }) }))
    .filter((x) => x.u.isUpgrade);
  // #14 the NTU-funded upgrade lines needing an M6 account selection (self-funded deltas never charge NTU).
  const m6PickLines: UpgradePickLine[] = upgradeLines
    .filter((x) => x.u.funding === 'NTU')
    .map(({ e, u }) => ({
      expenseId: e.id,
      route: `${e.originCode ?? ''} → ${e.destCode ?? ''}`,
      fromClassName: EcsReference.travelClass('TC-ECO')?.name ?? 'Economy',
      toClassName: EcsReference.travelClass(e.proposedClassId ?? '')?.name ?? '',
      fareSgd: u.fareSgd, entitlementSgd: u.entitlementSgd, deltaSgd: u.deltaSgd, upliftPct: u.upliftPct,
      currentCode: e.upgradeDeltaCode ?? null,
    }));

  const defaultAccount = EcsIdentity.employee(req.travellerId)?.defaultChargingCode ?? EcsIdentity.employee(req.requestorId)?.defaultChargingCode ?? chargingCodes[0]?.code ?? '';
  // §8 a guest member has no Workday department — their share is charged to the host's
  // (requestor's) department cost object.
  const hostChargingCode = EcsIdentity.employee(req.requestorId)?.defaultChargingCode ?? defaultAccount;
  const memberKeyLabel = (key: string | null) => {
    const t = req.travellers.find((x) => x.employeeId === key);
    return t ? memberName(t) + memberTag(t, ' · ') : (EcsIdentity.employee(key ?? '')?.name ?? '—');
  };
  const accounts: AccountOpt[] = chargingCodes.map((c) => ({
    code: c.code, name: c.name, type: c.type, companyCode: c.companyCode, businessArea: c.businessArea,
    research: c.isResearch, crossCharge: !!c.crossCharge, closed: c.active === false,
  }));
  const etOpts = expenseTypes.map((e) => ({ id: e.id, name: e.name, gl: e.glAccount, gst: e.gstCode }));
  // §17 auto-by-department preset for a line: map each attributed traveller's share to their
  // home-department (Workday) default cost centre, aggregated by account.
  // §8 guests carry no share of a shared line — exclude them from both an explicit shareMap
  // and the equal-split fallback, so a shared incidental only charges employee departments.
  const guestIds = new Set(req.travellers.filter(isNonEmployeeMember).map((t) => t.employeeId));
  const sharers = req.travellers.filter((t) => !guestIds.has(t.employeeId));
  const deptAllocsFor = (e: FullRequest['expenses'][number]): { code: string; pct: number }[] => {
    let shares: { eid: string; pct: number }[] = [];
    if (e.isShared) {
      let sm: Record<string, number> = {};
      try { sm = e.shareMap ? JSON.parse(e.shareMap) : {}; } catch { sm = {}; }
      const entries = Object.entries(sm).filter(([eid]) => !guestIds.has(eid));
      shares = entries.length
        ? entries.map(([eid, pct]) => ({ eid, pct: Number(pct) }))
        : sharers.map((t) => ({ eid: t.employeeId, pct: 100 / (sharers.length || 1) }));
    } else if (e.travellerId) {
      shares = [{ eid: e.travellerId, pct: 100 }];
    } else {
      shares = [{ eid: req.travellerId, pct: 100 }];
    }
    const byCode = new Map<string, number>();
    for (const sh of shares) { const cc = EcsIdentity.employee(sh.eid)?.defaultChargingCode ?? hostChargingCode; if (cc) byCode.set(cc, (byCode.get(cc) ?? 0) + sh.pct); }
    return [...byCode.entries()].map(([code, pct]) => ({ code, pct: Math.round(pct * 10) / 10 }));
  };
  const initialAllocsFor = (e: FullRequest['expenses'][number]): { code: string; pct: number; io: string }[] | undefined => {
    if (e.allocJson) { try { const a = JSON.parse(e.allocJson); if (Array.isArray(a) && a.length) return a.map((x: { code: string; pct: number; io?: string }) => ({ code: x.code, pct: Number(x.pct), io: x.io || '' })); } catch { /* ignore */ } }
    if (e.chargingCode) return [{ code: e.chargingCode, pct: 100, io: '' }];
    return undefined;
  };
  const lines: CostLineX[] = req.expenses.map((e) => {
    // #14/#7 travel-class upgrade on the airfare line: NTU is charged the full fare (NTU-funded) or the
    // entitlement only (self-funded); an NTU-funded delta is routed to the fixed M6 cost centre below.
    const up = e.category === EXPENSE_CATEGORY.Airfare
      ? airfareUpgrade({ sgdAmount: e.sgdAmount, entitlementFareSgd: e.entitlementFareSgd, upgradeFunding: e.upgradeFunding, upgradeDeltaCode: e.upgradeDeltaCode })
      : null;
    const ntuGross = up?.isUpgrade ? up.ntuAirfareSgd : e.sgdAmount;
    const deltaToM6 = up?.isUpgrade && up.funding === 'NTU' ? up.deltaSgd : 0;
    // the differential charges the selected M6 account, or the auto-resolved one (single-account BA);
    // null when a choice is still required (the picker above prompts it and policy hard-stops).
    const deltaCode = deltaToM6 ? effectiveDeltaCode(upgradeAccounts, govBA, settings.upgradeDeltaSelectionRequired, e.upgradeDeltaCode) : null;
    return {
      id: e.id, typeId: e.expenseTypeId,
      typeName: EcsReference.expenseType(e.expenseTypeId)?.name ?? e.category,
      net: Math.max(ntuGross - e.sponsorSgd, 0),
      category: e.category,
      travellerName: e.travellerId ? memberKeyLabel(e.travellerId) : undefined,
      isShared: e.isShared,
      deptAllocs: deptAllocsFor(e),
      initialAllocs: initialAllocsFor(e),
      upgradeDeltaSgd: deltaToM6 && deltaCode ? deltaToM6 : undefined,
      upgradeDeltaCode: deltaCode ?? undefined,
    };
  });

  // Derive the editor's initial mode from the stored chargingMode (migrating old values).
  const stored = req.chargingMode;
  const initialMode: 'MAIN' | 'CLAIM' | 'ITEM' =
    stored === 'ITEM' || stored === 'LINE' ? 'ITEM'
    : stored === 'CLAIM' ? 'CLAIM'
    : stored === 'MAIN' ? 'MAIN'
    : req.allocations.length > 1 ? 'CLAIM' : 'MAIN';
  const mainAlloc = req.allocations.find((a) => a.isMain) ?? req.allocations[0];
  const initialMain = mainAlloc?.chargingCode ?? defaultAccount;
  const initialRows = req.allocations.map((a) => ({ ba: a.businessArea ?? '', code: a.chargingCode, io: a.internalOrder ?? '', pct: a.percent }));
  const initialLineMap: Record<string, string> = {};
  for (const e of req.expenses) if (e.chargingCode) initialLineMap[e.id] = e.chargingCode;

  // Live policy outcome (airfare above entitlement; accommodation above cap) — same as the Estimates step.
  const outcomeFor = makeOutcomeFor(req);
  // Edit / Remove per manual cost line, shown in each row's expanded breakdown. Edit opens the line
  // on the Estimates step (where the add/edit forms live); Remove deletes it here. Auto lines (the
  // per-stop hotel and ODA) are policy-derived from the trip and carry no Edit/Remove.
  const lineActions = (e: FullRequest['expenses'][number]) => {
    if (!canEdit || e.autoDerived) return null;
    return (
      <span className="inline-flex items-center gap-1">
        <Link href={`/requests/${id}/charging?edit=${e.id}#edit-line`} className="btn-ghost text-xs">Edit</Link>
        <form action={deleteExpense.bind(null, id, e.id)}><button className="btn-ghost text-xs">Remove</button></form>
      </span>
    );
  };

  return (
    <div>
      <Stepper id={id} active="charging" requestNumber={req.requestNumber} status={req.status} />
      {!canEdit && <div className="card p-3 mb-4 text-sm text-amber-900 bg-amber-50 border-amber-200">Read-only view — your role cannot edit this request&apos;s charging.</div>}
      <DuplicateWarning req={req} />

      {upgradeLines.length > 0 && (
        <Card title="M6 — entitlement differential (charging split, §13.19)" className="mb-5">
          <p className="text-xs text-[var(--ecs-muted)] mb-3">The traveller flies their entitlement. Because their <b>travel-policy group attracts M6</b>, the entitled fare splits into an <b>Economy base</b> (charged to the original WBS / cost centre) and an <b>M6 entitlement differential</b> — the Economy&nbsp;→&nbsp;entitled-class portion, derived from the uplift&nbsp;% master and charged to an M6 account for the governing business area. This is automatic, not a travel-class upgrade. With cross-charging, the amount distributed across the allocation is the total less the M6 differential.</p>
          <div className="space-y-4">
            {upgradeLines.map(({ e, u }) => (
              <div key={e.id} className="text-sm">
                <div className="font-medium mb-1">{e.originCode} → {e.destCode} · {EcsReference.travelClass(e.proposedClassId ?? '')?.name ?? ''}
                  <span className="text-[var(--ecs-muted)] font-normal"> — entitled fare {fmtSgd(u.fareSgd)}, Economy base {fmtSgd(u.entitlementSgd)}, M6 differential {fmtSgd(u.deltaSgd)}{u.upliftPct != null ? ` · ${Math.round(u.upliftPct * 100)}% uplift (Economy → ${EcsReference.travelClass(e.proposedClassId ?? '')?.name ?? 'entitled'})` : ''}</span>
                </div>
                <table className="w-full text-sm">
                  <tbody>
                    <tr className="border-t border-[var(--ecs-border)]">
                      <td className="td">Economy base</td>
                      <td className="td text-right tabular-nums">{fmtSgd(u.entitlementSgd)}</td>
                      <td className="td">→ original WBS / cost centre{mainCode ? ` (${chargingCodes.find((c) => c.code === mainCode)?.name ?? mainCode})` : ' (per the allocation below)'}</td>
                    </tr>
                    <tr className="border-t border-[var(--ecs-border)]">
                      <td className="td">M6 entitlement differential</td>
                      <td className="td text-right tabular-nums">{fmtSgd(u.deltaSgd)}</td>
                      <td className="td">→ M6 account {u.deltaCostCentre ? <strong>{u.deltaCostCentre}</strong> : <em>select below</em>} <span className="pill-info ml-1">funded from M6</span></td>
                    </tr>
                  </tbody>
                </table>
              </div>
            ))}
          </div>
          {settings.upgradeDeltaRoutingEnabled && m6PickLines.length > 0 && (
            <div className="mt-4 border-t border-[var(--ecs-border)] pt-4">
              <h4 className="text-sm font-semibold text-[var(--ecs-navy)] mb-2">M6 differential account — {govBAName}</h4>
              {m6Pool.length === 0 ? (
                <p className="text-sm text-amber-700">No active M6 account is configured for business area {govBA ?? '—'}. Add one in <Link className="underline" href="/setup/upgrade-accounts">Setup → M6 Accounts</Link>.</p>
              ) : (
                <UpgradeDeltaPicker requestId={id} lines={m6PickLines} pool={m6Pool.map((a) => ({ code: a.code, name: a.name }))} canEdit={canEdit} govBAName={govBAName} action={setUpgradeDeltaAccount} />
              )}
            </div>
          )}
        </Card>
      )}

      {editExp && <EstimateLineEditor req={req} editExp={editExp} id={id} returnTo={`/requests/${id}/charging`} />}

      {/* Estimated cost lines — the same expandable cost-items table as the Estimates & Review steps
          (Basis · Sponsorship/Personal · NTU-funded · Policy Outcome; each row expands to the
          per-traveller computation). Read-only here; estimates are edited on the Estimates step. */}
      {req.expenses.length === 0 ? (
        <Card title="Estimated Cost Lines" className="mb-5"><Empty>No estimate lines yet — add airfare, accommodation and ODA on the Estimates step.</Empty></Card>
      ) : (
        <div className="mb-5"><CostItems req={req} summary={summary} basis={settings.approvalAmountBasis} outcomeFor={outcomeFor} lineActions={lineActions} /></div>
      )}

      <ChargingAccountEditor
        action={saveCharging.bind(null, id)}
        canEdit={canEdit}
        total={summary.ntuFunded}
        companyCodes={companyCodes.map((c) => ({ code: c.code, name: c.name }))}
        businessAreas={businessAreas.map((b) => ({ code: b.code, name: b.name, companyCode: b.companyCode }))}
        accounts={accounts}
        expenseTypes={etOpts}
        lines={lines}
        defaultAccount={defaultAccount}
        initialMode={initialMode}
        initialMain={initialMain}
        initialRows={initialRows}
        initialLineMap={initialLineMap}
        submitLabel="Save &amp; run policy review →"
        entriesTitle="Allocation Outcome"
        backHref={`/requests/${id}/estimates`}
        backLabel="← Back to estimates"
      />
    </div>
  );
}
