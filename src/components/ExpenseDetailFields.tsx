'use client';
// The full ECS "Expense Detail" datapoint set, shared by the Add and Edit expense modals. The field
// ORDER and the two-column layout mirror the read-only View modal exactly, so the editable form and the
// View show the same datapoints in the same places: LEFT column = Transaction Date, Expense Type,
// Currency · Amount; RIGHT column = Payment Type, then the GST block (GST Rate, GST Amount, GST Code,
// Base Amount) followed by Exchange Rate and Amount (SGD); then the Sponsorship block and Reason full-width.
// The GST amount, base amount and exchange rate are DERIVED (read-only) and recompute live — display parity
// with ECS, not the authoritative tax logic. Only the user-entered fields post to the server action.
import { useState } from 'react';

export interface ExpenseTypeOpt { id: string; name: string; gstCode: string; taxRatePct: number }
export interface ExpenseDefaults {
  expenseTypeId: string; manualEntry: boolean; transactionDate: string;
  currency: string; foreignAmount: number | null; actualSgd: number; sponsorSgd: number; reason: string;
}

const fmt = (n: number) => n.toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const RO = 'field bg-[var(--ecs-readonly,#f1f1f6)] text-[var(--ecs-navy-2)]';

export function ExpenseDetailFields({ expenseTypes, currencies, defaults, labelFixed, amountOverride }: {
  expenseTypes: ExpenseTypeOpt[];
  currencies: string[];
  defaults?: ExpenseDefaults;        // present = Edit (pre-filled); absent = Add (blank + required)
  labelFixed?: string;               // a budget line's fixed expense-type name (type not editable)
  amountOverride?: number | null;    // when set (accommodation / ODA), the Amount (SGD) is DRIVEN by the stay
                                      // breakdown below (funded nights/days × rate) — shown read-only, not typed.
}) {
  const isAdd = !defaults;
  const [expenseTypeId, setExpenseTypeId] = useState(defaults?.expenseTypeId ?? '');
  const [currency, setCurrency] = useState(defaults?.currency ?? 'SGD');
  const [foreign, setForeign] = useState(defaults ? String(defaults.foreignAmount ?? defaults.actualSgd ?? '') : '');
  const [amountSgd, setAmountSgd] = useState(defaults ? String(defaults.actualSgd ?? '') : '');
  const [sponsorSgd, setSponsorSgd] = useState(defaults ? String(defaults.sponsorSgd ?? '') : '');

  const type = expenseTypes.find((t) => t.id === expenseTypeId);
  const isForeign = currency !== 'SGD';
  const overridden = amountOverride != null;                             // amount driven by the stay breakdown
  const sgd = amountOverride != null ? amountOverride : (parseFloat(amountSgd) || 0);
  const fgn = parseFloat(foreign) || 0;
  const rate = type?.taxRatePct ?? 0;                                   // GST rate from the expense type
  const gstAmount = rate > 0 ? Math.round((sgd * rate / (100 + rate)) * 100) / 100 : 0;
  const baseAmount = Math.round((sgd - gstAmount) * 100) / 100;
  const exchangeRate = isForeign && fgn > 0 ? sgd / fgn : 1;
  const req = isAdd ? <span className="text-[var(--ecs-red)]">*</span> : null;

  return (
    <div className="space-y-4">
      <div className="text-xs font-semibold uppercase tracking-wide text-[var(--ecs-muted)]">Expense details</div>

      {/* Two columns, in the SAME order as the read-only View modal. */}
      <div className="grid md:grid-cols-2 gap-x-6 gap-y-4">
        {/* LEFT — Transaction Date · Expense Type · Currency | Amount */}
        <div className="space-y-4">
          <div><label className="label">Transaction Date {req}</label>
            <input name="transactionDate" type="date" required={isAdd} defaultValue={defaults?.transactionDate} className="field" />
          </div>
          <div><label className="label">Expense Type {req}</label>
            {defaults && !defaults.manualEntry ? (
              <>
                <input className={RO} value={labelFixed ?? type?.name ?? ''} disabled />
                <input type="hidden" name="expenseTypeId" value={expenseTypeId} />
                <p className="text-[11px] text-[var(--ecs-muted)] mt-1">Budget line from the approved TR — type is fixed.</p>
              </>
            ) : (
              <select name="expenseTypeId" required value={expenseTypeId} onChange={(e) => setExpenseTypeId(e.target.value)} className="field">
                <option value="">Select…</option>
                {expenseTypes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            )}
          </div>
          <div className="grid grid-cols-[7rem_1fr] gap-3">
            <div><label className="label">Currency {req}</label>
              <select name="currency" value={currency} onChange={(e) => setCurrency(e.target.value)} className="field">
                {currencies.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div><label className="label">Amount {req}</label>
              {overridden ? (
                // amount is computed from the stay breakdown → read-only here
                <input className={`${RO} text-right`} value={fmt(sgd)} disabled />
              ) : isForeign ? (
                // foreign currency → the transaction-currency amount is entered here; the SGD amount sits on the right
                <input name="foreignAmount" type="number" step="any" value={foreign} onChange={(e) => setForeign(e.target.value)} className="field text-right" placeholder="0.00" />
              ) : (
                // SGD → this IS the claimed amount
                <input name="amount" type="number" step="any" required={isAdd} value={amountSgd} onChange={(e) => setAmountSgd(e.target.value)} className="field text-right" placeholder="0.00" />
              )}
            </div>
          </div>
        </div>

        {/* RIGHT — Payment Type · GST (Rate, Amount, Code, Base) · Exchange Rate · Amount (SGD) */}
        <div className="space-y-4">
          <div><label className="label">Payment Type</label>
            <div className="flex flex-wrap gap-x-5 gap-y-1 pt-1 text-sm">
              <label className="flex items-center gap-1.5"><input type="radio" name="paymentType" value="SELF" defaultChecked /> Reimbursement To Staff</label>
              <label className="flex items-center gap-1.5"><input type="radio" name="paymentType" value="CTC" /> NTU Corporate Travel Card (CTC)</label>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="label">GST Rate (%)</label><input className={`${RO} text-right`} value={fmt(rate)} disabled /></div>
            <div><label className="label">GST Amount</label><input className={`${RO} text-right`} value={fmt(gstAmount)} disabled /></div>
            <div><label className="label">GST Code</label><input className={RO} value={type?.gstCode ?? '—'} disabled /></div>
            <div><label className="label">Base Amount</label><input className={`${RO} text-right`} value={fmt(baseAmount)} disabled /></div>
            <div><label className="label">Exchange Rate</label><input className={`${RO} text-right`} value={exchangeRate.toLocaleString('en-SG', { minimumFractionDigits: 5, maximumFractionDigits: 5 })} disabled /></div>
            <div><label className="label">Amount (SGD) {req}</label>
              {overridden ? (
                <input className={`${RO} text-right`} value={fmt(sgd)} disabled />
              ) : isForeign ? (
                <input name="amount" type="number" step="any" required={isAdd} value={amountSgd} onChange={(e) => setAmountSgd(e.target.value)} className="field text-right" placeholder="0.00" />
              ) : (
                <input className={`${RO} text-right`} value={fmt(sgd)} disabled />
              )}
              {overridden && <p className="text-[10px] text-[var(--ecs-muted)] mt-0.5">Driven by the stay breakdown below.</p>}
            </div>
          </div>
        </div>
      </div>
      {/* Amount routing: when the stay breakdown drives the amount, post it (and the foreign = SGD) as hidden
          fields; otherwise an SGD line still posts the foreign amount (= SGD) so the server always receives it. */}
      {overridden ? (
        <><input type="hidden" name="amount" value={sgd} /><input type="hidden" name="foreignAmount" value={sgd} /></>
      ) : !isForeign ? (
        <input type="hidden" name="foreignAmount" value={amountSgd} />
      ) : null}

      {/* Sponsorship (for gross claims) — full width, matching the View. */}
      <div className="rounded-lg border border-[var(--ecs-border)] p-3">
        <div className="text-sm font-medium text-[var(--ecs-navy)]">Sponsorship Amount (For Gross Claims)</div>
        <p className="text-[11px] text-[var(--ecs-navy-2)] mb-2">Enter the sponsorship amount only if the Amount above is the full (gross) expense. Leave 0 if it already reflects the net claimed from NTU.</p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div><label className="label">Currency</label><input className={RO} value={currency} disabled /></div>
          <div><label className="label">Sponsorship Amount</label>
            <input name="sponsorship" type="number" step="any" value={sponsorSgd} onChange={(e) => setSponsorSgd(e.target.value)} className="field text-right" placeholder="0.00" />
          </div>
          <div><label className="label">Exchange Rate</label><input className={`${RO} text-right`} value="1.00000" disabled /></div>
          <div><label className="label">Sponsorship Amount (SGD)</label><input className={`${RO} text-right`} value={fmt(parseFloat(sponsorSgd) || 0)} disabled /></div>
        </div>
      </div>

      {/* Reason — full width. */}
      <div><label className="label">Reason For Expense</label>
        <textarea name="reason" rows={2} defaultValue={defaults?.reason ?? ''} className="field" />
      </div>
    </div>
  );
}
