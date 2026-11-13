// Exception TE claim — a claim raised DIRECTLY on the claim side with no Pre-Trip Travel Request
// (requestId null, noTrException true). There is no TR to pre-populate from, so every header field and
// every expense line is entered manually; the "Booking not made on NTU's TRS" checkbox sits next to the
// "No pre-trip Travel Request (exception)" marker. Travel booking reference is NOT required; a reason for
// the missing TR IS required. It bypasses pre-trip approval, so on submit it routes for full approval
// (Verifier → Exception → RO → DOA, no auto-grant) — see buildExceptionClaimRoute.
import Link from 'next/link';
import { updateClaimHeader, submitClaim, addClaimExpense, removeClaimExpense, updateClaimExpenseLine, saveClaimCharging, deleteClaim } from '@/modules/te/actions';
import { EcsIdentity, EcsReference } from '@/shared/ecs/services';
import { fmtSgd } from '@/modules/te/prepopulate';
import { chargingCodes, companyCodes, businessAreas } from '@/data/charging';
import { expenseTypes } from '@/data/expenseTypes';
import { currencies } from '@/data/fxRates';
import { travelClasses } from '@/data/travelClass';
import { CLAIM_STATUS, APPROVER_ROLE } from '@/shared/enums';
import { ChargingAccountEditor, type AccountOpt, type CostLineX } from '@/components/ChargingAccountEditor';
import { AddExpenseModal } from '@/components/AddExpenseModal';
import { EditExpenseModal } from '@/components/EditExpenseModal';
import { ViewExpenseModal, type ExpenseView } from '@/components/ViewExpenseModal';
import { ClaimDecisionBar } from '@/components/ClaimDecisionBar';
import { Card, Empty } from '@/components/ui';

const ROLE_LABEL: Record<string, string> = { [APPROVER_ROLE.Verifier]: 'Verifier', [APPROVER_ROLE.Exception]: 'Exception Approver', [APPROVER_ROLE.RO]: 'RO', [APPROVER_ROLE.DOA]: 'DOA' };
const RECEIPT: Record<string, string> = { LOCAL_GST: 'Local (With GST)', FOREIGN_NO_GST: 'Foreign / No GST', NO_RECEIPT: 'No receipt' };
const d = (x: Date | null) => (x ? x.toISOString().slice(0, 10) : '');

type ClaimLine = { id: string; category: string | null; expenseTypeId: string; actualSgd: number; approvedSgd: number; sponsorSgd: number; reason: string | null; receiptType: string; currency: string; foreignAmount: number | null; transactionDate: Date | null; manualEntry: boolean; chargingCode: string | null; allocJson: string | null };
type ApprovalStep = { seq: number; roleType: string; approverId: string | null; status: string; comments: string | null };
type ExceptionClaim = {
  id: string; claimNumber: string; status: string; claimantId: string;
  noTrReason: string | null; exPurpose: string | null; exDestination: string | null; exTravelClass: string | null; exDescription: string | null; exBookingRef: string | null;
  trsNotBooked: boolean; travelStart: Date | null; travelEnd: Date | null; lessCorpCard: number; lessPersonal: number;
  chargingMode: string; chargingMainCode: string | null; chargingJson: string | null; lines: ClaimLine[]; approvalSteps: ApprovalStep[];
};

export async function ExceptionClaimView({ claim, persona }: { claim: ExceptionClaim; persona: string }) {
  const emp = EcsIdentity.employee(claim.claimantId);
  const canEdit = claim.status === CLAIM_STATUS.Draft || claim.status === CLAIM_STATUS.SentBack;
  const canSubmit = canEdit && (persona === claim.claimantId || EcsIdentity.hasRole(persona, 'TRAVEL_ADMIN'));
  const pendingStep = claim.approvalSteps.find((s) => s.status === 'Pending');
  const canAct = !!pendingStep && (pendingStep.approverId === persona || EcsIdentity.hasRole(persona, 'TRAVEL_ADMIN') || EcsIdentity.hasRole(persona, 'SYSTEM_ADMIN'));

  const labelOf = (l: ClaimLine) => EcsReference.expenseType(l.expenseTypeId)?.name ?? l.category ?? l.expenseTypeId;
  const totalExpenses = claim.lines.reduce((s, l) => s + l.actualSgd, 0);
  const totalReimbursable = Math.max(totalExpenses - claim.lessCorpCard - claim.lessPersonal, 0);
  const expenseView = (l: ClaimLine): ExpenseView => ({ label: labelOf(l), date: d(l.transactionDate), isRef: false, approvedSgd: 0, actualSgd: l.actualSgd, reason: l.reason ?? '', receipt: RECEIPT[l.receiptType] ?? l.receiptType, currency: l.currency, foreignAmount: l.foreignAmount, sponsorSgd: l.sponsorSgd });

  const accounts: AccountOpt[] = chargingCodes.map((c) => ({ code: c.code, name: c.name, type: c.type, companyCode: c.companyCode, businessArea: c.businessArea, research: c.isResearch, crossCharge: !!c.crossCharge, closed: c.active === false }));
  const etOpts = expenseTypes.map((e) => ({ id: e.id, name: e.name, gl: e.glAccount, gst: e.gstCode }));
  const cj: { rows: { code: string; percent: number; io: string; isMain: boolean }[] } = claim.chargingJson ? JSON.parse(claim.chargingJson) : { rows: [] };
  const defaultAccount = emp?.defaultChargingCode ?? chargingCodes[0]?.code ?? '';
  const claimInitialAllocs = (l: ClaimLine) => {
    if (l.allocJson) { try { const a = JSON.parse(l.allocJson); if (Array.isArray(a) && a.length) return a.map((x: { code: string; pct: number; io?: string }) => ({ code: x.code, pct: Number(x.pct), io: x.io || '' })); } catch { /* ignore */ } }
    return l.chargingCode ? [{ code: l.chargingCode, pct: 100, io: '' }] : undefined;
  };
  // A line with no actual (0) is not posted — exclude it from the Accounting Entries.
  const costLines: CostLineX[] = claim.lines.filter((l) => Math.max(l.actualSgd - l.sponsorSgd, 0) > 0.005)
    .map((l) => ({ id: l.id, typeId: l.expenseTypeId, typeName: labelOf(l), net: Math.max(l.actualSgd - l.sponsorSgd, 0), category: l.category ?? l.expenseTypeId, isShared: false, deptAllocs: [], initialAllocs: claimInitialAllocs(l) }));
  const initialRows = cj.rows.map((r) => ({ ba: chargingCodes.find((c) => c.code === r.code)?.businessArea ?? '', code: r.code, io: r.io ?? '', pct: r.percent }));
  const initialLineMap: Record<string, string> = {};
  for (const l of claim.lines) if (l.chargingCode) initialLineMap[l.id] = l.chargingCode;
  const initialMode = (claim.chargingMode === 'ITEM' || claim.chargingMode === 'CLAIM' ? claim.chargingMode : 'MAIN') as 'MAIN' | 'CLAIM' | 'ITEM';

  const iconBtn = 'inline-grid place-items-center w-7 h-7 rounded hover:bg-[var(--ecs-panel-2)] text-[var(--ecs-navy-2)]';

  return (
    <div className="w-full space-y-5">
      <div className="flex flex-wrap items-center gap-3 border-b border-[var(--ecs-border)] pb-3">
        <h1 className="text-xl font-bold text-[var(--ecs-navy)]">Travel Expense Claim <span className="text-[var(--ecs-muted)] font-normal">· {claim.claimNumber}</span></h1>
        <span className="pill-exc" title="Raised on the claim side with no Pre-Trip Travel Request">Exception · no TR</span>
        <span className={claim.status === CLAIM_STATUS.Approved ? 'pill-pass' : claim.status === CLAIM_STATUS.SentBack ? 'pill-exc' : claim.status.startsWith('Pending') ? 'pill-warn' : 'pill-info'}>{claim.status}</span>
        <div className="ml-auto flex items-center gap-3 text-sm">
          <Link href="/claims" className="btn-ghost">← My claims</Link>
          {canSubmit && <form action={submitClaim.bind(null, claim.id)}><button className="btn-primary">Submit</button></form>}
          {canAct && <ClaimDecisionBar claimId={claim.id} roleLabel={ROLE_LABEL[pendingStep!.roleType] ?? pendingStep!.roleType} />}
          {canEdit && <form action={deleteClaim.bind(null, claim.id)}><button className="btn-ghost text-[var(--ecs-red)]">Delete</button></form>}
        </div>
      </div>
      <div className="card p-3 text-sm bg-amber-50 border-amber-200 text-amber-900 -mt-2">
        <strong>Exception claim — no pre-trip Travel Request.</strong> Everything is entered manually. This claim did not go through pre-trip approval, so on submit it routes for <strong>full approval</strong> (Verifier → Exception Approver → RO → DOA, nothing auto-granted). A reason for the missing TR is required.
      </div>

      {claim.approvalSteps.length > 0 && (
        <Card title="Approval route">
          <ol className="text-sm space-y-1">
            {claim.approvalSteps.map((s) => (
              <li key={s.seq} className="flex items-center gap-2">
                <span className="text-[var(--ecs-muted)] w-6">{s.seq}.</span>
                <span className="font-medium w-40">{ROLE_LABEL[s.roleType] ?? s.roleType}</span>
                <span className="text-[var(--ecs-muted)]">{EcsIdentity.employee(s.approverId ?? '')?.name ?? '—'}</span>
                <span className={`ml-auto ${s.status === 'Approved' ? 'pill-pass' : s.status === 'Pending' ? 'pill-warn' : s.status === 'SentBack' ? 'pill-exc' : 'pill-info'}`}>{s.status}</span>
              </li>
            ))}
          </ol>
        </Card>
      )}

      <form action={updateClaimHeader.bind(null, claim.id)} className="space-y-5">
        <Card title="Travel booking details">
          <div className="flex flex-wrap gap-x-8 gap-y-2 mb-4">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="trsNotBooked" defaultChecked={claim.trsNotBooked} disabled={!canEdit} className="w-4 h-4" />
              Booking not made on NTU&apos;s Travel Reservation System (TRS)
            </label>
            <label className="flex items-center gap-2 text-sm text-[var(--ecs-navy)]" title="This claim was raised directly on the claim side with no Pre-Trip Travel Request. It can only be created from the claim side.">
              <input type="checkbox" checked readOnly disabled className="w-4 h-4" />
              <span className="font-medium">No pre-trip Travel Request (exception)</span>
            </label>
          </div>
          <div className="grid md:grid-cols-3 gap-4">
            <div><label className="label">Employee Name</label><input className="field bg-[var(--ecs-readonly,#f1f1f6)]" value={emp?.name ?? claim.claimantId} disabled /></div>
            <div><label className="label">Travel Booking Reference <span className="text-[var(--ecs-muted)] font-normal">(optional)</span></label><input name="exBookingRef" defaultValue={claim.exBookingRef ?? ''} disabled={!canEdit} className="field" placeholder="PNR / ticket — if any" /></div>
            <div><label className="label">Travel Class</label>
              <select name="exTravelClass" defaultValue={claim.exTravelClass ?? ''} disabled={!canEdit} className="field">
                <option value="">Select…</option>{travelClasses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div><label className="label">Travel Purpose</label><input name="exPurpose" defaultValue={claim.exPurpose ?? ''} disabled={!canEdit} className="field" placeholder="e.g. Conference / fieldwork" /></div>
            <div><label className="label">Main Country / Region of Travel</label><input name="exDestination" defaultValue={claim.exDestination ?? ''} disabled={!canEdit} className="field" placeholder="e.g. United Kingdom · London" /></div>
            <div><label className="label">Travel Start Date</label><input type="date" name="travelStart" defaultValue={d(claim.travelStart)} disabled={!canEdit} className="field" /></div>
            <div><label className="label">Travel End Date</label><input type="date" name="travelEnd" defaultValue={d(claim.travelEnd)} disabled={!canEdit} className="field" /></div>
            <div className="md:col-span-3"><label className="label">Trip Description</label><input name="exDescription" defaultValue={claim.exDescription ?? ''} disabled={!canEdit} className="field" /></div>
            <div className="md:col-span-3">
              <label className="label text-amber-800">Reason for no Travel Request <span className="text-[var(--ecs-red)]">* required</span></label>
              <textarea name="noTrReason" defaultValue={claim.noTrReason ?? ''} disabled={!canEdit} rows={2} className="field" placeholder="Why was this trip not raised as a pre-trip Travel Request? (e.g. emergency / short-notice travel)" />
            </div>
          </div>
        </Card>

        <Card title={`Expense items (${claim.lines.length})`} actions={canEdit ? <AddExpenseModal action={addClaimExpense.bind(null, claim.id)} expenseTypes={expenseTypes.map((e) => ({ id: e.id, name: e.name }))} currencies={currencies} /> : undefined}>
          {claim.lines.length === 0 ? <Empty>No expense items — add every cost incurred on this trip.</Empty> : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr>
                  <th className="th">Actions</th><th className="th whitespace-nowrap">Transaction date</th><th className="th">Expense type</th><th className="th">Reason for expense</th>
                  <th className="th text-right whitespace-nowrap">Expense amount (SGD)</th><th className="th">Receipt</th>
                </tr></thead>
                <tbody>
                  {claim.lines.map((l) => (
                    <tr key={l.id} className="hover:bg-[var(--ecs-panel-2)]">
                      <td className="td">
                        <div className="flex items-center gap-0.5">
                          <ViewExpenseModal e={expenseView(l)} />
                          {canEdit && <EditExpenseModal action={updateClaimExpenseLine.bind(null, claim.id, l.id)} expenseTypes={expenseTypes.map((e) => ({ id: e.id, name: e.name }))} currencies={currencies} line={{ expenseTypeId: l.expenseTypeId, label: labelOf(l), manualEntry: l.manualEntry, transactionDate: d(l.transactionDate), currency: l.currency, actualSgd: l.actualSgd, sponsorSgd: l.sponsorSgd, receiptType: l.receiptType, reason: l.reason ?? '' }} />}
                          {canEdit && <button formAction={removeClaimExpense.bind(null, claim.id, l.id)} title="Remove line" className={`${iconBtn} hover:bg-red-50 text-[var(--ecs-red)]`}><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg></button>}
                        </div>
                      </td>
                      <td className="td whitespace-nowrap">{d(l.transactionDate) || '—'}</td>
                      <td className="td font-medium">{labelOf(l)}</td>
                      <td className="td">{canEdit ? <input key={`reason_${l.id}`} name={`reason_${l.id}`} defaultValue={l.reason ?? ''} className="field" /> : (l.reason ?? '—')}</td>
                      <td className="td text-right whitespace-nowrap">{canEdit ? <input key={`actual_${l.id}`} name={`actual_${l.id}`} type="number" step="any" defaultValue={l.actualSgd} className="field text-right w-28 ml-auto" /> : fmtSgd(l.actualSgd)}</td>
                      <td className="td">{canEdit ? (
                        <select name={`receipt_${l.id}`} defaultValue={l.receiptType} className="field">
                          {Object.entries(RECEIPT).map(([v, lab]) => <option key={v} value={v}>{lab}</option>)}
                        </select>
                      ) : RECEIPT[l.receiptType] ?? l.receiptType}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr><td colSpan={3} className="td text-right text-[var(--ecs-muted)]">Total expenses</td><td className="td"></td><td className="td text-right font-medium whitespace-nowrap">{fmtSgd(totalExpenses)}</td><td className="td"></td></tr>
                  <tr><td colSpan={3} className="td text-right text-[var(--ecs-muted)]">Less NTU Corporate Card (other)</td><td className="td"></td><td className="td text-right">{canEdit ? <input name="lessCorpCard" type="number" step="any" defaultValue={claim.lessCorpCard} className="field text-right w-28 ml-auto" /> : fmtSgd(claim.lessCorpCard)}</td><td className="td"></td></tr>
                  <tr><td colSpan={3} className="td text-right text-[var(--ecs-muted)]">Less Personal / Sponsorship</td><td className="td"></td><td className="td text-right">{canEdit ? <input name="lessPersonal" type="number" step="any" defaultValue={claim.lessPersonal} className="field text-right w-28 ml-auto" /> : fmtSgd(claim.lessPersonal)}</td><td className="td"></td></tr>
                  <tr><td colSpan={3} className="td text-right font-bold text-[var(--ecs-navy)] border-t-2 border-[var(--ecs-border)]">Total Reimbursable Amount</td><td className="td border-t-2 border-[var(--ecs-border)]"></td><td className="td text-right font-bold text-[var(--ecs-navy)] border-t-2 border-[var(--ecs-border)] whitespace-nowrap">{fmtSgd(totalReimbursable)}</td><td className="td border-t-2 border-[var(--ecs-border)]"></td></tr>
                </tfoot>
              </table>
            </div>
          )}
          {canEdit && <div className="flex justify-end mt-4"><button type="submit" className="btn-secondary">Save draft</button></div>}
        </Card>
      </form>

      <ChargingAccountEditor
        action={saveClaimCharging.bind(null, claim.id)}
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
    </div>
  );
}
