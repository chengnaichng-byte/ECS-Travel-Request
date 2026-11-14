'use client';
// Per-line "View Expense" detail dialog — mirrors the live NTU ECS Expense Detail form (every datapoint:
// payment type, GST rate/amount/code, base amount, currency/amount/exchange, reason, sponsorship for gross
// claims, receipt type, justification, and the per-city ODA / per-stay hotel breakdown). The PRE-TRIP
// additions — the approved TR estimate, the personal-day / funded split on the breakdown, the actual
// booked dates from the TMC feed, and the travel-class (M6) entitlement split — are tinted GREEN and
// tagged NEW. Read-only (the Expense items table keeps the inline actual/receipt editing).
import { useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { OdaTable, AccomTable, type OdaRow, type AccomRow } from '@/components/StayBreakdown';

export type { OdaRow, AccomRow };
export interface M6Split { fare: number; entitlement: number; differential: number; account: string }
export interface ExpenseView {
  label: string; date: string; isRef: boolean; manualEntry: boolean; receiptRequired: boolean; approvedSgd: number; actualSgd: number;
  reason: string; receiptType: string; currency: string; foreignAmount: number | null; sponsorSgd: number;
  paymentCtc: boolean; gstCode: string; gstRatePct: number; gstAmount: number; baseAmount: number; exchangeRate: number;
  oda?: OdaRow[]; accom?: AccomRow[]; m6?: M6Split | null;
  receipt?: { fileName: string; href: string; contentType?: string | null } | null;   // the per-line receipt attachment (NEW — receipt-first capture)
}

const fmt = (n: number) => n.toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const HI = '#f0faf5';       // soft-green tint for a NEW datapoint
const HIBORDER = '#a7dcc6';
const RLABEL: Record<string, string> = { LOCAL_GST: 'Local Receipt (With GST)', FOREIGN_NO_GST: 'Receipt (Foreign / Local Without GST)', NO_RECEIPT: 'No Receipt' };
const RECEIPTS = ['LOCAL_GST', 'FOREIGN_NO_GST', 'NO_RECEIPT'];

const NewTag = () => <span className="ml-1.5 inline-block rounded px-1 py-0.5 text-[9px] font-semibold tracking-wide align-middle" style={{ background: '#e1f5ee', color: '#0f6e56', border: `1px solid ${HIBORDER}` }}>NEW</span>;

// A read-only field. `isNew` tints it green + tags it; `strong` right-aligns a numeric value like the ECS form.
function F({ label, value, isNew, strong, wide }: { label: ReactNode; value: ReactNode; isNew?: boolean; strong?: boolean; wide?: boolean }) {
  return (
    <div className={wide ? 'md:col-span-2' : ''}>
      <label className="label">{label}{isNew && <NewTag />}</label>
      <div className="field" style={{ background: isNew ? HI : 'var(--ecs-readonly, #f1f1f6)', ...(isNew ? { borderColor: HIBORDER } : {}), ...(strong ? { textAlign: 'right' } : {}) }}>{value}</div>
    </div>
  );
}
// A read-only radio group showing the selected option (disabled, matching the ECS look). A `selected`
// value that matches no option leaves every radio unchecked (e.g. a CTA-billed line — neither a staff
// reimbursement nor a personal corporate card); `hint` explains that case below the options.
function Radios({ label, options, selected, isNew, hint }: { label: string; options: [string, string][]; selected: string; isNew?: boolean; hint?: string }) {
  return (
    <div>
      <label className="label">{label}{isNew && <NewTag />}</label>
      <div className="flex flex-wrap gap-x-5 gap-y-1 pt-1">
        {options.map(([v, lab]) => (
          <label key={v} className={`flex items-center gap-1.5 text-sm ${v === selected ? 'text-[var(--ecs-navy)] font-medium' : 'text-[var(--ecs-muted)]'}`}>
            <input type="radio" checked={v === selected} readOnly disabled className="w-4 h-4" />{lab}
          </label>
        ))}
      </div>
      {hint && <p className="text-[11px] text-[var(--ecs-muted)] mt-1">{hint}</p>}
    </div>
  );
}

export function ViewExpenseModal({ e }: { e: ExpenseView }) {
  const [open, setOpen] = useState(false);
  const foreign = e.currency !== 'SGD' && e.foreignAmount != null;
  const trigger = (
    <button type="button" className="inline-grid place-items-center w-7 h-7 rounded hover:bg-[var(--ecs-panel-2)] text-[var(--ecs-navy-2)]" title="View this expense" onClick={() => setOpen(true)}>
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>
    </button>
  );
  if (!open || typeof document === 'undefined') return trigger;
  return (
    <>
      {trigger}
      {createPortal(
        <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center overflow-y-auto p-4 sm:p-6" onClick={() => setOpen(false)}>
          <div className="bg-white rounded-xl w-full max-w-4xl shadow-2xl my-2 flex flex-col max-h-[90vh]" onClick={(ev) => ev.stopPropagation()}>
            <div className="bg-[var(--ecs-navy)] text-white px-5 py-3 rounded-t-xl flex items-center justify-between shrink-0">
              <span className="font-semibold text-lg">View Expense</span>
              <button type="button" onClick={() => setOpen(false)} className="text-white/90 text-xl leading-none">✕</button>
            </div>
            <div className="p-5 space-y-4 overflow-y-auto flex-1 min-h-0">
              {/* ── RECEIPT FIRST — leads the form, matching the Add / Edit receipt-first flow. A pre-filled
                  allowance (ODA / per-diem) or centrally-billed (CTC) line shows its source; an out-of-pocket
                  line (hotel, reimbursable airfare, claimant-added) shows the receipt type + the attachment. */}
              <div className="space-y-3 pb-4 border-b border-[var(--ecs-border)]">
                {!e.receiptRequired ? (
                  <div>
                    <label className="label">Receipt</label>
                    <div className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: '#9cc3e6', background: '#eef5fc' }}>
                      <span className="font-medium text-[var(--ecs-navy)]">Pre-filled from the approved TR</span>
                      <span className="text-[var(--ecs-navy-2)]"> — {e.isRef ? 'centrally billed (CTA)' : 'entitlement / per-diem'}; no receipt required.</span>
                    </div>
                  </div>
                ) : (
                  <div className="grid md:grid-cols-2 gap-x-6 gap-y-3">
                    <Radios label="Receipt" options={RECEIPTS.map((r) => [r, RLABEL[r]]) as [string, string][]} selected={e.receiptType} />
                    <F label="Justification For No Receipt" value={e.receiptType === 'NO_RECEIPT' ? (e.reason || '—') : '—'} />
                  </div>
                )}
                {e.receipt ? (
                  <div>
                    <label className="label">Receipt attachment<NewTag /></label>
                    <a href={e.receipt.href} target="_blank" rel="noreferrer" className="flex items-center gap-3 rounded-lg border px-3 py-2.5 text-sm transition-shadow hover:shadow-sm" style={{ background: HI, borderColor: HIBORDER }}>
                      {e.receipt.contentType?.startsWith('image/') ? (
                        // image receipt → show a real thumbnail of the uploaded file
                        <img src={e.receipt.href} alt={e.receipt.fileName} className="h-16 w-16 shrink-0 rounded border border-[var(--ecs-border)] bg-white object-cover" />
                      ) : (
                        // PDF / other → a document placeholder
                        <span className="grid h-16 w-16 shrink-0 place-items-center rounded border border-[var(--ecs-border)] bg-white text-[#0f6e56]">
                          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /></svg>
                        </span>
                      )}
                      <span className="min-w-0">
                        <span className="block truncate font-medium text-[#0f6e56] underline">{e.receipt.fileName}</span>
                        <span className="block text-[11px] text-[var(--ecs-muted)]">captured on this expense · click to open</span>
                      </span>
                    </a>
                  </div>
                ) : e.receiptRequired ? (
                  <p className="text-[11px] text-[var(--ecs-muted)]">Supporting receipts / documents are attached and listed on the claim&apos;s Attachment panel.</p>
                ) : null}
              </div>

              {/* ── ECS Expense Detail — two columns ── */}
              <div className="grid md:grid-cols-2 gap-x-6 gap-y-4">
                {/* LEFT */}
                <div className="space-y-4">
                  <F label="Transaction Date" value={e.date || '—'} />
                  <F label="Expense Type" value={e.label} />
                  <div className="grid grid-cols-[7rem_1fr] gap-3">
                    <F label="Currency" value={e.currency} />
                    <F label="Amount" value={<span className="tabular-nums">{foreign ? fmt(e.foreignAmount!) : fmt(e.actualSgd)}</span>} strong />
                  </div>
                </div>
                {/* RIGHT */}
                <div className="space-y-4">
                  <Radios label="Payment Type" options={[['SELF', 'Reimbursement To Staff'], ['CTC', 'NTU Corporate Card (CTC)']]} selected={e.isRef ? '' : (e.paymentCtc ? 'CTC' : 'SELF')} isNew={e.isRef} hint={e.isRef ? 'Centrally billed via the CTA (corporate travel account) — neither a staff reimbursement nor a corporate card (CTC).' : undefined} />
                  <div className="grid grid-cols-2 gap-3">
                    <F label={<>GST Rate (%) <span className="text-[var(--ecs-red)]">*</span></>} value={<span className="tabular-nums">{fmt(e.gstRatePct)}</span>} strong />
                    <F label={<>GST Amount <span className="text-[var(--ecs-red)]">*</span></>} value={<span className="tabular-nums">{fmt(e.gstAmount)}</span>} strong />
                    <F label="GST Code" value={e.gstCode || '—'} />
                    <F label="Base Amount" value={<span className="tabular-nums">{fmt(e.baseAmount)}</span>} strong />
                    <F label="Exchange Rate" value={<span className="tabular-nums">{e.exchangeRate.toLocaleString('en-SG', { minimumFractionDigits: 5, maximumFractionDigits: 5 })}</span>} strong />
                    <F label="Amount (SGD)" value={<span className="tabular-nums">{fmt(e.actualSgd)}</span>} strong />
                  </div>
                </div>
              </div>

              {/* NEW — the approved TR estimate this line was pre-populated from (the funded reference). */}
              <div className="grid md:grid-cols-2 gap-x-6">
                <F label="Approved estimate (SGD)" value={e.approvedSgd > 0 ? fmt(e.approvedSgd) : '—'} isNew strong />
              </div>

              {/* Sponsorship (for gross claims) — accommodation / where a sponsorship was captured. */}
              {(e.accom && e.accom.length > 0) || e.sponsorSgd > 0 ? (
                <div className="rounded border border-[var(--ecs-border)] p-3">
                  <div className="text-sm font-medium text-[var(--ecs-navy)]">Sponsorship Amount (For Gross Claims)</div>
                  <p className="text-[11px] text-[var(--ecs-navy-2)] mb-2">Enter the sponsorship amount only if the Amount field contains the full (gross) expense amount. Leave blank if the Amount already reflects the net amount being claimed from NTU.</p>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <F label="Currency" value={e.currency} />
                    <F label="Sponsorship Amount" value={<span className="tabular-nums">{fmt(e.sponsorSgd)}</span>} strong />
                    <F label="Exchange Rate" value="1.00000" strong />
                    <F label="Sponsorship Amount (SGD)" value={<span className="tabular-nums">{fmt(e.sponsorSgd)}</span>} strong />
                  </div>
                </div>
              ) : null}

              <F label="Reason For Expense" value={e.reason || '—'} wide />

              {/* ODA per-city / accommodation per-stay breakdown — shared with the Edit modal so both show
                  identical columns + the Personal / Funded split (NEW). */}
              {e.oda && e.oda.length > 0 && <OdaTable oda={e.oda} />}
              {e.accom && e.accom.length > 0 && <AccomTable accom={e.accom} />}

              {/* NEW — travel-class (M6) entitlement split for a reimbursable airfare. */}
              {e.m6 && (
                <div>
                  <div className="text-xs font-semibold text-[#0f6e56] uppercase tracking-wide mb-1">Travel-class entitlement (M6)<NewTag /></div>
                  <div className="rounded border text-sm" style={{ borderColor: HIBORDER }}>
                    <div className="flex justify-between px-3 py-2 border-b border-[var(--ecs-border)]"><span>Fare paid</span><span className="font-medium tabular-nums">{fmt(e.m6.fare)}</span></div>
                    <div className="flex justify-between px-3 py-2 border-b border-[var(--ecs-border)]"><span>Economy base (entitlement) — normal charging</span><span className="tabular-nums">{fmt(e.m6.entitlement)}</span></div>
                    <div className="flex justify-between px-3 py-2" style={{ background: HI }}><span>M6 differential → <span className="font-mono">{e.m6.account}</span></span><span className="font-medium text-[#0f6e56] tabular-nums">{fmt(e.m6.differential)}</span></div>
                  </div>
                </div>
              )}

            </div>
            <div className="px-5 py-3 border-t border-[var(--ecs-border)] flex justify-end shrink-0"><button type="button" onClick={() => setOpen(false)} className="btn-secondary">Close</button></div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
