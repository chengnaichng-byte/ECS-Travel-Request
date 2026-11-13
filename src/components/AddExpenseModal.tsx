'use client';
// ECS "Add Expense" modal — RECEIPT-FIRST. A newly added line is an out-of-pocket expense, so the receipt
// leads: pick the receipt type, attach/capture the receipt, then the detail fields (the values a future
// AI-OCR pass would pre-fill from the receipt). "No Receipt" swaps the capture for a justification. OCR is
// not built yet — the capture zone and the "pre-fill from receipt" affordance are the groundwork.
import { useState } from 'react';
import { createPortal } from 'react-dom';

const RECEIPTS: [string, string][] = [['LOCAL_GST', 'Local Receipt (With GST)'], ['FOREIGN_NO_GST', 'Receipt (Foreign / Local Without GST)'], ['NO_RECEIPT', 'No Receipt']];

export function AddExpenseModal({ action, expenseTypes, currencies }: {
  action: (fd: FormData) => void;
  expenseTypes: { id: string; name: string }[];
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
    <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center overflow-y-auto p-6">
      <div className="bg-white rounded-xl w-full max-w-2xl shadow-2xl my-2">
        <div className="bg-[var(--ecs-navy)] text-white px-5 py-3 rounded-t-xl flex items-center justify-between">
          <span className="font-semibold text-lg">Add Expense</span>
          <button type="button" onClick={() => setOpen(false)} className="text-white/90">✕</button>
        </div>
        <form action={submit} className="p-5 space-y-4">
          {/* ── 1. RECEIPT FIRST ─────────────────────────────────────────────── */}
          <div className="rounded-lg border border-[var(--ecs-border)] bg-[var(--ecs-panel)] p-3 space-y-3">
            <div className="text-sm font-semibold text-[var(--ecs-navy)]">Receipt <span className="font-normal text-[var(--ecs-muted)]">— start here</span></div>
            <input type="hidden" name="receiptType" value={receiptType} />
            <div className="flex flex-col gap-1.5 text-sm">
              {RECEIPTS.map(([v, lab]) => (
                <label key={v} className="flex items-center gap-2"><input type="radio" name="receiptTypeRadio" value={v} checked={receiptType === v} onChange={() => setReceiptType(v)} /> {lab}</label>
              ))}
            </div>
            {hasReceipt ? (
              <label className="block cursor-pointer rounded-lg border-2 border-dashed border-[var(--ecs-border)] bg-white px-4 py-5 text-center hover:border-[var(--ecs-navy)]">
                <input type="file" accept="image/*,.pdf" className="hidden" onChange={(e) => setFileName(e.target.files?.[0]?.name ?? '')} />
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mx-auto text-[var(--ecs-muted)] mb-1"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z" /><circle cx="12" cy="13" r="3" /></svg>
                <div className="text-sm font-medium text-[var(--ecs-navy)]">{fileName || 'Attach or photograph the receipt'}</div>
                <div className="text-[11px] text-[var(--ecs-muted)] mt-0.5">The expense details below will be <b>pre-filled from the receipt</b> (AI pre-fill coming soon).</div>
              </label>
            ) : (
              <div>
                <label className="label text-amber-800">Justification for no receipt</label>
                <textarea name="noReceiptReason" rows={2} className="field" placeholder="Why is there no receipt for this expense?" />
              </div>
            )}
          </div>

          {/* ── 2. EXPENSE DETAILS (the fields OCR would pre-fill) ────────────── */}
          <div className="text-xs font-semibold text-[var(--ecs-muted)] uppercase tracking-wide">Expense details</div>
          <div className="grid md:grid-cols-2 gap-4">
            <div><label className="label">Transaction Date <span className="text-[var(--ecs-red)]">*</span></label><input name="transactionDate" type="date" required className="field" /></div>
            <div><label className="label">Expense Type <span className="text-[var(--ecs-red)]">*</span></label>
              <select name="expenseTypeId" required className="field"><option value="">Select…</option>{expenseTypes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
            </div>
            <div><label className="label">Currency <span className="text-[var(--ecs-red)]">*</span></label>
              <select name="currency" className="field" defaultValue="SGD">{currencies.map((c) => <option key={c} value={c}>{c}</option>)}</select>
            </div>
            <div><label className="label">Amount (SGD) <span className="text-[var(--ecs-red)]">*</span></label><input name="amount" type="number" step="any" required className="field" placeholder="0.00" /></div>
          </div>
          <p className="text-xs text-[var(--ecs-navy-2)]">Sponsorship Amount (for gross claims) — enter only if the amount is the full gross expense; leave blank if it already reflects the net claimed from NTU.</p>
          <div className="grid md:grid-cols-2 gap-4">
            <div><label className="label">Sponsorship Amount (SGD)</label><input name="sponsorship" type="number" step="any" className="field" placeholder="0.00" /></div>
          </div>
          <div><label className="label">Reason For Expense</label><textarea name="reason" rows={2} className="field" /></div>

          <div className="flex justify-end gap-2 pt-2">
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
