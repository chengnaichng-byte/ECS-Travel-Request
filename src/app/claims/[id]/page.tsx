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
import { updateClaimHeader, submitClaim, addClaimExpense, removeClaimExpense, saveClaimCharging } from '@/modules/te/actions';
import { EcsReference, EcsIdentity } from '@/shared/ecs/services';
import { currentPersonaId } from '@/shared/session';
import { chargingCodes, companyCodes, businessAreas } from '@/data/charging';
import { expenseTypes } from '@/data/expenseTypes';
import { currencies } from '@/data/fxRates';
import { employees } from '@/data/employees';
import { CLAIM_STATUS, APPROVER_ROLE } from '@/shared/enums';
import { ChargingAccountEditor, type AccountOpt, type CostLineX } from '@/components/ChargingAccountEditor';
import { AddExpenseModal } from '@/components/AddExpenseModal';
import { ClaimDecisionBar } from '@/components/ClaimDecisionBar';
import { Card, Empty } from '@/components/ui';

const ROLE_LABEL: Record<string, string> = { [APPROVER_ROLE.Verifier]: 'Verifier', [APPROVER_ROLE.Exception]: 'Exception Approver', [APPROVER_ROLE.RO]: 'RO', [APPROVER_ROLE.DOA]: 'DOA', [APPROVER_ROLE.ResearchDOA]: 'Research DOA' };

export const dynamic = 'force-dynamic';

const RECEIPT: Record<string, string> = { LOCAL_GST: 'Local (With GST)', FOREIGN_NO_GST: 'Foreign / No GST', NO_RECEIPT: 'No receipt' };
const d = (x: Date | null) => (x ? x.toISOString().slice(0, 10) : '');

export default async function ClaimPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const claim = await prisma.travelExpenseClaim.findUnique({ where: { id }, include: { lines: true, approvalSteps: { orderBy: { seq: 'asc' } } } });
  if (!claim || !claim.requestId) notFound();
  const req = await loadRequest(claim.requestId);
  if (!req) notFound();
  const settings = await getSettings();
  const prep = prepopulateClaim(req, claim.claimantId, settings.airfareTreatment, prepopContract(await getContractSettings()));
  const persona = await currentPersonaId();
  const canEdit = claim.status === CLAIM_STATUS.Draft || claim.status === CLAIM_STATUS.SentBack;
  const canSubmit = canEdit && (persona === claim.claimantId || EcsIdentity.hasRole(persona, 'TRAVEL_ADMIN'));
  const pendingStep = claim.approvalSteps.find((s) => s.status === 'Pending');
  const canAct = !!pendingStep && (pendingStep.approverId === persona || EcsIdentity.hasRole(persona, 'TRAVEL_ADMIN') || EcsIdentity.hasRole(persona, 'SYSTEM_ADMIN'));

  const emp = EcsIdentity.employee(claim.claimantId);
  const ro = EcsIdentity.employee(emp?.reportingOfficerId ?? '');
  const booking = req.bookings.find((b) => b.travellerId === claim.claimantId) ?? req.bookings[0];
  const bookingRef = `${req.authorisationNo ?? '—'}${booking?.pnr ? ` · ${booking.pnr}` : ''}`;
  const labelOf = (l: { category: string; expenseTypeId: string }) => EcsReference.expenseType(l.expenseTypeId)?.name ?? prep.lines.find((p) => p.category === l.category)?.label ?? l.category;

  const totalExpenses = claim.lines.reduce((s, l) => s + l.actualSgd, 0);
  const totalReimbursable = Math.max(totalExpenses - claim.lessCorpCard - claim.lessPersonal, 0);

  // Charging — reconstruct the editor state from the claim snapshot.
  const cj: { rows: { code: string; percent: number; amount: number; io: string; isMain: boolean }[]; lineMap: Record<string, string> } =
    claim.chargingJson ? JSON.parse(claim.chargingJson) : { rows: [], lineMap: {} };
  const defaultAccount = emp?.defaultChargingCode ?? chargingCodes[0]?.code ?? '';
  const accounts: AccountOpt[] = chargingCodes.map((c) => ({ code: c.code, name: c.name, type: c.type, companyCode: c.companyCode, businessArea: c.businessArea, research: c.isResearch, crossCharge: !!c.crossCharge, closed: c.active === false }));
  const etOpts = expenseTypes.map((e) => ({ id: e.id, name: e.name, gl: e.glAccount, gst: e.gstCode }));
  const costLines: CostLineX[] = claim.lines.map((l) => ({ id: l.id, typeId: l.expenseTypeId, typeName: labelOf(l), net: Math.max(l.actualSgd - l.sponsorSgd, 0) }));
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
            <div><label className="label">Main Country/Region Of Travel</label><input className="field" value={EcsReference.country(req.destCountry ?? '')?.name ?? '—'} disabled /></div>
            <div><label className="label">Travel Class</label><input className="field" value={EcsReference.travelClass(req.travelClassId ?? '')?.name ?? '—'} disabled /></div>
            <div><label className="label">Travel Purpose</label><input className="field" value={EcsReference.travelPurpose(req.purposeId ?? '')?.name ?? '—'} disabled /></div>
            <div><label className="label">Trip Description</label><input className="field" value={req.description ?? '—'} disabled /></div>
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
                      <td className="td font-medium">{labelOf(l)}</td>
                      <td className="td">{canEdit ? <input name={`reason_${l.id}`} defaultValue={l.reason ?? ''} className="field" /> : (l.reason ?? '—')}</td>
                      <td className="td text-right whitespace-nowrap text-[var(--ecs-muted)]">{l.approvedSgd > 0 ? fmtSgd(l.approvedSgd) : '—'}</td>
                      <td className="td text-right">{canEdit ? <input name={`actual_${l.id}`} type="number" step="any" defaultValue={l.actualSgd} className="field text-right w-28 ml-auto" /> : fmtSgd(l.actualSgd)}</td>
                      <td className="td">{canEdit ? (
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
          <div className="mt-4 ml-auto max-w-sm space-y-1.5 text-sm">
            <div className="flex justify-between"><span className="text-[var(--ecs-muted)]">Total expenses</span><span className="font-medium">{fmtSgd(totalExpenses)}</span></div>
            <div className="flex justify-between items-center"><span className="text-[var(--ecs-muted)]">Less NTU Corporate Card</span>{canEdit ? <input name="lessCorpCard" type="number" step="any" defaultValue={claim.lessCorpCard} className="field text-right w-28" /> : <span>{fmtSgd(claim.lessCorpCard)}</span>}</div>
            <div className="flex justify-between items-center"><span className="text-[var(--ecs-muted)]">Less Personal / Sponsorship</span>{canEdit ? <input name="lessPersonal" type="number" step="any" defaultValue={claim.lessPersonal} className="field text-right w-28" /> : <span>{fmtSgd(claim.lessPersonal)}</span>}</div>
            <div className="flex justify-between border-t border-[var(--ecs-border)] pt-1.5 font-bold text-[var(--ecs-navy)]"><span>Total Reimbursable Amount</span><span>{fmtSgd(totalReimbursable)}</span></div>
          </div>
          {canEdit && <div className="flex justify-end mt-4"><button type="submit" className="btn-secondary">Save draft</button></div>}
        </Card>
      </form>

      {/* Charging — reused ECS cascade + Accounting Entries */}
      <ChargingAccountEditor
        action={saveClaimCharging.bind(null, id)}
        canEdit={canEdit}
        total={totalReimbursable}
        companyCodes={companyCodes.map((c) => ({ code: c.code, name: c.name }))}
        businessAreas={businessAreas.map((b) => ({ code: b.code, name: b.name, companyCode: b.companyCode }))}
        accounts={accounts}
        expenseTypes={etOpts}
        lines={costLines}
        defaultAccount={defaultAccount}
        initialMode={initialMode}
        initialMain={claim.chargingMainCode ?? defaultAccount}
        initialRows={initialRows}
        initialLineMap={initialLineMap}
        submitLabel="Save charging"
      />

      <p className="text-xs text-[var(--ecs-muted)]">Approved estimates remain traceable; edits are recorded as actual values/variances rather than overwriting the approved request (§8.3). One approved request may link to multiple claims; cumulative claimed amounts compare against the approved estimate (AC17).</p>
    </div>
  );
}
