// TR-09 Charging & Allocation — ECS-format (§17). Estimated cost lines are shown first;
// charging then uses the ECS cascade (Company Code → Business Area → CC/WBS → Account) with
// an optional cost allocation (at claim level or per expense item) and computed Accounting
// Entries. Reuses ECS charging masters and the traveller's profile default account. The
// effective split is persisted to ChargingAllocation, which drives approval routing (§13.14).
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { loadRequest, type FullRequest } from '@/modules/pretrip/queries';
import { saveCharging } from '@/modules/pretrip/actions';
import { getSettings } from '@/modules/pretrip/settings';
import { currentPersonaId } from '@/shared/session';
import { canEditRequest } from '@/modules/pretrip/guards';
import { chargingCodes, companyCodes, businessAreas } from '@/data/charging';
import { expenseTypes } from '@/data/expenseTypes';
import { EcsReference, EcsIdentity } from '@/shared/ecs/services';
import { memberName } from '@/modules/pretrip/traveller';
import { computeSummary, fmtSgd } from '@/modules/pretrip/pricing';
import { airfareUpgrade } from '@/modules/pretrip/upgrade';
import { EXPENSE_CATEGORY } from '@/shared/enums';
import { ChargingAccountEditor, type AccountOpt, type CostLineX } from '@/components/ChargingAccountEditor';
import { Card, Stepper, Empty } from '@/components/ui';
import { DuplicateWarning } from '@/components/DuplicateWarning';

export const dynamic = 'force-dynamic';

function detailOf(e: FullRequest['expenses'][number]): string {
  if (e.category === EXPENSE_CATEGORY.Airfare) return `${e.originCode ?? ''} → ${e.destCode ?? ''} · ${EcsReference.travelClass(e.proposedClassId ?? '')?.name ?? ''}`;
  if (e.accommodation) return `${EcsReference.city(e.accommodation.city)?.name ?? e.accommodation.city} · ${e.accommodation.nights}n`;
  if (e.oda) return `${EcsReference.country(e.oda.country)?.name ?? e.oda.country} · ${e.oda.eligibleDays} days @ ${fmtSgd(e.oda.dailyRate)}/day`;
  return e.notes ?? '';
}

export default async function ChargingStep({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const req = await loadRequest(id);
  if (!req) notFound();
  const settings = await getSettings();
  const canEdit = canEditRequest(await currentPersonaId(), req);
  const summary = computeSummary(req.expenses, settings.approvalAmountBasis);

  // #7/#14 travel-class upgrade split — derived from the airfare line's entitlement-class fare + funding.
  const mainCode = (req.allocations.find((a) => a.isMain) ?? req.allocations[0])?.chargingCode ?? null;
  const upgradeLines = req.expenses
    .filter((e) => e.category === EXPENSE_CATEGORY.Airfare)
    .map((e) => ({ e, u: airfareUpgrade({ sgdAmount: e.sgdAmount, entitlementFareSgd: e.entitlementFareSgd, upgradeFunding: e.upgradeFunding }) }))
    .filter((x) => x.u.isUpgrade);

  const defaultAccount = EcsIdentity.employee(req.travellerId)?.defaultChargingCode ?? EcsIdentity.employee(req.requestorId)?.defaultChargingCode ?? chargingCodes[0]?.code ?? '';
  // §8 a guest member has no Workday department — their share is charged to the host's
  // (requestor's) department cost object.
  const hostChargingCode = EcsIdentity.employee(req.requestorId)?.defaultChargingCode ?? defaultAccount;
  const memberKeyLabel = (key: string | null) => {
    const t = req.travellers.find((x) => x.employeeId === key);
    return t ? memberName(t) + (t.travellerType === 'GUEST' ? ' · guest' : '') : (EcsIdentity.employee(key ?? '')?.name ?? '—');
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
  const guestIds = new Set(req.travellers.filter((t) => t.travellerType === 'GUEST' || t.employeeId.startsWith('G-')).map((t) => t.employeeId));
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
  const lines: CostLineX[] = req.expenses.map((e) => ({
    id: e.id, typeId: e.expenseTypeId,
    typeName: EcsReference.expenseType(e.expenseTypeId)?.name ?? e.category,
    net: Math.max(e.sgdAmount - e.sponsorSgd, 0),
    category: e.category,
    travellerName: e.travellerId ? memberKeyLabel(e.travellerId) : undefined,
    isShared: e.isShared,
    deptAllocs: deptAllocsFor(e),
    initialAllocs: initialAllocsFor(e),
  }));

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

  return (
    <div>
      <Stepper id={id} active="charging" requestNumber={req.requestNumber} status={req.status} />
      {!canEdit && <div className="card p-3 mb-4 text-sm text-amber-900 bg-amber-50 border-amber-200">Read-only view — your role cannot edit this request&apos;s charging.</div>}
      <DuplicateWarning req={req} />

      {upgradeLines.length > 0 && (
        <Card title="Travel-class upgrade — charging split (#7 / #14)" className="mb-5">
          <p className="text-xs text-[var(--ecs-muted)] mb-3">The standard entitlement charges the original WBS / cost centre; the upgrade differential is funded as chosen on the airfare line.</p>
          <div className="space-y-4">
            {upgradeLines.map(({ e, u }) => (
              <div key={e.id} className="text-sm">
                <div className="font-medium mb-1">{e.originCode} → {e.destCode} · {EcsReference.travelClass(e.proposedClassId ?? '')?.name ?? ''}
                  <span className="text-[var(--ecs-muted)] font-normal"> — chosen {fmtSgd(u.fareSgd)}, entitlement {fmtSgd(u.entitlementSgd)}, delta {fmtSgd(u.deltaSgd)}</span>
                </div>
                <table className="w-full text-sm">
                  <tbody>
                    <tr className="border-t border-[var(--ecs-border)]">
                      <td className="td">Standard entitlement</td>
                      <td className="td text-right tabular-nums">{fmtSgd(u.entitlementSgd)}</td>
                      <td className="td">→ original WBS / cost centre{mainCode ? ` (${chargingCodes.find((c) => c.code === mainCode)?.name ?? mainCode})` : ' (per the allocation below)'}</td>
                    </tr>
                    <tr className="border-t border-[var(--ecs-border)]">
                      <td className="td">Upgrade differential</td>
                      <td className="td text-right tabular-nums">{fmtSgd(u.deltaSgd)}</td>
                      <td className="td">{u.funding === 'NTU'
                        ? <>→ cost centre <strong>M6</strong> <span className="pill-info ml-1">NTU-funded</span></>
                        : <>→ <strong>traveller</strong> — paid to the TMC directly, not reimbursed <span className="pill-warn ml-1">self-funded</span></>}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card title={`Estimated Cost Lines (${req.expenses.length})`} className="mb-5">
        {req.expenses.length === 0 ? <Empty>No estimate lines yet — add airfare, accommodation and ODA on the Estimates step.</Empty> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr><th className="th">Type</th>{req.isGroup && <th className="th">Traveller</th>}<th className="th">Detail</th><th className="th text-right">Gross (SGD)</th><th className="th text-right">Sponsor (SGD)</th><th className="th text-right">NTU-funded (SGD)</th></tr></thead>
              <tbody>
                {req.expenses.map((e) => {
                  // #7 a self-funded airfare upgrade delta is traveller-paid — exclude it from the line's NTU-funded figure.
                  const u = e.category === EXPENSE_CATEGORY.Airfare ? airfareUpgrade({ sgdAmount: e.sgdAmount, entitlementFareSgd: e.entitlementFareSgd, upgradeFunding: e.upgradeFunding }) : null;
                  const selfDelta = u?.isUpgrade && u.funding === 'SELF' ? u.travellerPaysSgd : 0;
                  const ntu = Math.max(e.sgdAmount - e.sponsorSgd - selfDelta, 0);
                  return (
                  <tr key={e.id} className="hover:bg-[var(--ecs-panel-2)]">
                    <td className="td font-medium">{EcsReference.expenseType(e.expenseTypeId)?.name ?? e.category}</td>
                    {req.isGroup && <td className="td text-xs text-[var(--ecs-navy-2)] whitespace-nowrap">{e.isShared ? 'Shared — apportioned' : memberKeyLabel(e.travellerId)}</td>}
                    <td className="td text-xs text-[var(--ecs-muted)]">{detailOf(e)}</td>
                    <td className="td text-right whitespace-nowrap">{fmtSgd(e.sgdAmount)}</td>
                    <td className="td text-right whitespace-nowrap">{e.sponsorSgd > 0 ? `− ${fmtSgd(e.sponsorSgd)}` : selfDelta > 0 ? `− ${fmtSgd(selfDelta)} self` : '—'}</td>
                    <td className="td text-right whitespace-nowrap font-medium">{fmtSgd(ntu)}</td>
                  </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="font-semibold">
                  <td className="td" colSpan={req.isGroup ? 3 : 2}>Estimated NTU-funded cost</td>
                  <td className="td text-right">{fmtSgd(summary.gross)}</td>
                  <td className="td text-right">{(summary.sponsorship + summary.travellerFunded) > 0 ? `− ${fmtSgd(summary.sponsorship + summary.travellerFunded)}` : '—'}</td>
                  <td className="td text-right">{fmtSgd(summary.ntuFunded)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>

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
      />

      <div className="mt-5">
        <Link href={`/requests/${id}/estimates`} className="btn-secondary">← Back to estimates</Link>
      </div>
    </div>
  );
}
