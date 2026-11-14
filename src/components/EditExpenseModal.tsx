'use client';
// ECS per-line "Edit Expense" dialog — RECEIPT-FIRST. The receipt leads the form: pick the receipt type,
// then (for a receipted expense) attach/capture the receipt; the expense detail fields follow as the
// values a future AI-OCR pass would PRE-FILL from that receipt. A "No Receipt" expense (e.g. per-diem/ODA)
// skips the capture and goes straight to a justification + manual entry. OCR itself is not built yet — the
// capture zone and the "pre-fill from receipt" affordance are the groundwork so the ordering is ready.
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { ExpenseDetailFields, type ExpenseTypeOpt } from '@/components/ExpenseDetailFields';
import { StayBreakdown, type OdaRow, type AccomRow } from '@/components/StayBreakdown';

export interface EditLine {
  expenseTypeId: string; label: string; manualEntry: boolean;
  receiptRequired: boolean;   // true = traveller pays out-of-pocket and must attach a receipt (hotel, reimbursable
                              // airfare, claimant-added). false = ODA / per-diem allowance or centrally-billed (CTC).
  transactionDate: string; currency: string; foreignAmount: number | null; actualSgd: number; sponsorSgd: number; receiptType: string; reason: string;
  receipt?: { id: string; fileName: string; href: string } | null;   // §2 the persisted per-line receipt
}

const ICON_BTN = 'inline-grid place-items-center w-7 h-7 rounded hover:bg-[var(--ecs-panel-2)] text-[var(--ecs-navy-2)]';
const RECEIPTS: [string, string][] = [['LOCAL_GST', 'Local Receipt (With GST)'], ['FOREIGN_NO_GST', 'Receipt (Foreign / Local Without GST)'], ['NO_RECEIPT', 'No Receipt']];

export function EditExpenseModal({ action, removeReceipt, expenseTypes, currencies, line, oda, accom }: {
  action: (fd: FormData) => void;
  removeReceipt?: (fd: FormData) => void;
  expenseTypes: ExpenseTypeOpt[];
  currencies: string[];
  line: EditLine;
  oda?: OdaRow[];       // §4.5 per-city ODA funded breakdown (ODA lines) — same data the View modal shows
  accom?: AccomRow[];   // §4.5 per-stay accommodation breakdown (accommodation lines) — nights / dates / funded split
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
  // The receipt radios + capture/justification — reused by the out-of-pocket (receipt-first) line AND by a
  // pre-filled line that still needs a receipt for the actual spend (hotel, reimbursable airfare).
  const receiptInner = (
    // Two columns — the capture / justification on the LEFT, the receipt-type radios on the RIGHT.
    <div className="flex flex-col sm:flex-row gap-4">
      <div className="flex-1 min-w-0">
        {hasReceipt ? (
          <div className="space-y-2">
            {line.receipt && (
              // §2 the receipt already persisted on this line — view / remove / replace
              <div className="flex items-center gap-2 rounded-lg border border-[var(--ecs-border)] bg-white px-3 py-2 text-sm">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-[var(--ecs-navy-2)] shrink-0"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /></svg>
                <a href={line.receipt.href} target="_blank" rel="noreferrer" className="font-medium text-[var(--ecs-navy)] underline truncate">{line.receipt.fileName}</a>
                <span className="text-[11px] text-[var(--ecs-muted)] ml-auto shrink-0">attached</span>
                {removeReceipt && (
                  <button type="button" formAction={removeReceipt} className="text-[var(--ecs-red)] hover:underline text-xs shrink-0">Remove</button>
                )}
              </div>
            )}
            <label className="flex min-h-[8.5rem] flex-col items-center justify-center cursor-pointer rounded-lg border-2 border-dashed border-[var(--ecs-border)] bg-white px-4 py-5 text-center hover:border-[var(--ecs-navy)]">
              <input type="file" name="receiptFile" accept="image/*,.pdf" className="hidden" onChange={(e) => setFileName(e.target.files?.[0]?.name ?? '')} />
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mx-auto text-[var(--ecs-muted)] mb-1"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z" /><circle cx="12" cy="13" r="3" /></svg>
              <div className="text-sm font-medium text-[var(--ecs-navy)]">{fileName || (line.receipt ? 'Attach a new file to replace it' : 'Attach or photograph the receipt')}</div>
              <div className="text-[11px] text-[var(--ecs-muted)] mt-0.5">The expense details below will be <b>pre-filled from the receipt</b> (AI pre-fill coming soon).</div>
            </label>
          </div>
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
  );

  if (!open || typeof document === 'undefined') return trigger;
  return (
    <>
      {trigger}
      {createPortal(
    <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center overflow-y-auto p-6">
      <div className="bg-white rounded-xl w-full max-w-4xl shadow-2xl my-2">
        <div className="bg-[var(--ecs-navy)] text-white px-5 py-3 rounded-t-xl flex items-center justify-between">
          <span className="font-semibold text-lg">Edit Expense — {line.label}</span>
          <button type="button" onClick={() => setOpen(false)} className="text-white/90">✕</button>
        </div>
        <form action={submit} className="p-5 space-y-4">
          {/* ── 1. SOURCE OF THE VALUE (leads the form) ──────────────────────── */}
          {line.manualEntry ? (
            // (a) A claimant-added out-of-pocket expense is RECEIPT-FIRST: the receipt is the source a future
            // AI-OCR pass reads to pre-fill the detail fields below. "No Receipt" → a justification instead.
            <div className="rounded-lg border border-[var(--ecs-border)] bg-[var(--ecs-panel)] p-3 space-y-3">
              <div className="text-sm font-semibold text-[var(--ecs-navy)]">Receipt <span className="font-normal text-[var(--ecs-muted)]">— start here</span></div>
              <input type="hidden" name="receiptType" value={receiptType} />
              {receiptInner}
            </div>
          ) : line.receiptRequired ? (
            // (b) A PRE-FILLED line that STILL needs a receipt for the actual spend — e.g. hotel accommodation,
            // reimbursable airfare. The dates / nights come from the TMC feed, but the traveller paid and must
            // attach the receipt for the actual amount.
            <div className="space-y-3">
              <div className="rounded-lg border p-3 space-y-1" style={{ borderColor: '#9cc3e6', background: '#eef5fc' }}>
                <div className="text-sm font-semibold text-[var(--ecs-navy)]">Dates pre-filled from the approved TR &amp; TMC feed</div>
                <p className="text-[12px] text-[var(--ecs-navy-2)]">The stay days / nights and dates are seeded from the approved estimate and the <b>TMC feed</b> (booked PNRs). You still need to <b>attach the receipt</b> for the actual amount paid.</p>
              </div>
              <div className="rounded-lg border border-[var(--ecs-border)] bg-[var(--ecs-panel)] p-3 space-y-3">
                <div className="text-sm font-semibold text-[var(--ecs-navy)]">Receipt <span className="font-normal text-[var(--ecs-muted)]">— attach the actual-spend receipt</span></div>
                <input type="hidden" name="receiptType" value={receiptType} />
                {receiptInner}
              </div>
            </div>
          ) : (
            // (c) A PRE-FILLED allowance with NO receipt — ODA / per-diem, or a centrally-billed (CTC) line.
            <div className="rounded-lg border p-3 space-y-1" style={{ borderColor: '#9cc3e6', background: '#eef5fc' }}>
              <input type="hidden" name="receiptType" value={line.receiptType} />
              <div className="text-sm font-semibold text-[var(--ecs-navy)]">Pre-filled from the approved TR &amp; TMC feed</div>
              <p className="text-[12px] text-[var(--ecs-navy-2)]">This is a budget line from the approved Travel Request. Its amount is seeded from the approved estimate, and the stay days / dates come from the <b>TMC feed</b> (booked PNRs). <b>Review</b> the values below — an entitlement / per-diem carries no receipt.</p>
            </div>
          )}

          {/* ── 2. EXPENSE DETAILS — full ECS datapoint set, in the same field order as the View modal. ── */}
          <ExpenseDetailFields
            expenseTypes={expenseTypes}
            currencies={currencies}
            labelFixed={line.label}
            defaults={{ expenseTypeId: line.expenseTypeId, manualEntry: line.manualEntry, transactionDate: line.transactionDate, currency: line.currency, foreignAmount: line.foreignAmount, actualSgd: line.actualSgd, sponsorSgd: line.sponsorSgd, reason: line.reason }}
          />

          {/* ── 3. STAY BREAKDOWN — placed AFTER the expense details to match the View modal order (the
              per-stay / per-city table sits below the detail fields). Same columns + funded (personal-
              excluded) split as the View. The stay dates, nights and nightly rate are edited in the claim's
              "Funded basis" card; here they explain the amount (funded nights × rate). */}
          {((accom && accom.length > 0) || (oda && oda.length > 0)) && (
            <div className="rounded-lg border border-[var(--ecs-border)] bg-[var(--ecs-panel)] p-3 space-y-2">
              <div className="flex items-baseline justify-between gap-3">
                <div className="text-sm font-semibold text-[var(--ecs-navy)]">
                  {accom && accom.length > 0 ? 'Accommodation stay' : 'Overseas daily allowance'}
                  <span className="font-normal text-[var(--ecs-muted)]"> — dates &amp; {accom && accom.length > 0 ? 'nights' : 'days'} from the approved TR &amp; TMC feed</span>
                </div>
              </div>
              <StayBreakdown oda={oda} accom={accom} />
              <p className="text-[11px] text-[var(--ecs-muted)]">
                The <b>funded amount</b> is {accom && accom.length > 0 ? 'funded nights' : 'funded days'} × rate (personal time excluded). To change the stay dates, {accom && accom.length > 0 ? 'nights' : 'days'} or rate, use the <b>Funded basis</b> panel on the claim; enter the <b>actual amount paid</b> in Amount (SGD) above and attach the receipt.
              </p>
            </div>
          )}

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
