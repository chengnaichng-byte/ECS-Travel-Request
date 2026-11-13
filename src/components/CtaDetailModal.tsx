'use client';
// A small "view details" dialog for the "Less: charges paid by CTA — reference only" total on the
// claim. Central (CTA / TMC-billed) charges are posted at booking and shown on the claim for the full
// trip cost, then deducted from the reimbursable total. The icon beside the total opens the breakdown
// of which lines make it up (expense, SAP posting, amount).
import { useState } from 'react';
import { createPortal } from 'react-dom';

export interface CtaChargeLine { label: string; amount: number; posting: string }
const fmt = (n: number) => n.toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function CtaDetailModal({ total, account, lines }: { total: number; account: string | null; lines: CtaChargeLine[] }) {
  const [open, setOpen] = useState(false);
  const trigger = (
    <button type="button" onClick={() => setOpen(true)} title="View the CTA charge details"
      className="ml-1.5 inline-grid place-items-center w-5 h-5 rounded-full border border-[var(--ecs-border)] text-[11px] text-[var(--ecs-navy-2)] hover:bg-[var(--ecs-panel-2)] align-middle">ⓘ</button>
  );
  if (!open || typeof document === 'undefined') return trigger;
  return (
    <>
      {trigger}
      {createPortal(
        <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center overflow-y-auto p-6" onClick={() => setOpen(false)}>
          <div className="bg-white rounded-xl w-full max-w-xl shadow-2xl my-2" onClick={(e) => e.stopPropagation()}>
            <div className="bg-[var(--ecs-navy)] text-white px-5 py-3 rounded-t-xl flex items-center justify-between">
              <span className="font-semibold text-lg">Charges paid by CTA (reference)</span>
              <button type="button" onClick={() => setOpen(false)} className="text-white/90 text-xl leading-none">✕</button>
            </div>
            <div className="p-5 space-y-3">
              <p className="text-xs text-[var(--ecs-muted)]">Central (CTA / TMC-billed) charges are posted to SAP at booking and shown on the claim for the full trip cost; they are deducted from the reimbursable total, not reimbursed.{account ? ` Paid on ${account}.` : ''}</p>
              {lines.length === 0 ? (
                <p className="text-sm text-[var(--ecs-muted)]">No central (CTA) charges on this claim — nothing is deducted here.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead><tr><th className="th">Expense</th><th className="th">SAP posting</th><th className="th text-right">Amount (SGD)</th></tr></thead>
                    <tbody>
                      {lines.map((l, i) => (
                        <tr key={i}><td className="td">{l.label}</td><td className="td text-[var(--ecs-muted)]">{l.posting || '—'}</td><td className="td text-right">{fmt(l.amount)}</td></tr>
                      ))}
                    </tbody>
                    <tfoot><tr className="font-semibold"><td className="td" colSpan={2}>Total deducted</td><td className="td text-right">{fmt(total)}</td></tr></tfoot>
                  </table>
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
