'use client';
// ECS per-line "Edit Expense" dialog — RECEIPT-FIRST. The receipt leads the form: pick the receipt type,
// then (for a receipted expense) attach/capture the receipt; the expense detail fields follow as the
// values a future AI-OCR pass would PRE-FILL from that receipt. A "No Receipt" expense (e.g. per-diem/ODA)
// skips the capture and goes straight to a justification + manual entry. OCR itself is not built yet — the
// capture zone and the "pre-fill from receipt" affordance are the groundwork so the ordering is ready.
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { ExpenseDetailFields, type ExpenseTypeOpt } from '@/components/ExpenseDetailFields';
import { EditableStayTable, type EditStayRow, type StayCityOpt } from '@/components/EditableStayTable';

export interface EditLine {
  expenseTypeId: string; label: string; manualEntry: boolean;
  receiptRequired: boolean;   // true = traveller pays out-of-pocket and must attach a receipt (hotel, reimbursable
                              // airfare, claimant-added). false = ODA / per-diem allowance or centrally-billed (CTC).
  transactionDate: string; currency: string; foreignAmount: number | null; actualSgd: number; sponsorSgd: number; receiptType: string; reason: string;
  receipt?: { id: string; fileName: string; href: string } | null;   // §2 the persisted per-line receipt
}

const ICON_BTN = 'inline-grid place-items-center w-7 h-7 rounded hover:bg-[var(--ecs-panel-2)] text-[var(--ecs-navy-2)]';
const RECEIPTS: [string, string][] = [['LOCAL_GST', 'Local Receipt (With GST)'], ['FOREIGN_NO_GST', 'Receipt (Foreign / Local Without GST)'], ['NO_RECEIPT', 'No Receipt']];

export function EditExpenseModal({ action, removeReceipt, expenseTypes, currencies, line, oda, accom, cities, periods }: {
  action: (fd: FormData) => void;
  removeReceipt?: (fd: FormData) => void;
  expenseTypes: ExpenseTypeOpt[];
  currencies: string[];
  line: EditLine;
  oda?: EditStayRow[];      // §4.5 editable per-city ODA funded basis (ODA lines)
  accom?: EditStayRow[];    // §4.5 editable per-stay accommodation funded basis (accommodation lines)
  cities?: StayCityOpt[];   // city options for the stay editor (add / change a city)
  periods?: { start: string; end: string }[];   // personal periods — posted so the server recomputes funded
}) {
  const [open, setOpen] = useState(false);
  const [receiptType, setReceiptType] = useState(line.receiptType);
  const [fileName, setFileName] = useState('');
  const hasReceipt = receiptType !== 'NO_RECEIPT';
  // Editable stay basis — the accommodation / ODA funded breakdown drives the line amount.
  const stayKind: 'accom' | 'oda' | null = accom && accom.length ? 'accom' : oda && oda.length ? 'oda' : null;
  const stayRows: EditStayRow[] = stayKind === 'accom' ? accom! : stayKind === 'oda' ? oda! : [];
  const [stayTotal, setStayTotal] = useState(line.actualSgd);
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
            <label className="flex flex-col items-center justify-center cursor-pointer rounded-lg border-2 border-dashed border-[var(--ecs-border)] bg-white px-4 py-3 text-center hover:border-[var(--ecs-navy)]">
              <input type="file" name="receiptFile" accept="image/*,.pdf" className="hidden" onChange={(e) => setFileName(e.target.files?.[0]?.name ?? '')} />
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mx-auto text-[var(--ecs-muted)] mb-0.5"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z" /><circle cx="12" cy="13" r="3" /></svg>
              <div className="text-sm font-medium text-[var(--ecs-navy)]">{fileName || (line.receipt ? 'Attach a new file to replace it' : 'Attach or photograph the receipt')}</div>
              <div className="text-[11px] text-[var(--ecs-muted)] mt-0.5">The expense details below will be <b>pre-filled from the receipt</b> (AI pre-fill coming soon).</div>
            </label>
          </div>
        ) : (
          <div>
            <label className="label text-amber-800">Justification for no receipt</label>
            <textarea name="noReceiptReason" rows={3} className="field" placeholder="Why is there no receipt for this expense?" />
          </div>
        )}
      </div>
      <div className="sm:w-64 shrink-0 flex flex-col justify-center gap-2 text-sm">
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
    <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center overflow-y-auto p-4 sm:p-6">
      <div className="bg-white rounded-xl w-full max-w-4xl shadow-2xl my-2 flex flex-col max-h-[90vh]">
        <div className="bg-[var(--ecs-navy)] text-white px-5 py-3 rounded-t-xl flex items-center justify-between shrink-0">
          <span className="font-semibold text-lg">Edit Expense — {line.label}</span>
          <button type="button" onClick={() => setOpen(false)} className="text-white/90">✕</button>
        </div>
        {/* Scrollable body (flex-1) between a pinned header and a sticky footer, so the whole modal fits
            the window and the Save / Cancel controls stay in view at any height. */}
        <form action={submit} className="flex flex-col flex-1 min-h-0">
          <div className="p-5 space-y-4 overflow-y-auto flex-1 min-h-0">
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
            <div className="rounded-lg border border-[var(--ecs-border)] bg-[var(--ecs-panel)] p-3 space-y-3">
              <div className="text-sm font-semibold text-[var(--ecs-navy)]">Receipt <span className="font-normal text-[var(--ecs-muted)]">— attach the actual-spend receipt</span></div>
              <input type="hidden" name="receiptType" value={receiptType} />
              {receiptInner}
            </div>
          ) : (
            // (c) A PRE-FILLED allowance with NO receipt — ODA / per-diem, or a centrally-billed (CTC) line.
            <div className="rounded-lg border p-3 space-y-1" style={{ borderColor: '#9cc3e6', background: '#eef5fc' }}>
              <input type="hidden" name="receiptType" value={line.receiptType} />
              <div className="text-sm font-semibold text-[var(--ecs-navy)]">Pre-filled from the approved TR</div>
              <p className="text-[12px] text-[var(--ecs-navy-2)]">This is a budget line from the approved Travel Request. Its amount is seeded from the approved estimate, and the stay days / dates are <b>inferred from your booked flights</b> (the feed carries no hotel dates). <b>Review</b> the values below — an entitlement / per-diem carries no receipt.</p>
            </div>
          )}

          {/* ── 2. EXPENSE DETAILS — full ECS datapoint set, in the same field order as the View modal. ── */}
          <ExpenseDetailFields
            expenseTypes={expenseTypes}
            currencies={currencies}
            labelFixed={line.label}
            amountOverride={stayKind ? stayTotal : undefined}
            defaults={{ expenseTypeId: line.expenseTypeId, manualEntry: line.manualEntry, transactionDate: line.transactionDate, currency: line.currency, foreignAmount: line.foreignAmount, actualSgd: line.actualSgd, sponsorSgd: line.sponsorSgd, reason: line.reason }}
          />

          {/* ── 3. STAY BREAKDOWN — EDITABLE, placed after the detail fields (matching the View order). The
              dates, rate and cities are seeded from the TMC feed / approved TR but can be overridden to the
              actual stay, and more stays added; the funded total becomes the claimed Amount on save. */}
          {stayKind && (
            <div className="rounded-lg border border-[var(--ecs-border)] bg-[var(--ecs-panel)] p-3 space-y-2">
              <div className="text-sm font-semibold text-[var(--ecs-navy)]">
                {stayKind === 'accom' ? 'Accommodation — claimable nights' : 'Overseas daily allowance — claimable days'}
                <span className="font-normal text-[var(--ecs-muted)]"> — stay inferred from your flights; confirm the actual {stayKind === 'accom' ? 'nights' : 'days'} (personal excluded)</span>
              </div>
              <EditableStayTable kind={stayKind} rows={stayRows} cities={cities ?? []} declaredPeriods={periods ?? []} onTotalChange={setStayTotal} />
            </div>
          )}

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
