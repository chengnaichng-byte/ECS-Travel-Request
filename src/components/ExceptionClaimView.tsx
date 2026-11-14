// Exception TE claim — a claim raised DIRECTLY on the claim side with no Pre-Trip Travel Request
// (requestId null, noTrException true). There is no TR to pre-populate from, so every header field and
// every expense line is entered manually; the "Booking not made on NTU's TRS" checkbox sits next to the
// "No pre-trip Travel Request (exception)" marker. Travel booking reference is NOT required; a reason for
// the missing TR IS required. It bypasses pre-trip approval, so on submit it routes for full approval
// (Verifier → Exception → RO → DOA, no auto-grant) — see buildExceptionClaimRoute.
import Link from 'next/link';
import { prisma } from '@/shared/db';
import { updateClaimHeader, submitClaim, addClaimExpense, removeClaimExpense, updateClaimExpenseLine, saveClaimCharging, deleteClaim, removeClaimAttachment, linkClaimToRequest } from '@/modules/te/actions';
import { ClaimOrigin } from '@/components/ClaimOrigin';
import { EcsIdentity, EcsReference, EcsTravelClassRegister } from '@/shared/ecs/services';
import { fmtSgd } from '@/modules/te/prepopulate';
import { chargingCodes, companyCodes, businessAreas } from '@/data/charging';
import { expenseTypes } from '@/data/expenseTypes';
import { currencies } from '@/data/fxRates';
import { employees } from '@/data/employees';
import { travelClasses } from '@/data/travelClass';
import { CLAIM_STATUS, APPROVER_ROLE, EXPENSE_CATEGORY, REQUEST_STATUS } from '@/shared/enums';
import { ChargingAccountEditor, type AccountOpt, type CostLineX } from '@/components/ChargingAccountEditor';
import { AddExpenseModal } from '@/components/AddExpenseModal';
import { EditExpenseModal } from '@/components/EditExpenseModal';
import { ViewExpenseModal, type ExpenseView } from '@/components/ViewExpenseModal';
import { CtaDetailModal } from '@/components/CtaDetailModal';
import { ClaimDecisionBar } from '@/components/ClaimDecisionBar';
import { Card, Empty } from '@/components/ui';

const ROLE_LABEL: Record<string, string> = { [APPROVER_ROLE.Verifier]: 'Verifier', [APPROVER_ROLE.Exception]: 'Exception Approver', [APPROVER_ROLE.RO]: 'RO', [APPROVER_ROLE.DOA]: 'DOA' };
const RECEIPT: Record<string, string> = { LOCAL_GST: 'Local (With GST)', FOREIGN_NO_GST: 'Foreign / No GST', NO_RECEIPT: 'No receipt' };
const d = (x: Date | null) => (x ? x.toISOString().slice(0, 10) : '');

type ClaimLine = { id: string; category: string | null; expenseTypeId: string; actualSgd: number; approvedSgd: number; sponsorSgd: number; reason: string | null; receiptType: string; currency: string; foreignAmount: number | null; transactionDate: Date | null; manualEntry: boolean; policyJustification: string | null; chargingCode: string | null; allocJson: string | null; attachments?: { id: string; docType: string; fileName: string; contentType: string | null }[] };
type ApprovalStep = { seq: number; roleType: string; approverId: string | null; status: string; comments: string | null };
type ExceptionClaim = {
  id: string; claimNumber: string; status: string; claimantId: string;
  noTrReason: string | null; exPurpose: string | null; exDestination: string | null; exTravelClass: string | null; exDescription: string | null; exBookingRef: string | null;
  trsNotBooked: boolean; travelStart: Date | null; travelEnd: Date | null; lessCorpCard: number; lessPersonal: number;
  additionalApprover1: string | null; additionalApprover2: string | null;
  chargingMode: string; chargingMainCode: string | null; chargingJson: string | null; lines: ClaimLine[]; approvalSteps: ApprovalStep[];
  attachments: { id: string; docType: string; fileName: string; sizeKb: number }[];
};

export async function ExceptionClaimView({ claim, persona }: { claim: ExceptionClaim; persona: string }) {
  const emp = EcsIdentity.employee(claim.claimantId);
  const ro = EcsIdentity.employee(emp?.reportingOfficerId ?? '');
  const canEdit = claim.status === CLAIM_STATUS.Draft || claim.status === CLAIM_STATUS.SentBack;
  // Offline-approval email attachments (mandatory before submit — there was no pre-trip TR approval).
  const evidence = claim.attachments.filter((a) => a.docType === 'OFFLINE_APPROVAL_EVIDENCE');
  // Travel Booking Reference — an exception claim has no TR/TA, so the TMC feed has nothing to pull; the
  // claimant enters the reference(s)/PNR(s) manually (optional), comma-separated for several. Rendered in
  // the same pipe style as the TR claim, collapsing to "…and more" beyond two.
  const exRefs = (claim.exBookingRef ?? '').split(/[,;|]/).map((s) => s.trim()).filter(Boolean);
  const exRefParts = exRefs.length <= 2 ? exRefs : [exRefs[0], exRefs[1], '…and more'];
  // Approved Travel Requests this claimant could LINK (untick "No pre-trip TR" → pick one → pre-populate).
  const approvedTrs = await prisma.travelRequest.findMany({
    where: { status: REQUEST_STATUS.Approved, travellerId: claim.claimantId },
    select: { id: true, requestNumber: true, authorisationNo: true, destCity: true, destCountry: true, startDate: true, endDate: true },
    orderBy: { startDate: 'desc' }, take: 25,
  });
  const linkableTrs = approvedTrs.map((t) => ({ id: t.id, label: `${t.requestNumber}${t.authorisationNo ? ` · ${t.authorisationNo}` : ''} — ${EcsReference.city(t.destCity ?? '')?.name ?? EcsReference.country(t.destCountry ?? '')?.name ?? t.destCity ?? '—'} (${d(t.startDate)} → ${d(t.endDate)})` }));
  // §13.19 Travel class on an exception claim — there is no pre-trip TR, so nothing was PLANNED (greyed).
  // The two live datapoints are the ENTITLEMENT (derived from the traveller's policy group) and the
  // HIGHEST CLASS BOOKED, which the claimant selects (there is no TMC feed to report it).
  const entitledClassId = EcsTravelClassRegister.entitledForItinerary(claim.claimantId, [], claim.travelStart ?? new Date()).classId;
  const entitledClassName = EcsReference.travelClass(entitledClassId)?.name ?? 'Economy';
  const canSubmit = canEdit && (persona === claim.claimantId || EcsIdentity.hasRole(persona, 'TRAVEL_ADMIN'));
  const pendingStep = claim.approvalSteps.find((s) => s.status === 'Pending');
  const canAct = !!pendingStep && (pendingStep.approverId === persona || EcsIdentity.hasRole(persona, 'TRAVEL_ADMIN') || EcsIdentity.hasRole(persona, 'SYSTEM_ADMIN'));

  const labelOf = (l: ClaimLine) => EcsReference.expenseType(l.expenseTypeId)?.name ?? l.category ?? l.expenseTypeId;
  const totalExpenses = claim.lines.reduce((s, l) => s + l.actualSgd, 0);
  const totalApproved = claim.lines.reduce((s, l) => s + l.approvedSgd, 0);
  const totalReimbursable = Math.max(totalExpenses - claim.lessCorpCard - claim.lessPersonal, 0);
  const expenseView = (l: ClaimLine): ExpenseView => {
    const et = EcsReference.expenseType(l.expenseTypeId);
    const gstRatePct = et?.taxRatePct ?? 0;
    const gstAmount = gstRatePct > 0 ? Math.round((l.actualSgd * gstRatePct / (100 + gstRatePct)) * 100) / 100 : 0;
    const rec = l.attachments?.find((a) => a.docType === 'RECEIPT');
    return { label: labelOf(l), date: d(l.transactionDate), isRef: false, manualEntry: true, receiptRequired: l.category !== EXPENSE_CATEGORY.ODA, approvedSgd: 0, actualSgd: l.actualSgd, reason: l.reason ?? '', receiptType: l.receiptType, currency: l.currency, foreignAmount: l.foreignAmount, sponsorSgd: l.sponsorSgd, paymentCtc: false, gstCode: et?.gstCode ?? '—', gstRatePct, gstAmount, baseAmount: Math.round((l.actualSgd - gstAmount) * 100) / 100, exchangeRate: l.foreignAmount && l.foreignAmount > 0 ? Math.round((l.actualSgd / l.foreignAmount) * 100000) / 100000 : 1, receipt: rec ? { fileName: rec.fileName, href: `/claims/${claim.id}/attachments/${rec.id}`, contentType: rec.contentType } : null };
  };
  // Same NEW-datapoint chip as the TR claim; the TR-derived columns (Approved est., policy sync) carry
  // no data on an exception claim, so they render greyed "—".
  const newTag = () => <span className="ml-2 inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-wide align-middle" style={{ background: '#e1f5ee', color: '#0f6e56', border: '1px solid #a7dcc6' }}>NEW</span>;
  const dash = <span className="text-[var(--ecs-muted)]">—</span>;

  const accounts: AccountOpt[] = chargingCodes.map((c) => ({ code: c.code, name: c.name, type: c.type, companyCode: c.companyCode, businessArea: c.businessArea, research: c.isResearch, crossCharge: !!c.crossCharge, closed: c.active === false }));
  const etOpts = expenseTypes.map((e) => ({ id: e.id, name: e.name, gl: e.glAccount, gst: e.gstCode }));
  // Full ECS datapoint options for the Add / Edit expense modals (GST code + rate drive the derived GST block).
  const etModalOpts = expenseTypes.map((e) => ({ id: e.id, name: e.name, gstCode: e.gstCode, taxRatePct: e.taxRatePct }));
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
          <div className="mb-4 pb-4 border-b border-[var(--ecs-border)]">
            <ClaimOrigin mode="claimSide" canEdit={canEdit} trsNotBooked={claim.trsNotBooked} noTrReason={claim.noTrReason ?? ''}
              evidence={evidence.map((a) => ({ id: a.id, fileName: a.fileName, sizeKb: a.sizeKb, href: `/claims/${claim.id}/attachments/${a.id}`, remove: removeClaimAttachment.bind(null, claim.id, a.id) }))}
              exBookingRef={claim.exBookingRef ?? ''} linkableTrs={linkableTrs} linkAction={linkClaimToRequest.bind(null, claim.id)} />
          </div>
          <div className="grid md:grid-cols-3 gap-4">
            <div><label className="label">Travel Booking Reference <span className="text-[var(--ecs-muted)] font-normal">(optional)</span></label><input name="exBookingRef" defaultValue={claim.exBookingRef ?? ''} disabled={!canEdit} className="field" placeholder="PNR / e-ticket — separate multiple PNRs with a comma" /></div>
            <div><label className="label">Main Country / Region of Travel</label><input name="exDestination" defaultValue={claim.exDestination ?? ''} disabled={!canEdit} className="field" placeholder="e.g. United Kingdom · London" /></div>
            <div>
              <label className="label">Travel Entitlement | Class Planned | Highest Class Booked {newTag()}</label>
              <div className="field" style={{ background: 'var(--ecs-readonly)', minHeight: '2.375rem', display: 'flex', alignItems: 'center', flexWrap: 'wrap', columnGap: '0.5rem', rowGap: '0.25rem' }}
                title="Entitled cabin (policy group)  |  nothing planned — no pre-trip TR  |  highest cabin booked (you select)">
                <span>{entitledClassName}</span>
                <span className="text-[var(--ecs-border)]">|</span>
                <span className="text-[var(--ecs-muted)]">—</span>
                <span className="text-[var(--ecs-border)]">|</span>
                <select name="exTravelClass" defaultValue={claim.exTravelClass ?? ''} disabled={!canEdit}
                  className="border border-[var(--ecs-border)] rounded bg-white text-sm px-2 py-1 outline-none focus:border-[var(--ecs-navy)] focus:ring-1 focus:ring-[var(--ecs-navy)] disabled:opacity-70">
                  <option value="">Select…</option>{travelClasses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div className="text-[10px] text-[var(--ecs-muted)] mt-1">Policy group · n/a (no pre-trip TR) · you select the highest cabin booked</div>
            </div>
            <div><label className="label">Travel Purpose</label><input name="exPurpose" defaultValue={claim.exPurpose ?? ''} disabled={!canEdit} className="field" placeholder="e.g. Conference / fieldwork" /></div>
            <div><label className="label">Trip Description</label><input name="exDescription" defaultValue={claim.exDescription ?? ''} disabled={!canEdit} className="field" /></div>
            <div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="label">Travel Start Date</label><input type="date" name="travelStart" defaultValue={d(claim.travelStart)} disabled={!canEdit} className="field" /></div>
                <div><label className="label">Travel End Date</label><input type="date" name="travelEnd" defaultValue={d(claim.travelEnd)} disabled={!canEdit} className="field" /></div>
              </div>
            </div>
          </div>
        </Card>

        <Card title={`Expense items (${claim.lines.length})`} actions={canEdit ? <AddExpenseModal action={addClaimExpense.bind(null, claim.id)} expenseTypes={etModalOpts} currencies={currencies} /> : undefined}>
          {claim.lines.length === 0 ? <Empty>No expense items — add every cost incurred on this trip.</Empty> : (
            <div className="overflow-x-auto">
              {/* Same ECS column set as a TR-based claim. The TR-derived columns (Approved est. and the
                  policy-exception sync) have no data on an exception claim, so they render greyed "—". */}
              <table className="text-sm" style={{ tableLayout: 'fixed', width: 'calc(100% + 860px)' }}>
                <colgroup>
                  <col /><col style={{ width: 40 }} /><col /><col /><col style={{ width: 190 }} /><col /><col /><col style={{ width: 68 }} /><col /><col /><col /><col />
                  <col style={{ width: 130 }} /><col style={{ width: 160 }} /><col style={{ width: 160 }} /><col style={{ width: 150 }} /><col style={{ width: 110 }} /><col style={{ width: 150 }} />
                </colgroup>
                <thead><tr>
                  <th className="th">Actions</th>
                  <th className="th"><input type="checkbox" disabled className="w-4 h-4 align-middle" title="Select for allocation" /></th>
                  <th className="th">Transaction date</th><th className="th">Expense type</th>
                  <th className="th">Reason for expense</th>
                  <th className="th text-right">Expense amount (SGD)</th>
                  <th className="th text-right" style={{ background: '#f0faf5' }}>Approved est. {newTag()}</th>
                  <th className="th text-center">Policy violation</th><th className="th text-right">Policy limit per unit</th><th className="th text-right">Total amount exceeded limit</th><th className="th text-right">% Exceeded</th><th className="th">Justification for policy violation</th>
                  <th className="th">Verifier verify status</th><th className="th">Verifier rejection reason</th><th className="th">Verifier comment</th>
                  <th className="th">Attachment</th><th className="th">Is duplicated?</th><th className="th">Send back history</th>
                </tr></thead>
                <tbody>
                  {claim.lines.map((l) => (
                    <tr key={l.id} className="hover:bg-[var(--ecs-panel-2)]">
                      <td className="td">
                        <div className="flex items-center gap-0.5">
                          <ViewExpenseModal e={expenseView(l)} />
                          {canEdit && (() => {
                            const rec = l.attachments?.find((a) => a.docType === 'RECEIPT');
                            return <EditExpenseModal action={updateClaimExpenseLine.bind(null, claim.id, l.id)} removeReceipt={rec ? removeClaimAttachment.bind(null, claim.id, rec.id) : undefined} expenseTypes={etModalOpts} currencies={currencies} line={{ expenseTypeId: l.expenseTypeId, label: labelOf(l), manualEntry: l.manualEntry, receiptRequired: l.category !== EXPENSE_CATEGORY.ODA, transactionDate: d(l.transactionDate), currency: l.currency, foreignAmount: l.foreignAmount, actualSgd: l.actualSgd, sponsorSgd: l.sponsorSgd, receiptType: l.receiptType, reason: l.reason ?? '', receipt: rec ? { id: rec.id, fileName: rec.fileName, href: `/claims/${claim.id}/attachments/${rec.id}` } : null }} />;
                          })()}
                          {canEdit && <button formAction={removeClaimExpense.bind(null, claim.id, l.id)} title="Remove line" className={`${iconBtn} hover:bg-red-50 text-[var(--ecs-red)]`}><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg></button>}
                        </div>
                      </td>
                      <td className="td"><input type="checkbox" disabled className="w-4 h-4" /></td>
                      <td className="td whitespace-nowrap">{d(l.transactionDate) || '—'}</td>
                      <td className="td font-medium">{labelOf(l)}</td>
                      <td className="td">{canEdit ? <input key={`reason_${l.id}`} name={`reason_${l.id}`} defaultValue={l.reason ?? ''} className="field" /> : (l.reason ?? '—')}</td>
                      <td className="td text-right whitespace-nowrap">{canEdit ? <input key={`actual_${l.id}`} name={`actual_${l.id}`} type="number" step="any" defaultValue={l.actualSgd} className="field text-right" /> : fmtSgd(l.actualSgd)}</td>
                      <td className="td text-right whitespace-nowrap text-[var(--ecs-muted)]" style={{ background: '#f0faf5' }}>—</td>
                      <td className="td text-center">{dash}</td>
                      <td className="td text-right">{dash}</td>
                      <td className="td text-right">{dash}</td>
                      <td className="td text-right">{dash}</td>
                      <td className="td">{canEdit ? <input name={`polJust_${l.id}`} defaultValue={l.policyJustification ?? ''} className="field" placeholder="—" /> : (l.policyJustification ?? '—')}</td>
                      <td className="td">{dash}</td>
                      <td className="td">{dash}</td>
                      <td className="td">{dash}</td>
                      <td className="td">{canEdit ? (
                        <select name={`receipt_${l.id}`} defaultValue={l.receiptType} className="field">
                          {Object.entries(RECEIPT).map(([v, lab]) => <option key={v} value={v}>{lab}</option>)}
                        </select>
                      ) : RECEIPT[l.receiptType] ?? l.receiptType}</td>
                      <td className="td text-center">{dash}</td>
                      <td className="td whitespace-nowrap">{dash}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={5} className="td text-right text-[var(--ecs-muted)]">Total expenses (all lines)</td>
                    <td className="td text-right font-medium whitespace-nowrap">{fmtSgd(totalExpenses)}</td>
                    <td className="td text-right font-medium whitespace-nowrap text-[var(--ecs-muted)]" style={{ background: '#f0faf5' }}>{totalApproved > 0 ? fmtSgd(totalApproved) : '—'}</td>
                    <td colSpan={11}></td>
                  </tr>
                  <tr>
                    <td colSpan={5} className="td text-right text-[var(--ecs-muted)]"><span className="inline-flex items-center justify-end">Less: charges paid by CTA — reference only<CtaDetailModal total={0} account={null} lines={[]} /></span></td>
                    <td className="td text-right text-[var(--ecs-muted)] whitespace-nowrap">− {fmtSgd(0)}</td>
                    <td colSpan={12}></td>
                  </tr>
                  <tr>
                    <td colSpan={5} className="td text-right text-[var(--ecs-muted)]">Less NTU Corporate Travel Card (other)</td>
                    <td className="td text-right">{canEdit ? <input name="lessCorpCard" type="number" step="any" defaultValue={claim.lessCorpCard} className="field text-right" /> : fmtSgd(claim.lessCorpCard)}</td>
                    <td colSpan={12}></td>
                  </tr>
                  <tr>
                    <td colSpan={5} className="td text-right text-[var(--ecs-muted)]">Less Personal / Sponsorship</td>
                    <td className="td text-right">{canEdit ? <input name="lessPersonal" type="number" step="any" defaultValue={claim.lessPersonal} className="field text-right" /> : fmtSgd(claim.lessPersonal)}</td>
                    <td colSpan={12}></td>
                  </tr>
                  <tr>
                    <td colSpan={5} className="td text-right font-bold text-[var(--ecs-navy)] border-t-2 border-[var(--ecs-border)]">Total Reimbursable Amount</td>
                    <td className="td text-right font-bold text-[var(--ecs-navy)] border-t-2 border-[var(--ecs-border)] whitespace-nowrap">{fmtSgd(totalReimbursable)}</td>
                    <td colSpan={12}></td>
                  </tr>
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
