'use client';
// ECS "Add Expense" modal for the Create-TE form. Opens a dialog with the ECS expense
// fields (date, type, currency/amount, sponsorship, reason, receipt type) and posts to the
// addClaimExpense server action.
import { useState } from 'react';
import { createPortal } from 'react-dom';

export function AddExpenseModal({ action, expenseTypes, currencies }: {
  action: (fd: FormData) => void;
  expenseTypes: { id: string; name: string }[];
  currencies: string[];
}) {
  const [open, setOpen] = useState(false);
  // Wrap the server action so the modal stays mounted until the action resolves, then close.
  async function submit(fd: FormData) { await action(fd); setOpen(false); }
  const trigger = <button type="button" className="btn-primary" onClick={() => setOpen(true)}>＋ Add expense</button>;
  if (!open || typeof document === 'undefined') return trigger;
  // Portal the overlay to <body> so the modal's <form> is NOT nested inside the page's main form.
  return (
    <>
      {trigger}
      {createPortal(
    <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center overflow-y-auto p-6">
      <div className="bg-white rounded-xl w-full max-w-2xl shadow-2xl">
        <div className="bg-[var(--ecs-navy)] text-white px-5 py-3 rounded-t-xl flex items-center justify-between">
          <span className="font-semibold text-lg">Add Expense</span>
          <button type="button" onClick={() => setOpen(false)} className="text-white/90">✕</button>
        </div>
        <form action={submit} className="p-5 space-y-4">
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
          <div>
            <label className="label">Receipt</label>
            <div className="flex flex-col gap-1.5 text-sm">
              <label className="flex items-center gap-2"><input type="radio" name="receiptType" value="LOCAL_GST" defaultChecked /> Local Receipt (With GST)</label>
              <label className="flex items-center gap-2"><input type="radio" name="receiptType" value="FOREIGN_NO_GST" /> Receipt (Foreign / Local Without GST)</label>
              <label className="flex items-center gap-2"><input type="radio" name="receiptType" value="NO_RECEIPT" /> No Receipt</label>
            </div>
          </div>
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
