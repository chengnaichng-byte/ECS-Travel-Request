'use client';
// Per-line "View Expense" detail dialog — mirrors the live NTU ECS Expense Detail form (every datapoint:
// payment type, GST rate/amount/code, base amount, currency/amount/exchange, reason, sponsorship for gross
// claims, receipt type, justification, and the per-city ODA / per-stay hotel breakdown). The PRE-TRIP
// additions — the approved TR estimate, the personal-day / funded split on the breakdown, the actual
// booked dates from the TMC feed, and the travel-class (M6) entitlement split — are tinted GREEN and
// tagged NEW. Read-only (the Expense items table keeps the inline actual/receipt editing).
import { useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export interface OdaRow { country: string; city: string; arrive: string; depart: string; stay: number; personal: number; funded: number; rate: number; amount: number }
export interface AccomRow { country: string; city: string; checkIn: string; checkOut: string; nights: number; personal: number; funded: number; rate: number; amount: number }
export interface M6Split { fare: number; entitlement: number; differential: number; account: string }
export interface ExpenseView {
  label: string; date: string; isRef: boolean; approvedSgd: number; actualSgd: number;
  reason: string; receiptType: string; currency: string; foreignAmount: number | null; sponsorSgd: number;
  paymentCtc: boolean; gstCode: string; gstRatePct: number; gstAmount: number; baseAmount: number; exchangeRate: number;
  oda?: OdaRow[]; accom?: AccomRow[]; m6?: M6Split | null;
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
// A read-only radio group showing the selected option (disabled, matching the ECS look).
function Radios({ label, options, selected, isNew }: { label: string; options: [string, string][]; selected: string; isNew?: boolean }) {
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
          <div className="bg-white rounded-xl w-full max-w-4xl shadow-2xl my-2" onClick={(ev) => ev.stopPropagation()}>
            <div className="bg-[var(--ecs-navy)] text-white px-5 py-3 rounded-t-xl flex items-center justify-between">
              <span className="font-semibold text-lg">View Expense</span>
              <button type="button" onClick={() => setOpen(false)} className="text-white/90 text-xl leading-none">✕</button>
            </div>
            <div className="p-5 space-y-4">
              {/* ── Top: two columns, mirroring the ECS Expense Detail dialog ── */}
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
                  <Radios label="Payment Type" options={[['SELF', 'Reimbursement To Staff'], ['CTC', 'NTU Corporate Card (CTC)']]} selected={e.paymentCtc ? 'CTC' : 'SELF'} isNew={e.isRef} />
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

              {/* ODA per-city breakdown — ECS columns, with the Personal / Funded split (NEW) inserted. */}
              {e.oda && e.oda.length > 0 && (
                <div>
                  <div className="text-xs font-semibold text-[var(--ecs-muted)] uppercase tracking-wide mb-1">Overseas Daily Allowance — per city <span className="font-normal normal-case text-[#0f6e56]">· funded (personal-excluded) split added</span></div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead><tr>
                        <th className="th">Destination Country/Region</th><th className="th">City</th><th className="th">Arrival Date</th><th className="th">Departure Date</th><th className="th text-right">Duration</th>
                        <th className="th text-right" style={{ background: HI }}>Personal<NewTag /></th><th className="th text-right" style={{ background: HI }}>Funded days<NewTag /></th>
                        <th className="th text-right">ODA Rate</th><th className="th text-right">Amount (SGD)</th>
                      </tr></thead>
                      <tbody>
                        {e.oda.map((o, i) => (
                          <tr key={i}>
                            <td className="td">{o.country}</td><td className="td">{o.city}</td><td className="td whitespace-nowrap">{o.arrive}</td><td className="td whitespace-nowrap">{o.depart}</td>
                            <td className="td text-right whitespace-nowrap">{o.stay} day{o.stay === 1 ? '' : 's'}</td>
                            <td className={`td text-right ${o.personal > 0 ? 'font-medium text-amber-700' : 'text-[var(--ecs-muted)]'}`} style={{ background: HI }}>{o.personal}</td>
                            <td className="td text-right font-medium" style={{ background: HI }}>{o.funded}</td>
                            <td className="td text-right text-[var(--ecs-muted)]">{fmt(o.rate)}</td><td className="td text-right">{fmt(o.amount)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Hotel per-stay breakdown — ECS columns, with the Personal / Funded split (NEW) inserted. */}
              {e.accom && e.accom.length > 0 && (
                <div>
                  <div className="text-xs font-semibold text-[var(--ecs-muted)] uppercase tracking-wide mb-1">Accommodation — per stay <span className="font-normal normal-case text-[#0f6e56]">· funded (personal-excluded) split added</span></div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead><tr>
                        <th className="th">Destination Country/Region</th><th className="th">City</th><th className="th">Check In Date</th><th className="th">Check Out Date</th><th className="th text-right">Duration</th>
                        <th className="th text-right" style={{ background: HI }}>Personal<NewTag /></th><th className="th text-right" style={{ background: HI }}>Funded nights<NewTag /></th>
                        <th className="th text-right">Amount (SGD)</th><th className="th text-right">Avg rate/night (SGD)</th>
                      </tr></thead>
                      <tbody>
                        {e.accom.map((a, i) => (
                          <tr key={i}>
                            <td className="td">{a.country}</td><td className="td">{a.city}</td><td className="td whitespace-nowrap">{a.checkIn}</td><td className="td whitespace-nowrap">{a.checkOut}</td>
                            <td className="td text-right whitespace-nowrap">{a.nights} night{a.nights === 1 ? '' : 's'}</td>
                            <td className={`td text-right ${a.personal > 0 ? 'font-medium text-amber-700' : 'text-[var(--ecs-muted)]'}`} style={{ background: HI }}>{a.personal}</td>
                            <td className="td text-right font-medium" style={{ background: HI }}>{a.funded}</td>
                            <td className="td text-right">{fmt(a.amount)}</td><td className="td text-right text-[var(--ecs-muted)]">{fmt(a.rate)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

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

              {/* Receipt type + justification — ECS. */}
              <div className="grid md:grid-cols-2 gap-x-6 gap-y-3 pt-1 border-t border-[var(--ecs-border)]">
                <Radios label="Receipt" options={RECEIPTS.map((r) => [r, RLABEL[r]]) as [string, string][]} selected={e.receiptType} />
                <F label="Justification For No Receipt" value={e.receiptType === 'NO_RECEIPT' ? (e.reason || '—') : '—'} />
              </div>
              <p className="text-[11px] text-[var(--ecs-muted)]">Supporting receipts / documents are attached and listed on the claim&apos;s Attachment panel.</p>
            </div>
            <div className="px-5 py-3 border-t border-[var(--ecs-border)] flex justify-end"><button type="button" onClick={() => setOpen(false)} className="btn-secondary">Close</button></div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
