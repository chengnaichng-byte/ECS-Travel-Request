'use client';
// ECS per-line "Edit Expense" dialog — RECEIPT-FIRST. The receipt leads the form: pick the receipt type,
// then (for a receipted expense) attach/capture the receipt; the expense detail fields follow as the
// values a future AI-OCR pass would PRE-FILL from that receipt. A "No Receipt" expense (e.g. per-diem/ODA)
// skips the capture and goes straight to a justification + manual entry. OCR itself is not built yet — the
// capture zone and the "pre-fill from receipt" affordance are the groundwork so the ordering is ready.
import { useState } from 'react';
import { createPortal } from 'react-dom';

export interface EditLine {
  expenseTypeId: string; label: string; manualEntry: boolean;
  transactionDate: string; currency: string; actualSgd: number; sponsorSgd: number; receiptType: string; reason: string;
}

const ICON_BTN = 'inline-grid place-items-center w-7 h-7 rounded hover:bg-[var(--ecs-panel-2)] text-[var(--ecs-navy-2)]';
const RECEIPTS: [string, string][] = [['LOCAL_GST', 'Local Receipt (With GST)'], ['FOREIGN_NO_GST', 'Receipt (Foreign / Local Without GST)'], ['NO_RECEIPT', 'No Receipt']];

export function EditExpenseModal({ action, expenseTypes, currencies, line }: {
  action: (fd: FormData) => void;
  expenseTypes: { id: string; name: string }[];
  currencies: string[];
  line: EditLine;
}) {
  const [open, setOpen] = useState(false);
  const [receiptType, setReceiptType] = useState(line.receiptType);
  const [fileName, setFileName] = useState('');
  const hasReceipt = receiptType !== 'NO_RECEIPT';
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
      <div className="bg-white rounded-xl w-full max-w-2xl shadow-2xl my-2">
        <div className="bg-[var(--ecs-navy)] text-white px-5 py-3 rounded-t-xl flex items-center justify-between">
          <span className="font-semibold text-lg">Edit Expense — {line.label}</span>
          <button type="button" onClick={() => setOpen(false)} className="text-white/90">✕</button>
        </div>
        <form action={submit} className="p-5 space-y-4">
          {/* ── 1. SOURCE OF THE VALUE (leads the form) ──────────────────────── */}
          {!line.manualEntry ? (
            // A budget line is PRE-FILLED from the approved TR; its ODA days / hotel nights and the actual
            // dates come from the TMC feed (booked PNRs) — not a receipt. It leads with its source, to review.
            <div className="rounded-lg border p-3 space-y-1" style={{ borderColor: '#9cc3e6', background: '#eef5fc' }}>
              <input type="hidden" name="receiptType" value={line.receiptType} />
              <div className="text-sm font-semibold text-[var(--ecs-navy)]">Pre-filled from the approved TR &amp; TMC feed</div>
              <p className="text-[12px] text-[var(--ecs-navy-2)]">This is a budget line from the approved Travel Request. Its amount is seeded from the approved estimate, and the stay days / nights and dates come from the <b>TMC feed</b> (booked PNRs). <b>Review</b> the values below — an entitlement / per-diem carries no receipt.</p>
            </div>
          ) : (
            // A claimant-added out-of-pocket expense is RECEIPT-FIRST: the receipt is the source a future
            // AI-OCR pass reads to pre-fill the detail fields below. "No Receipt" → a justification instead.
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
          )}

          {/* ── 2. EXPENSE DETAILS (the fields OCR would pre-fill) ────────────── */}
          <div className="text-xs font-semibold text-[var(--ecs-muted)] uppercase tracking-wide">Expense details</div>
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
