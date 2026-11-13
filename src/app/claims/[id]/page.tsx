// TR-16 Create Travel Expense Claim (ECS format, §13.8 / §17) — pre-populated from the
// approved Travel Request. Locked header fields are copied from the TR; the claimant edits
// actual amounts, receipts, incidentals and (optionally) charging. Reuses the ECS charging
// cascade + Accounting Entries. Submission records the claim (TR-17 variance preserved).
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@/shared/db';
import { loadRequest } from '@/modules/pretrip/queries';
import { getSettings } from '@/modules/pretrip/settings';
import { prepopulateClaim, fmtSgd } from '@/modules/te/prepopulate';
import { getContractSettings, prepopContract } from '@/modules/pretrip/integration';
import { updateClaimHeader, submitClaim, addClaimExpense, removeClaimExpense, saveClaimCharging, waiveEvidence } from '@/modules/te/actions';
import { claimChargingContext, doaAutoGrant, type ClaimLike } from '@/modules/te/workflow';
import { EcsReference, EcsIdentity } from '@/shared/ecs/services';
import { getCtaAccount } from '@/modules/pretrip/ctaMaster';
import { airfareUpgrade } from '@/modules/pretrip/upgrade';
import { listUpgradeAccounts, effectiveDeltaCode } from '@/modules/pretrip/upgradeConfig';
import { currentPersonaId } from '@/shared/session';
import { chargingCodes, companyCodes, businessAreas } from '@/data/charging';
import { expenseTypes } from '@/data/expenseTypes';
import { currencies } from '@/data/fxRates';
import { employees } from '@/data/employees';
import { CLAIM_STATUS, APPROVER_ROLE, TE_TREATMENT, EXPENSE_CATEGORY } from '@/shared/enums';
import { ChargingAccountEditor, type AccountOpt, type CostLineX } from '@/components/ChargingAccountEditor';
import { AddExpenseModal } from '@/components/AddExpenseModal';
import { ClaimDecisionBar } from '@/components/ClaimDecisionBar';
import { LegacyClaimView } from '@/components/LegacyClaimView';
import { Card, CollapsibleCard, Empty } from '@/components/ui';

const ROLE_LABEL: Record<string, string> = { [APPROVER_ROLE.Verifier]: 'Verifier', [APPROVER_ROLE.Exception]: 'Exception Approver', [APPROVER_ROLE.RO]: 'RO', [APPROVER_ROLE.DOA]: 'DOA', [APPROVER_ROLE.ResearchDOA]: 'Research DOA' };

export const dynamic = 'force-dynamic';

const RECEIPT: Record<string, string> = { LOCAL_GST: 'Local (With GST)', FOREIGN_NO_GST: 'Foreign / No GST', NO_RECEIPT: 'No receipt' };
const d = (x: Date | null) => (x ? x.toISOString().slice(0, 10) : '');

export default async function ClaimPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const claim = await prisma.travelExpenseClaim.findUnique({ where: { id }, include: { lines: true, approvalSteps: { orderBy: { seq: 'asc' } } } });
  if (!claim) notFound();
  const persona = await currentPersonaId();
  // TMC transition — a LEGACY claim (pre-go-live PNR, no Pre-Trip TR) has no approved request, so it
  // renders a focused view; none of the TA-anchored machinery below applies.
  if (!claim.requestId) return <LegacyClaimView claim={claim} persona={persona} />;
  const req = await loadRequest(claim.requestId);
  if (!req) notFound();
  const settings = await getSettings();
  const prep = prepopulateClaim(req, claim.claimantId, settings.airfareTreatment, prepopContract(await getContractSettings()));
  const canEdit = claim.status === CLAIM_STATUS.Draft || claim.status === CLAIM_STATUS.SentBack;
  const canSubmit = canEdit && (persona === claim.claimantId || EcsIdentity.hasRole(persona, 'TRAVEL_ADMIN'));
  const pendingStep = claim.approvalSteps.find((s) => s.status === 'Pending');
  const canAct = !!pendingStep && (pendingStep.approverId === persona || EcsIdentity.hasRole(persona, 'TRAVEL_ADMIN') || EcsIdentity.hasRole(persona, 'SYSTEM_ADMIN'));
  // §8 Who may waive an offline-approval evidence requirement: the current pending approver, or a Travel/
  // System Administrator. Available even pre-submission so a stuck evidence requirement can be cleared.
  const canWaive = EcsIdentity.hasRole(persona, 'TRAVEL_ADMIN') || EcsIdentity.hasRole(persona, 'SYSTEM_ADMIN') || (!!pendingStep && pendingStep.approverId === persona);

  const emp = EcsIdentity.employee(claim.claimantId);
  const ro = EcsIdentity.employee(emp?.reportingOfficerId ?? '');
  const booking = req.bookings.find((b) => b.travellerId === claim.claimantId) ?? req.bookings[0];
  const bookingRef = `${req.authorisationNo ?? '—'}${booking?.pnr ? ` · ${booking.pnr}` : ''}`;
  const labelOf = (l: { category: string; expenseTypeId: string }) => EcsReference.expenseType(l.expenseTypeId)?.name ?? prep.lines.find((p) => p.category === l.category)?.label ?? l.category;
  // §4.5 / contract v1.4 — the declared personal-extension reflection on the claim header (tePersonalDays,
  // Reference). Driven by prepopulateClaim so a contract Exclude hides it; per-traveller for a group member.
  const personalField = prep.header.find((h) => h.label === 'Personal extension (declared)');
  // New-datapoint highlight — a green "NEW" chip + a soft green field tint, so the datapoints added
  // in this build stand out from the existing claim fields.
  const newTag = () => <span className="ml-2 inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-wide align-middle" style={{ background: '#e1f5ee', color: '#0f6e56', border: '1px solid #a7dcc6' }}>NEW</span>;
  const hiField = { borderColor: '#4bbf8f', background: '#f0faf5' } as const;
  const destLabel = `${EcsReference.country(req.destCountry ?? '')?.name ?? '—'}${req.destCity ? ` · ${EcsReference.city(req.destCity)?.name ?? req.destCity}` : ''}`;

  // DD-19 / DD-30 — CTA-settled (Reference) lines are shown for the full cost picture but are NOT
  // reimbursed (the employee never fronted them). Auto-deduct them from the reimbursable total so
  // the displayed figure matches claimTotal() (which already excludes Reference lines). The paying
  // CTA account comes from the claimant's booking (feed-reported).
  const isRef = (l: { treatment: string }) => l.treatment === TE_TREATMENT.Reference;
  const totalExpenses = claim.lines.reduce((s, l) => s + l.actualSgd, 0);
  const ctaPaidTotal = claim.lines.filter(isRef).reduce((s, l) => s + l.actualSgd, 0);
  const reimbursableExpenses = claim.lines.filter((l) => !isRef(l)).reduce((s, l) => s + l.actualSgd, 0);
  const totalReimbursable = Math.max(reimbursableExpenses - claim.lessCorpCard - claim.lessPersonal, 0);
  const ctaAccount = await getCtaAccount(booking?.ctaAccountId);
  // DD-31 — CTA charges post to SAP on receipt, so they are NOT posted again at the claim. Surface
  // the posting on each reference line for traceability (de-scoped from the claim posting).
  const ctaPostings = booking ? await prisma.ctaPostingDocument.findMany({ where: { bookingId: booking.id } }) : [];
  const postingByType = new Map(ctaPostings.map((d) => [d.chargeType, d] as const));
  const postingFor = (cat: string) => postingByType.get(cat === 'AIRFARE' ? 'Airfare' : cat === 'ACCOMMODATION' ? 'Accommodation' : '');

  // §4.5 / contract tePersonalDays (Phase 2) — the funded day/night BASIS behind the ODA and
  // accommodation amounts, from the approved request's per-city estimates, scoped to this claimant
  // (group → their attributed + shared estimates). Read-only: the amounts are already net of personal
  // time (ODA funded = eligibleDays; accommodation funded = nights − personalNights); this makes the
  // funded-vs-stay split visible on the claim without re-deriving anything.
  const claimantEstimates = req.isGroup
    ? req.expenses.filter((e) => !e.travellerId || e.travellerId === claim.claimantId || e.isShared)
    : req.expenses;
  const odaBasis = claimantEstimates.map((e) => e.oda).filter((o): o is NonNullable<typeof o> => !!o);
  const accomBasis = claimantEstimates.map((e) => e.accommodation).filter((a): a is NonNullable<typeof a> => !!a);
  const hasFundedBasis = odaBasis.length > 0 || accomBasis.length > 0;
  const anyPersonalBasis = odaBasis.some((o) => o.personalDays > 0) || accomBasis.some((a) => a.personalNights > 0);
  // Phase 4 — soft guard: the approved ODA / accommodation line IS the funded (personal-excluded)
  // amount. A claimed actual ABOVE it means more days/nights than funded are being claimed (personal
  // days creeping in). Not a hard block (the amounts are advisory, reviewed at claim), just a flag.
  const overFundedLines = claim.lines.filter((l) =>
    (l.category === EXPENSE_CATEGORY.ODA || l.category === EXPENSE_CATEGORY.Accommodation) && !isRef(l) && l.actualSgd > l.approvedSgd + 0.005);

  // §13.19 Phase 3 — M6 (travel-class entitlement differential) on the REIMBURSABLE airfare path.
  // A CTA-billed airfare line keeps its booking-time M6 split (Reference, not reimbursed); only an
  // employee-settled / self-booked airfare line (Editable) re-derives the split at claim, so the
  // NTU-funded differential routes to the governing BA's M6 account and the entitlement stays on the
  // normal allocation. Reuses upgrade.ts + the same ChargingAccountEditor machinery as the TR.
  const govBA = (req.allocations.find((a) => a.isMain) ?? req.allocations[0])?.businessArea ?? null;
  const upgradeAccounts = await listUpgradeAccounts();
  const m6Accounts: AccountOpt[] = upgradeAccounts.map((a) => ({ code: a.code, name: a.name, type: 'CC', companyCode: a.companyCode, businessArea: a.businessArea, research: false, crossCharge: false, closed: !a.active }));
  let m6DeltaSgd = 0;
  let m6DeltaCode: string | null = null;
  for (const e of claimantEstimates.filter((e) => e.category === EXPENSE_CATEGORY.Airfare)) {
    const u = airfareUpgrade({ sgdAmount: e.sgdAmount, entitlementFareSgd: e.entitlementFareSgd, upgradeFunding: e.upgradeFunding, upgradeDeltaCode: e.upgradeDeltaCode });
    if (u.isUpgrade && u.funding === 'NTU' && u.deltaSgd > 0) {
      m6DeltaSgd += u.deltaSgd;
      m6DeltaCode = effectiveDeltaCode(upgradeAccounts, govBA, settings.upgradeDeltaSelectionRequired, e.upgradeDeltaCode) ?? m6DeltaCode;
    }
  }
  m6DeltaSgd = Math.round(m6DeltaSgd * 100) / 100;

  // DD-08 / E11 — if the claimant moved the charging off the approved request's DOA, the claim
  // will route to the NEW account's DOA on submit (no auto-grant). Surface that before submit.
  const claimLike: ClaimLike = {
    claimantId: claim.claimantId, lessCorpCard: claim.lessCorpCard, lessPersonal: claim.lessPersonal,
    chargingMainCode: claim.chargingMainCode,
    lines: claim.lines.map((l) => ({ expenseTypeId: l.expenseTypeId, actualSgd: l.actualSgd, sponsorSgd: l.sponsorSgd, receiptType: l.receiptType, treatment: l.treatment })),
  };
  const chargeCtx = claimChargingContext(claimLike, req, { sameRouteResearch: settings.sameRouteResearch });
  const newDoaDeptName = EcsIdentity.department(chargeCtx.dept)?.name ?? chargeCtx.dept;
  const wouldAutoGrant = doaAutoGrant(claimLike, req, {
    exceptionApproverRequired: settings.exceptionApproverRequired, roRequirement: settings.roRequirement,
    sameRouteResearch: settings.sameRouteResearch, teAutoGrantTolerancePct: settings.teAutoGrantTolerancePct,
    teAutoGrantToleranceAbsSgd: settings.teAutoGrantToleranceAbsSgd,
  }).auto;

  // Charging — reconstruct the editor state from the claim snapshot.
  const cj: { rows: { code: string; percent: number; amount: number; io: string; isMain: boolean }[]; lineMap: Record<string, string> } =
    claim.chargingJson ? JSON.parse(claim.chargingJson) : { rows: [], lineMap: {} };
  const defaultAccount = emp?.defaultChargingCode ?? chargingCodes[0]?.code ?? '';
  const accounts: AccountOpt[] = chargingCodes.map((c) => ({ code: c.code, name: c.name, type: c.type, companyCode: c.companyCode, businessArea: c.businessArea, research: c.isResearch, crossCharge: !!c.crossCharge, closed: c.active === false }));
  const etOpts = expenseTypes.map((e) => ({ id: e.id, name: e.name, gl: e.glAccount, gst: e.gstCode }));
  const claimInitialAllocs = (l: { allocJson: string | null; chargingCode: string | null }): { code: string; pct: number; io: string }[] | undefined => {
    if (l.allocJson) { try { const a = JSON.parse(l.allocJson); if (Array.isArray(a) && a.length) return a.map((x: { code: string; pct: number; io?: string }) => ({ code: x.code, pct: Number(x.pct), io: x.io || '' })); } catch { /* ignore */ } }
    return l.chargingCode ? [{ code: l.chargingCode, pct: 100, io: '' }] : undefined;
  };
  const costLines: CostLineX[] = claim.lines.map((l) => {
    const net = Math.max(l.actualSgd - l.sponsorSgd, 0);
    // M6 split only on a REIMBURSABLE airfare line (CTA/Reference airfare was split at booking).
    const m6OnLine = l.category === EXPENSE_CATEGORY.Airfare && !isRef(l) && m6DeltaSgd > 0;
    return {
      id: l.id, typeId: l.expenseTypeId, typeName: labelOf(l), net,
      category: l.category ?? l.expenseTypeId, isShared: false, deptAllocs: [], initialAllocs: claimInitialAllocs(l),
      ...(m6OnLine ? { upgradeDeltaSgd: Math.min(m6DeltaSgd, net), upgradeDeltaCode: m6DeltaCode ?? undefined } : {}),
    };
  });
  const initialRows = cj.rows.map((r) => ({ ba: chargingCodes.find((c) => c.code === r.code)?.businessArea ?? '', code: r.code, io: r.io ?? '', pct: r.percent }));
  const initialLineMap: Record<string, string> = {};
  for (const l of claim.lines) if (l.chargingCode) initialLineMap[l.id] = l.chargingCode;
  const initialMode = (claim.chargingMode === 'ITEM' || claim.chargingMode === 'CLAIM' ? claim.chargingMode : 'MAIN') as 'MAIN' | 'CLAIM' | 'ITEM';

  return (
    <div className="w-full space-y-5">
      {/* Title bar */}
      <div className="flex flex-wrap items-center gap-3 border-b border-[var(--ecs-border)] pb-3">
        <h1 className="text-xl font-bold text-[var(--ecs-navy)]">Travel Expense Claim <span className="text-[var(--ecs-muted)] font-normal">· {claim.claimNumber}</span></h1>
        <span className={claim.status === CLAIM_STATUS.Approved ? 'pill-pass' : claim.status === CLAIM_STATUS.SentBack ? 'pill-exc' : claim.status.startsWith('Pending') ? 'pill-warn' : 'pill-info'}>{claim.status}</span>
        <div className="ml-auto flex items-center gap-3 text-sm">
          <Link href={`/requests/${req.id}`} className="btn-ghost">View Travel Request →</Link>
          {canSubmit && <form action={submitClaim.bind(null, id)}><button className="btn-primary">Submit</button></form>}
          {canAct && <ClaimDecisionBar claimId={id} roleLabel={ROLE_LABEL[pendingStep!.roleType] ?? pendingStep!.roleType} />}
        </div>
      </div>
      <p className="text-xs text-[var(--ecs-muted)] -mt-2">Pre-populated from {req.requestNumber} / {req.authorisationNo ?? '—'}. {prep.note}</p>

      {/* DD-08 / E11 — charging moved off the approved request's DOA: re-route notice (Draft only) */}
      {canEdit && chargeCtx.changed && (
        <div className="card p-3 text-sm bg-amber-50 border-amber-200 text-amber-900">
          <strong>Charging changed — DOA re-routes.</strong> The main charging account has moved off the approved request&apos;s DOA. On submit this claim will <strong>not</strong> be auto-granted; it routes to <strong>{newDoaDeptName}{chargeCtx.research ? ' (research)' : ''}</strong>&apos;s DOA to approve the changed account (§13.8 / DD-08).
        </div>
      )}
      {canEdit && !chargeCtx.changed && wouldAutoGrant && (
        <div className="card p-3 text-sm bg-emerald-50 border-emerald-200 text-emerald-900">
          On submit, DOA approval will be <strong>auto-granted</strong> from {req.authorisationNo} — the claim is within tolerance, with the same charging DOA and no new exception or expense type (§51).
        </div>
      )}

      {/* §51 Claim approval workflow */}
      {claim.approvalSteps.length > 0 && (
        <div className="card p-4">
          <div className="text-xs font-semibold text-[var(--ecs-muted)] mb-2">Approval Workflow</div>
          <div className="chev-row overflow-x-auto">
            <div className="flex items-center"><div className="chev chev-done"><div className="font-semibold">Submitted</div><div className="opacity-80">by {emp?.name}</div></div></div>
            {claim.approvalSteps.map((s) => {
              const label = ROLE_LABEL[s.roleType] ?? s.roleType;
              const state = s.status === 'Approved' ? 'chev-done' : s.status === 'SentBack' ? 'chev-stop' : s.id === pendingStep?.id ? 'chev-current' : 'chev-todo';
              const who = s.autoGranted ? 'auto-granted' : (EcsIdentity.employee(s.approverId ?? '')?.name ?? 'TBD');
              return (
                <div key={s.id} className="flex items-center"><span className="chev-conn" />
                  <div className={`chev ${state}`}><div className="font-semibold">{s.status === 'Approved' ? `${label} ${s.autoGranted ? 'Auto-granted' : 'Approved'}` : s.status === 'SentBack' ? `${label} Sent Back` : `Pending ${label}`}</div><div className="opacity-80">{who}</div></div>
                </div>
              );
            })}
          </div>
          {claim.approvalSteps.some((s) => s.autoGranted) && (
            <p className="text-xs text-[var(--ecs-muted)] mt-2">DOA approval was <strong>auto-granted from {req.authorisationNo}</strong> — the claim is within the approved estimate (tolerance {settings.teAutoGrantTolerancePct}% / SGD {settings.teAutoGrantToleranceAbsSgd}), with no new exception or expense type (§51).</p>
          )}
        </div>
      )}

      {/* Main form: header + expense items + totals */}
      <form action={updateClaimHeader.bind(null, id)} className="space-y-5">
        <Card title="Employee details">
          <div className="grid md:grid-cols-4 gap-4">
            <div><label className="label">Employee Name</label><input className="field" value={emp?.name ?? claim.claimantId} disabled /></div>
            <div><label className="label">Reporting Officer</label><input className="field" value={ro ? `${ro.name} (${ro.email})` : '—'} disabled /></div>
            <div><label className="label">Additional approver 1</label><input className="field" value={EcsIdentity.employee(claim.additionalApprover1 ?? '')?.name ?? '—'} disabled /></div>
            <div><label className="label">Additional approver 2</label>
              <select name="additionalApprover2" defaultValue={claim.additionalApprover2 ?? ''} disabled={!canEdit} className="field">
                <option value="">— none —</option>
                {employees.filter((e) => e.id !== claim.claimantId).map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
              </select>
            </div>
          </div>
        </Card>

        <Card title="Travel Booking Details">
          <label className="flex items-center gap-2 text-sm mb-4">
            <input type="checkbox" name="trsNotBooked" defaultChecked={claim.trsNotBooked} disabled={!canEdit} className="w-4 h-4" />
            Booking not made on NTU&apos;s Travel Reservation System (TRS)
          </label>
          <div className="grid md:grid-cols-3 gap-4">
            <div><label className="label">Travel Booking Reference</label><input className="field" value={bookingRef} disabled /></div>
            <div><label className="label">Main Country/Region Of Travel {req.destCity && newTag()}</label><input className="field" style={req.destCity ? hiField : undefined} value={destLabel} disabled title="Now includes the city (new)" /></div>
            <div><label className="label">Travel Class</label><input className="field" value={EcsReference.travelClass(req.travelClassId ?? '')?.name ?? '—'} disabled /></div>
            <div><label className="label">Travel Purpose</label><input className="field" value={EcsReference.travelPurpose(req.purposeId ?? '')?.name ?? '—'} disabled /></div>
            <div><label className="label">Trip Description</label><input className="field" value={req.description ?? '—'} disabled /></div>
            {personalField && <div><label className="label">Personal Extension (excluded) {newTag()}</label><input className="field" style={hiField} value={personalField.value} disabled title="Declared personal days — excluded from funded ODA / accommodation (contract tePersonalDays)" /></div>}
            <div className="grid grid-cols-2 gap-3">
              <div><label className="label">Travel Start Date</label><input type="date" name="travelStart" defaultValue={d(claim.travelStart)} disabled={!canEdit} className="field" /></div>
              <div><label className="label">Travel End Date</label><input type="date" name="travelEnd" defaultValue={d(claim.travelEnd)} disabled={!canEdit} className="field" /></div>
            </div>
          </div>
        </Card>

        <Card title={`Expense items (${claim.lines.length})`} actions={canEdit ? <AddExpenseModal action={addClaimExpense.bind(null, id)} expenseTypes={expenseTypes.map((e) => ({ id: e.id, name: e.name }))} currencies={currencies} /> : undefined}>
          {claim.lines.length === 0 ? <Empty>No expense items — add one, or create the claim from an approved request.</Empty> : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr>
                  <th className="th">Transaction date</th><th className="th">Expense type</th><th className="th">Reason</th>
                  <th className="th text-right">Approved est.</th><th className="th text-right">Expense amount (SGD)</th>
                  <th className="th">Receipt</th><th className="th"></th>
                </tr></thead>
                <tbody>
                  {claim.lines.map((l) => (
                    <tr key={l.id} className="hover:bg-[var(--ecs-panel-2)]">
                      <td className="td whitespace-nowrap">{d(l.transactionDate) || '—'}</td>
                      <td className="td font-medium">{labelOf(l)}{isRef(l) && <span className="ml-2 inline-block rounded px-1.5 py-0.5 text-xs font-normal bg-[var(--ecs-panel-2)] text-[var(--ecs-muted)] whitespace-nowrap" title={ctaAccount ? `${ctaAccount.label} → clearing ${ctaAccount.clearingGlAccount}` : undefined}>Paid by CTA{booking?.ctaAccountId ? ` · ${booking.ctaAccountId}` : ''} · reference — not reimbursed{(() => { const d = postingFor(l.category); return d ? ` · posted to SAP ${d.sapDocNo} (${d.status})` : ''; })()}</span>}</td>
                      <td className="td">{canEdit && !isRef(l) ? <input name={`reason_${l.id}`} defaultValue={l.reason ?? ''} className="field" /> : (l.reason ?? '—')}</td>
                      <td className="td text-right whitespace-nowrap text-[var(--ecs-muted)]">{l.approvedSgd > 0 ? fmtSgd(l.approvedSgd) : '—'}</td>
                      <td className={`td text-right ${isRef(l) ? 'text-[var(--ecs-muted)]' : ''}`}>{canEdit && !isRef(l) ? <input name={`actual_${l.id}`} type="number" step="any" defaultValue={l.actualSgd} className="field text-right w-28 ml-auto" /> : fmtSgd(l.actualSgd)}</td>
                      <td className="td">{isRef(l) ? <span className="text-[var(--ecs-muted)]">—</span> : canEdit ? (
                        <select name={`receipt_${l.id}`} defaultValue={l.receiptType} className="field">
                          {Object.entries(RECEIPT).map(([v, lab]) => <option key={v} value={v}>{lab}</option>)}
                        </select>
                      ) : RECEIPT[l.receiptType] ?? l.receiptType}</td>
                      <td className="td text-right">{canEdit && <button formAction={removeClaimExpense.bind(null, id, l.id)} className="btn-ghost text-xs">Remove</button>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="mt-4 ml-auto max-w-md space-y-1.5 text-sm">
            <div className="flex justify-between"><span className="text-[var(--ecs-muted)]">Total expenses (all lines)</span><span className="font-medium">{fmtSgd(totalExpenses)}</span></div>
            {ctaPaidTotal > 0 && (
              <div className="flex justify-between"><span className="text-[var(--ecs-muted)]">Less: charges paid by CTA{ctaAccount ? ` (${ctaAccount.ctaAccountId})` : ''} — reference only</span><span className="text-[var(--ecs-muted)]">− {fmtSgd(ctaPaidTotal)}</span></div>
            )}
            <div className="flex justify-between items-center"><span className="text-[var(--ecs-muted)]">Less NTU Corporate Card (other)</span>{canEdit ? <input name="lessCorpCard" type="number" step="any" defaultValue={claim.lessCorpCard} className="field text-right w-28" /> : <span>{fmtSgd(claim.lessCorpCard)}</span>}</div>
            <div className="flex justify-between items-center"><span className="text-[var(--ecs-muted)]">Less Personal / Sponsorship</span>{canEdit ? <input name="lessPersonal" type="number" step="any" defaultValue={claim.lessPersonal} className="field text-right w-28" /> : <span>{fmtSgd(claim.lessPersonal)}</span>}</div>
            <div className="flex justify-between border-t border-[var(--ecs-border)] pt-1.5 font-bold text-[var(--ecs-navy)]"><span>Total Reimbursable Amount</span><span>{fmtSgd(totalReimbursable)}</span></div>
            {ctaPaidTotal > 0 && <p className="text-xs text-[var(--ecs-muted)] pt-1">CTA-settled airfare / hotel are deducted automatically (paid centrally, not reimbursed). &ldquo;Less NTU Corporate Card (other)&rdquo; is for any other corporate-card spend not already shown as a reference line.</p>}
          </div>
          {canEdit && <div className="flex justify-end mt-4"><button type="submit" className="btn-secondary">Save draft</button></div>}
        </Card>
      </form>

      {req.deviations.length > 0 && (
        <Card title="Booking deviations vs approved (§6.4)">
          {(() => {
            const blocking = req.deviations.filter((x) => x.requiresEvidence && !x.evidenceAttachmentId && !x.waivedBy);
            return blocking.length > 0 ? (
              <div className="mb-3 rounded border border-amber-200 bg-amber-50 p-2 text-sm text-amber-900">
                <b>Submission blocked (§8):</b> {blocking.length} deviation(s) need offline-approval evidence or an approved waiver before this claim can be submitted. The traveller uploads evidence against the request (Booking page); the approver may waive with a reason below.
              </div>
            ) : null;
          })()}
          <ul className="space-y-2 text-sm">
            {req.deviations.map((x) => (
              <li key={x.id} className="flex flex-col gap-1 border-b border-[var(--ecs-border)] pb-2 last:border-0">
                <div className="flex items-start gap-2">
                  <span className={x.material ? 'pill-exc' : 'pill-info'}>{x.material ? 'Material' : 'Log only'}</span>
                  <div className="min-w-0"><strong>{x.field}</strong>: approved {x.approvedValue} → booked {x.bookedValue}. <span className="text-[var(--ecs-muted)]">{[x.level, x.scopeRef, x.pnr ? `PNR ${x.pnr}` : null].filter(Boolean).join(' · ')}</span></div>
                </div>
                {x.requiresEvidence && (
                  x.evidenceAttachmentId ? <div className="text-xs text-emerald-700 ml-10">✓ Offline-approval evidence attached.</div>
                  : x.waivedBy ? <div className="text-xs text-amber-800 ml-10">Evidence waived by {EcsIdentity.employee(x.waivedBy)?.name ?? x.waivedBy}{x.waiverReason ? ` — ${x.waiverReason}` : ''}.</div>
                  : canWaive ? (
                    <form action={waiveEvidence.bind(null, x.id, id)} className="ml-10 flex flex-wrap items-center gap-2">
                      <span className="pill-warn text-xs">Evidence required</span>
                      <input name="reason" placeholder="Waiver reason (required)" className="field w-72 py-1 text-xs" />
                      <button className="btn-secondary text-xs">Waive with reason</button>
                    </form>
                  ) : <div className="text-xs text-amber-800 ml-10">Evidence required (§8) — awaiting upload against the request before submission.</div>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* Charging — reused ECS cascade + Accounting Entries */}
      <ChargingAccountEditor
        action={saveClaimCharging.bind(null, id)}
        canEdit={canEdit}
        total={totalReimbursable}
        companyCodes={companyCodes.map((c) => ({ code: c.code, name: c.name }))}
        businessAreas={businessAreas.map((b) => ({ code: b.code, name: b.name, companyCode: b.companyCode }))}
        accounts={accounts}
        extraAccounts={m6Accounts}
        highlightUpgrade
        expenseTypes={etOpts}
        lines={costLines}
        defaultAccount={defaultAccount}
        initialMode={initialMode}
        initialMain={claim.chargingMainCode ?? defaultAccount}
        initialRows={initialRows}
        initialLineMap={initialLineMap}
        submitLabel="Save charging"
      />

      {hasFundedBasis && (
        <CollapsibleCard
          title={<>Funded basis — personal days / nights excluded {newTag()}</>}
          stub={anyPersonalBasis ? 'Personal time excluded from the funded ODA / accommodation' : 'No personal days declared — funded = full stay'}
          className="border-l-4 border-l-emerald-400"
        >
          <p className="text-xs text-[var(--ecs-muted)] mb-3">The ODA and accommodation amounts above are already net of declared personal time (§4.5). This shows the funded count against the actual stay per city.{anyPersonalBasis ? '' : ' No personal days are declared on this trip, so funded = full stay.'}</p>
          {overFundedLines.length > 0 && (
            <div className="mb-3 rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">
              <b>Check personal-day claiming:</b> {overFundedLines.map((l) => labelOf(l)).join(', ')} claimed above the funded (personal-excluded) approved amount. The funded day / night counts above exclude declared personal time; the claimed ODA / accommodation should not exceed them.
            </div>
          )}
          {odaBasis.length > 0 && (
            <div className="overflow-x-auto mb-4">
              <table className="w-full text-sm">
                <thead><tr>
                  <th className="th">Overseas Daily Allowance — city</th><th className="th">Arrive</th><th className="th">Depart</th>
                  <th className="th text-right">Stay days</th><th className="th text-right">Personal</th><th className="th text-right">Funded days</th><th className="th text-right">Rate/day</th>
                </tr></thead>
                <tbody>
                  {odaBasis.map((o, i) => (
                    <tr key={i}>
                      <td className="td">{EcsReference.city(o.city ?? '')?.name ?? EcsReference.country(o.country)?.name ?? o.city ?? o.country}</td>
                      <td className="td whitespace-nowrap">{d(o.arrive) || '—'}</td>
                      <td className="td whitespace-nowrap">{d(o.depart) || '—'}</td>
                      <td className="td text-right">{o.eligibleDays + o.personalDays}</td>
                      <td className={`td text-right ${o.personalDays > 0 ? 'font-medium text-amber-700' : 'text-[var(--ecs-muted)]'}`}>{o.personalDays}</td>
                      <td className="td text-right font-medium">{o.eligibleDays}</td>
                      <td className="td text-right text-[var(--ecs-muted)]">{fmtSgd(o.dailyRate)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {accomBasis.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr>
                  <th className="th">Accommodation — city</th><th className="th">Check-in</th><th className="th">Check-out</th>
                  <th className="th text-right">Stay nights</th><th className="th text-right">Personal</th><th className="th text-right">Funded nights</th><th className="th text-right">Avg/night</th>
                </tr></thead>
                <tbody>
                  {accomBasis.map((a, i) => (
                    <tr key={i}>
                      <td className="td">{EcsReference.city(a.city)?.name ?? a.city}</td>
                      <td className="td whitespace-nowrap">{d(a.checkIn) || '—'}</td>
                      <td className="td whitespace-nowrap">{d(a.checkOut) || '—'}</td>
                      <td className="td text-right">{a.nights}</td>
                      <td className={`td text-right ${a.personalNights > 0 ? 'font-medium text-amber-700' : 'text-[var(--ecs-muted)]'}`}>{a.personalNights}</td>
                      <td className="td text-right font-medium">{a.nights - a.personalNights}</td>
                      <td className="td text-right text-[var(--ecs-muted)]">{fmtSgd(a.budgetedNightly)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CollapsibleCard>
      )}

      <p className="text-xs text-[var(--ecs-muted)]">Approved estimates remain traceable; edits are recorded as actual values/variances rather than overwriting the approved request (§8.3). One approved request may link to multiple claims; cumulative claimed amounts compare against the approved estimate (AC17).</p>
    </div>
  );
}
