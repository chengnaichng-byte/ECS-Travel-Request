'use client';
// ECS per-line "Edit Expense" dialog on the Create-TE form. Opens a pencil-triggered modal pre-filled
// with the line's current values and posts to updateClaimExpenseLine. A TR budget line keeps its
// expense type (locked); a manually-added line may change it. Amount edits the claimed actual.
import { useState } from 'react';
import { createPortal } from 'react-dom';

export interface EditLine {
  expenseTypeId: string; label: string; manualEntry: boolean;
  transactionDate: string; currency: string; actualSgd: number; sponsorSgd: number; receiptType: string; reason: string;
}

const ICON_BTN = 'inline-grid place-items-center w-7 h-7 rounded hover:bg-[var(--ecs-panel-2)] text-[var(--ecs-navy-2)]';

export function EditExpenseModal({ action, expenseTypes, currencies, line }: {
  action: (fd: FormData) => void;
  expenseTypes: { id: string; name: string }[];
  currencies: string[];
  line: EditLine;
}) {
  const [open, setOpen] = useState(false);
  async function submit(fd: FormData) { await action(fd); setOpen(false); }
  const trigger = (
    <button type="button" className={ICON_BTN} title="Edit this expense" onClick={() => setOpen(true)}>
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" /></svg>
    </button>
  );
  if (!open || typeof document === 'undefined') return trigger;
  return (
    <>
      {trigger}
      {createPortal(
    <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center overflow-y-auto p-6">
      <div className="bg-white rounded-xl w-full max-w-2xl shadow-2xl">
        <div className="bg-[var(--ecs-navy)] text-white px-5 py-3 rounded-t-xl flex items-center justify-between">
          <span className="font-semibold text-lg">Edit Expense — {line.label}</span>
          <button type="button" onClick={() => setOpen(false)} className="text-white/90">✕</button>
        </div>
        <form action={submit} className="p-5 space-y-4">
          <div className="grid md:grid-cols-2 gap-4">
            <div><label className="label">Transaction Date</label><input name="transactionDate" type="date" defaultValue={line.transactionDate} className="field" /></div>
            <div><label className="label">Expense Type</label>
              {line.manualEntry ? (
                <select name="expenseTypeId" required defaultValue={line.expenseTypeId} className="field">{expenseTypes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
              ) : (
                <input className="field bg-[var(--ecs-readonly,#f1f1f6)]" value={line.label} disabled />
              )}
              {!line.manualEntry && <p className="text-[11px] text-[var(--ecs-muted)] mt-1">Budget line from the approved TR — type is fixed.</p>}
            </div>
            <div><label className="label">Currency</label>
              <select name="currency" className="field" defaultValue={line.currency}>{currencies.map((c) => <option key={c} value={c}>{c}</option>)}</select>
            </div>
            <div><label className="label">Amount (SGD)</label><input name="amount" type="number" step="any" defaultValue={line.actualSgd} className="field" placeholder="0.00" /></div>
          </div>
          <p className="text-xs text-[var(--ecs-navy-2)]">Sponsorship Amount (for gross claims) — enter only if the amount above is the full gross expense; leave 0 if it already reflects the net claimed from NTU.</p>
          <div className="grid md:grid-cols-2 gap-4">
            <div><label className="label">Sponsorship Amount (SGD)</label><input name="sponsorship" type="number" step="any" defaultValue={line.sponsorSgd} className="field" placeholder="0.00" /></div>
          </div>
          <div><label className="label">Reason For Expense</label><textarea name="reason" rows={2} defaultValue={line.reason} className="field" /></div>
          <div>
            <label className="label">Receipt</label>
            <div className="flex flex-col gap-1.5 text-sm">
              <label className="flex items-center gap-2"><input type="radio" name="receiptType" value="LOCAL_GST" defaultChecked={line.receiptType === 'LOCAL_GST'} /> Local Receipt (With GST)</label>
              <label className="flex items-center gap-2"><input type="radio" name="receiptType" value="FOREIGN_NO_GST" defaultChecked={line.receiptType === 'FOREIGN_NO_GST'} /> Receipt (Foreign / Local Without GST)</label>
              <label className="flex items-center gap-2"><input type="radio" name="receiptType" value="NO_RECEIPT" defaultChecked={line.receiptType === 'NO_RECEIPT'} /> No Receipt</label>
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
