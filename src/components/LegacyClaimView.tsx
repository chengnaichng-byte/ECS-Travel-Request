// TMC transition — a focused view for a LEGACY expense claim (raised on a pre-go-live TMC PNR with no
// Pre-Trip TR). It has no approved request, so none of the TA-anchored machinery (pre-population,
// funded-basis, M6, booking deviations, DOA auto-grant) applies; the claimant enters the actuals
// against the legacy PNR. Deleting the claim releases the PNR back into the transition picker.
import Link from 'next/link';
import { legacyBookingByPnr } from '@/modules/te/pnrLedger';
import { updateClaimHeader, submitClaim, addClaimExpense, removeClaimExpense, saveClaimCharging, deleteClaim } from '@/modules/te/actions';
import { ClaimOrigin } from '@/components/ClaimOrigin';
import { EcsIdentity, EcsReference } from '@/shared/ecs/services';
import { fmtSgd } from '@/modules/te/prepopulate';
import { chargingCodes, companyCodes, businessAreas } from '@/data/charging';
import { expenseTypes } from '@/data/expenseTypes';
import { currencies } from '@/data/fxRates';
import { CLAIM_STATUS } from '@/shared/enums';
import { ChargingAccountEditor, type AccountOpt, type CostLineX } from '@/components/ChargingAccountEditor';
import { AddExpenseModal } from '@/components/AddExpenseModal';
import { Card, Empty } from '@/components/ui';

const RECEIPT: Record<string, string> = { LOCAL_GST: 'Local (With GST)', FOREIGN_NO_GST: 'Foreign / No GST', NO_RECEIPT: 'No receipt' };
const d = (x: Date | null) => (x ? x.toISOString().slice(0, 10) : '');

type ClaimLine = { id: string; category: string | null; expenseTypeId: string; actualSgd: number; sponsorSgd: number; reason: string | null; receiptType: string; transactionDate: Date | null; chargingCode: string | null; allocJson: string | null };
type LegacyClaim = { id: string; claimNumber: string; status: string; legacyPnr: string | null; claimantId: string; trsNotBooked: boolean; travelStart: Date | null; travelEnd: Date | null; lessCorpCard: number; lessPersonal: number; chargingMode: string; chargingMainCode: string | null; chargingJson: string | null; lines: ClaimLine[] };

export async function LegacyClaimView({ claim, persona }: { claim: LegacyClaim; persona: string }) {
  const booking = claim.legacyPnr ? await legacyBookingByPnr(claim.legacyPnr) : null;
  const emp = EcsIdentity.employee(claim.claimantId);
  const canEdit = claim.status === CLAIM_STATUS.Draft || claim.status === CLAIM_STATUS.SentBack;
  const canSubmit = canEdit && (persona === claim.claimantId || EcsIdentity.hasRole(persona, 'TRAVEL_ADMIN'));

  const labelOf = (l: ClaimLine) => EcsReference.expenseType(l.expenseTypeId)?.name ?? l.category ?? l.expenseTypeId;
  const totalExpenses = claim.lines.reduce((s, l) => s + l.actualSgd, 0);
  const totalReimbursable = Math.max(totalExpenses - claim.lessCorpCard - claim.lessPersonal, 0);

  const accounts: AccountOpt[] = chargingCodes.map((c) => ({ code: c.code, name: c.name, type: c.type, companyCode: c.companyCode, businessArea: c.businessArea, research: c.isResearch, crossCharge: !!c.crossCharge, closed: c.active === false }));
  const etOpts = expenseTypes.map((e) => ({ id: e.id, name: e.name, gl: e.glAccount, gst: e.gstCode }));
  const cj: { rows: { code: string; percent: number; amount: number; io: string; isMain: boolean }[] } = claim.chargingJson ? JSON.parse(claim.chargingJson) : { rows: [] };
  const defaultAccount = emp?.defaultChargingCode ?? chargingCodes[0]?.code ?? '';
  const claimInitialAllocs = (l: ClaimLine) => {
    if (l.allocJson) { try { const a = JSON.parse(l.allocJson); if (Array.isArray(a) && a.length) return a.map((x: { code: string; pct: number; io?: string }) => ({ code: x.code, pct: Number(x.pct), io: x.io || '' })); } catch { /* ignore */ } }
    return l.chargingCode ? [{ code: l.chargingCode, pct: 100, io: '' }] : undefined;
  };
  const costLines: CostLineX[] = claim.lines.map((l) => ({ id: l.id, typeId: l.expenseTypeId, typeName: labelOf(l), net: Math.max(l.actualSgd - l.sponsorSgd, 0), category: l.category ?? l.expenseTypeId, isShared: false, deptAllocs: [], initialAllocs: claimInitialAllocs(l) }));
  const initialRows = cj.rows.map((r) => ({ ba: chargingCodes.find((c) => c.code === r.code)?.businessArea ?? '', code: r.code, io: r.io ?? '', pct: r.percent }));
  const initialLineMap: Record<string, string> = {};
  for (const l of claim.lines) if (l.chargingCode) initialLineMap[l.id] = l.chargingCode;
  const initialMode = (claim.chargingMode === 'ITEM' || claim.chargingMode === 'CLAIM' ? claim.chargingMode : 'MAIN') as 'MAIN' | 'CLAIM' | 'ITEM';

  return (
    <div className="w-full space-y-5">
      <div className="flex flex-wrap items-center gap-3 border-b border-[var(--ecs-border)] pb-3">
        <h1 className="text-xl font-bold text-[var(--ecs-navy)]">Travel Expense Claim <span className="text-[var(--ecs-muted)] font-normal">· {claim.claimNumber}</span></h1>
        <span className="pill-info">Legacy</span>
        <span className={claim.status === CLAIM_STATUS.Approved ? 'pill-pass' : claim.status.startsWith('Pending') ? 'pill-warn' : 'pill-info'}>{claim.status}</span>
        <div className="ml-auto flex items-center gap-3 text-sm">
          <Link href="/claims/transition" className="btn-ghost">← Transition picker</Link>
          {canSubmit && <form action={submitClaim.bind(null, claim.id)}><button className="btn-primary">Submit</button></form>}
          {canEdit && <form action={deleteClaim.bind(null, claim.id)}><button className="btn-ghost text-[var(--ecs-red)]">Delete &amp; release PNR</button></form>}
        </div>
      </div>
      <p className="text-xs text-[var(--ecs-muted)] -mt-2">Legacy claim — raised on a pre-go-live TMC booking with no Pre-Trip request (TMC transition). The claimant enters the actuals; there is no approved estimate to reconcile against.</p>

      <Card title="Legacy travel booking (TMC transition)">
        <div className="mb-4 pb-4 border-b border-[var(--ecs-border)]">
          <ClaimOrigin mode="legacy" canEdit={canEdit} trsNotBooked={claim.trsNotBooked} />
        </div>
        <div className="grid md:grid-cols-4 gap-4">
          <div><label className="label">Legacy PNR</label><input className="field font-mono" value={claim.legacyPnr ?? '—'} disabled /></div>
          <div><label className="label">TMC source</label><input className="field" value={booking?.tmcSource ?? 'Legacy TMC'} disabled /></div>
          <div><label className="label">Traveller (on PNR)</label><input className="field" value={booking?.travellerName ?? emp?.name ?? claim.claimantId} disabled /></div>
          <div><label className="label">Route</label><input className="field" value={booking?.route ?? '—'} disabled /></div>
        </div>
      </Card>

      <form action={updateClaimHeader.bind(null, claim.id)} className="space-y-5">
        <Card title="Employee details">
          <div className="grid md:grid-cols-3 gap-4">
            <div><label className="label">Employee Name</label><input className="field" value={emp?.name ?? claim.claimantId} disabled /></div>
            <div><label className="label">Travel Start Date</label><input type="date" name="travelStart" defaultValue={d(claim.travelStart)} disabled={!canEdit} className="field" /></div>
            <div><label className="label">Travel End Date</label><input type="date" name="travelEnd" defaultValue={d(claim.travelEnd)} disabled={!canEdit} className="field" /></div>
          </div>
        </Card>

        <Card title={`Expense items (${claim.lines.length})`} actions={canEdit ? <AddExpenseModal action={addClaimExpense.bind(null, claim.id)} expenseTypes={expenseTypes.map((e) => ({ id: e.id, name: e.name, gstCode: e.gstCode, taxRatePct: e.taxRatePct }))} currencies={currencies} /> : undefined}>
          {claim.lines.length === 0 ? <Empty>No expense items — add the costs incurred on this trip.</Empty> : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr>
                  <th className="th">Transaction date</th><th className="th">Expense type</th><th className="th">Reason</th>
                  <th className="th text-right">Expense amount (SGD)</th><th className="th">Receipt</th><th className="th"></th>
                </tr></thead>
                <tbody>
                  {claim.lines.map((l) => (
                    <tr key={l.id} className="hover:bg-[var(--ecs-panel-2)]">
                      <td className="td whitespace-nowrap">{d(l.transactionDate) || '—'}</td>
                      <td className="td font-medium">{labelOf(l)}</td>
                      <td className="td">{canEdit ? <input name={`reason_${l.id}`} defaultValue={l.reason ?? ''} className="field" /> : (l.reason ?? '—')}</td>
                      <td className="td text-right">{canEdit ? <input name={`actual_${l.id}`} type="number" step="any" defaultValue={l.actualSgd} className="field text-right w-28 ml-auto" /> : fmtSgd(l.actualSgd)}</td>
                      <td className="td">{canEdit ? (
                        <select name={`receipt_${l.id}`} defaultValue={l.receiptType} className="field">
                          {Object.entries(RECEIPT).map(([v, lab]) => <option key={v} value={v}>{lab}</option>)}
                        </select>
                      ) : RECEIPT[l.receiptType] ?? l.receiptType}</td>
                      <td className="td text-right">{canEdit && <button formAction={removeClaimExpense.bind(null, claim.id, l.id)} className="btn-ghost text-xs">Remove</button>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="mt-4 ml-auto max-w-md space-y-1.5 text-sm">
            <div className="flex justify-between"><span className="text-[var(--ecs-muted)]">Total expenses</span><span className="font-medium">{fmtSgd(totalExpenses)}</span></div>
            <div className="flex justify-between items-center"><span className="text-[var(--ecs-muted)]">Less NTU Corporate Travel Card</span>{canEdit ? <input name="lessCorpCard" type="number" step="any" defaultValue={claim.lessCorpCard} className="field text-right w-28" /> : <span>{fmtSgd(claim.lessCorpCard)}</span>}</div>
            <div className="flex justify-between items-center"><span className="text-[var(--ecs-muted)]">Less Personal / Sponsorship</span>{canEdit ? <input name="lessPersonal" type="number" step="any" defaultValue={claim.lessPersonal} className="field text-right w-28" /> : <span>{fmtSgd(claim.lessPersonal)}</span>}</div>
            <div className="flex justify-between border-t border-[var(--ecs-border)] pt-1.5 font-bold text-[var(--ecs-navy)]"><span>Total Reimbursable Amount</span><span>{fmtSgd(totalReimbursable)}</span></div>
          </div>
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
