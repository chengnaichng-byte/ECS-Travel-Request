'use client';
// Per-line "View Expense" detail dialog on the claim — opens the expense detail screen for a claim
// line (matching the Pre-Trip mockups): header fields + the per-city / per-stay funded breakdown for
// ODA and accommodation, and the entitlement-vs-M6 split for a reimbursable airfare. Read-only (the
// claim's Expense items table keeps the inline actual/receipt editing). New datapoints are tinted green.
import { useState } from 'react';
import { createPortal } from 'react-dom';

export interface OdaRow { city: string; arrive: string; depart: string; stay: number; personal: number; funded: number; rate: number; amount: number }
export interface AccomRow { city: string; checkIn: string; checkOut: string; nights: number; personal: number; funded: number; rate: number; amount: number }
export interface M6Split { fare: number; entitlement: number; differential: number; account: string }
export interface ExpenseView {
  label: string; date: string; isRef: boolean; approvedSgd: number; actualSgd: number;
  reason: string; receipt: string; currency: string; foreignAmount: number | null; sponsorSgd: number;
  oda?: OdaRow[]; accom?: AccomRow[]; m6?: M6Split | null;
}
const fmt = (n: number) => n.toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const HI = { background: '#f0faf5' } as const;

function Field({ label, value, wide = false }: { label: string; value: string; wide?: boolean }) {
  return <div className={wide ? 'md:col-span-3' : ''}><label className="label">{label}</label><div className="field bg-[var(--ecs-readonly,#f1f1f6)]">{value}</div></div>;
}

export function ViewExpenseModal({ e }: { e: ExpenseView }) {
  const [open, setOpen] = useState(false);
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
        <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center overflow-y-auto p-6" onClick={() => setOpen(false)}>
          <div className="bg-white rounded-xl w-full max-w-3xl shadow-2xl my-2" onClick={(ev) => ev.stopPropagation()}>
            <div className="bg-[var(--ecs-navy)] text-white px-5 py-3 rounded-t-xl flex items-center justify-between">
              <span className="font-semibold text-lg">View Expense — {e.label}</span>
              <button type="button" onClick={() => setOpen(false)} className="text-white/90 text-xl leading-none">✕</button>
            </div>
            <div className="p-5 space-y-4">
              <div className="grid md:grid-cols-3 gap-4">
                <Field label="Transaction date" value={e.date || '—'} />
                <Field label="Expense type" value={e.label} />
                <Field label="Payment type" value={e.isRef ? 'Paid by CTA (central) — reference' : 'Reimbursement to staff'} />
                <Field label="Approved estimate (SGD)" value={e.approvedSgd > 0 ? fmt(e.approvedSgd) : '—'} />
                <div><label className="label">Expense amount (SGD)</label><div className="field" style={e.isRef ? undefined : HI}>{fmt(e.actualSgd)}{e.currency !== 'SGD' && e.foreignAmount != null ? <span className="text-[var(--ecs-muted)]"> · {e.currency} {fmt(e.foreignAmount)}</span> : null}</div></div>
                <Field label="Receipt" value={e.receipt} />
              </div>
              {e.reason ? <Field label="Reason for expense" value={e.reason} wide /> : null}

              {e.oda && e.oda.length > 0 && (
                <div>
                  <div className="text-xs font-semibold text-[var(--ecs-muted)] uppercase tracking-wide mb-1">Destinations &amp; daily allowance</div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead><tr><th className="th">City</th><th className="th">Arrive</th><th className="th">Depart</th><th className="th text-right">Stay days</th><th className="th text-right" style={HI}>Personal</th><th className="th text-right" style={HI}>Funded days</th><th className="th text-right">Rate/day</th><th className="th text-right">Amount</th></tr></thead>
                      <tbody>
                        {e.oda.map((o, i) => (
                          <tr key={i}>
                            <td className="td">{o.city}</td><td className="td whitespace-nowrap">{o.arrive}</td><td className="td whitespace-nowrap">{o.depart}</td>
                            <td className="td text-right">{o.stay}</td>
                            <td className={`td text-right ${o.personal > 0 ? 'font-medium text-amber-700' : 'text-[var(--ecs-muted)]'}`} style={HI}>{o.personal}</td>
                            <td className="td text-right font-medium" style={HI}>{o.funded}</td>
                            <td className="td text-right text-[var(--ecs-muted)]">{fmt(o.rate)}</td>
                            <td className="td text-right">{fmt(o.amount)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {e.accom && e.accom.length > 0 && (
                <div>
                  <div className="text-xs font-semibold text-[var(--ecs-muted)] uppercase tracking-wide mb-1">Accommodation stays</div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead><tr><th className="th">City</th><th className="th">Check-in</th><th className="th">Check-out</th><th className="th text-right">Stay nights</th><th className="th text-right" style={HI}>Personal</th><th className="th text-right" style={HI}>Funded nights</th><th className="th text-right">Avg/night</th><th className="th text-right">Amount</th></tr></thead>
                      <tbody>
                        {e.accom.map((a, i) => (
                          <tr key={i}>
                            <td className="td">{a.city}</td><td className="td whitespace-nowrap">{a.checkIn}</td><td className="td whitespace-nowrap">{a.checkOut}</td>
                            <td className="td text-right">{a.nights}</td>
                            <td className={`td text-right ${a.personal > 0 ? 'font-medium text-amber-700' : 'text-[var(--ecs-muted)]'}`} style={HI}>{a.personal}</td>
                            <td className="td text-right font-medium" style={HI}>{a.funded}</td>
                            <td className="td text-right text-[var(--ecs-muted)]">{fmt(a.rate)}</td>
                            <td className="td text-right">{fmt(a.amount)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {e.m6 && (
                <div>
                  <div className="text-xs font-semibold text-[var(--ecs-muted)] uppercase tracking-wide mb-1">Travel-class entitlement (M6)</div>
                  <div className="rounded border border-[var(--ecs-border)] divide-y text-sm">
                    <div className="flex justify-between px-3 py-2"><span>Fare paid</span><span className="font-medium">{fmt(e.m6.fare)}</span></div>
                    <div className="flex justify-between px-3 py-2"><span>Economy base (entitlement) — normal charging</span><span>{fmt(e.m6.entitlement)}</span></div>
                    <div className="flex justify-between px-3 py-2" style={HI}><span>M6 differential → <span className="font-mono">{e.m6.account}</span></span><span className="font-medium text-[#0f6e56]">{fmt(e.m6.differential)}</span></div>
                  </div>
                </div>
              )}
            </div>
            <div className="px-5 py-3 border-t border-[var(--ecs-border)] flex justify-end"><button type="button" onClick={() => setOpen(false)} className="btn-secondary">Close</button></div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
