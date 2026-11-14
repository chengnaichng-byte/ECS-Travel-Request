'use client';
// ECS "Add Expense" modal — RECEIPT-FIRST. A newly added line is an out-of-pocket expense, so the receipt
// leads: pick the receipt type, attach/capture the receipt, then the detail fields (the values a future
// AI-OCR pass would pre-fill from the receipt). "No Receipt" swaps the capture for a justification. OCR is
// not built yet — the capture zone and the "pre-fill from receipt" affordance are the groundwork.
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { ExpenseDetailFields, type ExpenseTypeOpt } from '@/components/ExpenseDetailFields';

const RECEIPTS: [string, string][] = [['LOCAL_GST', 'Local Receipt (With GST)'], ['FOREIGN_NO_GST', 'Receipt (Foreign / Local Without GST)'], ['NO_RECEIPT', 'No Receipt']];

export function AddExpenseModal({ action, expenseTypes, currencies }: {
  action: (fd: FormData) => void;
  expenseTypes: ExpenseTypeOpt[];
  currencies: string[];
}) {
  const [open, setOpen] = useState(false);
  const [receiptType, setReceiptType] = useState('LOCAL_GST');
  const [fileName, setFileName] = useState('');
  const hasReceipt = receiptType !== 'NO_RECEIPT';
  async function submit(fd: FormData) { await action(fd); setOpen(false); }
  const trigger = <button type="button" className="btn-primary" onClick={() => setOpen(true)}>＋ Add expense</button>;
  if (!open || typeof document === 'undefined') return trigger;
  return (
    <>
      {trigger}
      {createPortal(
    <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center overflow-y-auto p-4 sm:p-6">
      <div className="bg-white rounded-xl w-full max-w-4xl shadow-2xl my-2 flex flex-col max-h-[90vh]">
        <div className="bg-[var(--ecs-navy)] text-white px-5 py-3 rounded-t-xl flex items-center justify-between shrink-0">
          <span className="font-semibold text-lg">Add Expense</span>
          <button type="button" onClick={() => setOpen(false)} className="text-white/90">✕</button>
        </div>
        {/* Scrollable body between a pinned header and a sticky footer, so the modal always fits the window. */}
        <form action={submit} className="flex flex-col flex-1 min-h-0">
          <div className="p-5 space-y-4 overflow-y-auto flex-1 min-h-0">
          {/* ── 1. RECEIPT FIRST ─────────────────────────────────────────────── */}
          <div className="rounded-lg border border-[var(--ecs-border)] bg-[var(--ecs-panel)] p-3 space-y-3">
            <div className="text-sm font-semibold text-[var(--ecs-navy)]">Receipt <span className="font-normal text-[var(--ecs-muted)]">— start here</span></div>
            <input type="hidden" name="receiptType" value={receiptType} />
            {/* Two columns — the capture / justification on the LEFT, the receipt-type radios on the RIGHT. */}
            <div className="flex flex-col sm:flex-row gap-4">
              <div className="flex-1 min-w-0">
                {hasReceipt ? (
                  <label className="flex h-full min-h-[8.5rem] flex-col items-center justify-center cursor-pointer rounded-lg border-2 border-dashed border-[var(--ecs-border)] bg-white px-4 py-5 text-center hover:border-[var(--ecs-navy)]">
                    <input type="file" name="receiptFile" accept="image/*,.pdf" className="hidden" onChange={(e) => setFileName(e.target.files?.[0]?.name ?? '')} />
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mx-auto text-[var(--ecs-muted)] mb-1"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z" /><circle cx="12" cy="13" r="3" /></svg>
                    <div className="text-sm font-medium text-[var(--ecs-navy)]">{fileName || 'Attach or photograph the receipt'}</div>
                    <div className="text-[11px] text-[var(--ecs-muted)] mt-0.5">The expense details below will be <b>pre-filled from the receipt</b> (AI pre-fill coming soon).</div>
                  </label>
                ) : (
                  <div>
                    <label className="label text-amber-800">Justification for no receipt</label>
                    <textarea name="noReceiptReason" rows={4} className="field" placeholder="Why is there no receipt for this expense?" />
                  </div>
                )}
              </div>
              <div className="sm:w-64 shrink-0 flex flex-col gap-2 text-sm">
                {RECEIPTS.map(([v, lab]) => (
                  <label key={v} className="flex items-start gap-2 leading-tight"><input type="radio" name="receiptTypeRadio" className="mt-0.5" value={v} checked={receiptType === v} onChange={() => setReceiptType(v)} /> {lab}</label>
                ))}
              </div>
            </div>
          </div>

          {/* ── 2. EXPENSE DETAILS — full ECS datapoint set (the fields OCR would pre-fill) ── */}
          <ExpenseDetailFields expenseTypes={expenseTypes} currencies={currencies} />

          </div>
          <div className="flex justify-end gap-2 px-5 py-3 border-t border-[var(--ecs-border)] bg-white rounded-b-xl shrink-0">
            <button type="button" className="btn-secondary" onClick={() => setOpen(false)}>Cancel</button>
            <button type="submit" className="btn-primary">Save</button>
          </div>
        </form>
      </div>
    </div>,
    document.body)}
    </>
  );
}
