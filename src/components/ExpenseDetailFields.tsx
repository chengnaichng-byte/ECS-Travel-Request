'use client';
// The full ECS "Expense Detail" datapoint set, shared by the Add and Edit expense modals so both capture
// exactly what the read-only View modal shows: transaction date, expense type, payment type, currency +
// foreign amount + exchange rate, the GST block (rate / amount / code / base), the sponsorship block, and
// the reason. The GST amount, base amount and exchange rate are DERIVED (read-only) and recompute live from
// the amount, the selected expense type's tax rate, and the foreign amount — mirroring how ECS auto-fills
// them. Only the user-entered fields post to the server action; the derived ones are display parity.
import { useState } from 'react';

export interface ExpenseTypeOpt { id: string; name: string; gstCode: string; taxRatePct: number }
export interface ExpenseDefaults {
  expenseTypeId: string; manualEntry: boolean; transactionDate: string;
  currency: string; foreignAmount: number | null; actualSgd: number; sponsorSgd: number; reason: string;
}

const fmt = (n: number) => n.toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const RO = 'field bg-[var(--ecs-readonly,#f1f1f6)] text-[var(--ecs-navy-2)]';

export function ExpenseDetailFields({ expenseTypes, currencies, defaults, labelFixed }: {
  expenseTypes: ExpenseTypeOpt[];
  currencies: string[];
  defaults?: ExpenseDefaults;        // present = Edit (pre-filled); absent = Add (blank + required)
  labelFixed?: string;               // a budget line's fixed expense-type name (type not editable)
}) {
  const isAdd = !defaults;
  const [expenseTypeId, setExpenseTypeId] = useState(defaults?.expenseTypeId ?? '');
  const [currency, setCurrency] = useState(defaults?.currency ?? 'SGD');
  const [foreign, setForeign] = useState(defaults ? String(defaults.foreignAmount ?? defaults.actualSgd ?? '') : '');
  const [amountSgd, setAmountSgd] = useState(defaults ? String(defaults.actualSgd ?? '') : '');
  const [sponsorSgd, setSponsorSgd] = useState(defaults ? String(defaults.sponsorSgd ?? '') : '');

  const type = expenseTypes.find((t) => t.id === expenseTypeId);
  const isForeign = currency !== 'SGD';
  const sgd = parseFloat(amountSgd) || 0;
  const fgn = parseFloat(foreign) || 0;
  const rate = type?.taxRatePct ?? 0;                                   // GST rate from the expense type
  const gstAmount = rate > 0 ? Math.round((sgd * rate / (100 + rate)) * 100) / 100 : 0;
  const baseAmount = Math.round((sgd - gstAmount) * 100) / 100;
  const exchangeRate = isForeign && fgn > 0 ? sgd / fgn : 1;
  const sgdReq = isAdd ? <span className="text-[var(--ecs-red)]">*</span> : null;

  return (
    <div className="space-y-4">
      <div className="text-xs font-semibold uppercase tracking-wide text-[var(--ecs-muted)]">Expense details</div>

      {/* Transaction date · Expense type */}
      <div className="grid md:grid-cols-2 gap-4">
        <div><label className="label">Transaction Date {sgdReq}</label>
          <input name="transactionDate" type="date" required={isAdd} defaultValue={defaults?.transactionDate} className="field" />
        </div>
        <div><label className="label">Expense Type {sgdReq}</label>
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
      </div>

      {/* Payment type */}
      <div><label className="label">Payment Type</label>
        <div className="flex flex-wrap gap-x-5 gap-y-1 pt-1 text-sm">
          <label className="flex items-center gap-1.5"><input type="radio" name="paymentType" value="SELF" defaultChecked /> Reimbursement To Staff</label>
          <label className="flex items-center gap-1.5"><input type="radio" name="paymentType" value="CTC" /> NTU Corporate Card (CTC)</label>
        </div>
      </div>

      {/* Currency · amount · (foreign → exchange rate) */}
      <div className="grid md:grid-cols-2 gap-4">
        <div><label className="label">Currency {sgdReq}</label>
          <select name="currency" value={currency} onChange={(e) => setCurrency(e.target.value)} className="field">
            {currencies.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        {isForeign ? (
          <div><label className="label">Amount ({currency}) {sgdReq}</label>
            <input name="foreignAmount" type="number" step="any" value={foreign} onChange={(e) => setForeign(e.target.value)} className="field text-right" placeholder="0.00" />
          </div>
        ) : <input type="hidden" name="foreignAmount" value={amountSgd} />}
        <div><label className="label">Exchange Rate</label>
          <input className={`${RO} text-right`} value={exchangeRate.toLocaleString('en-SG', { minimumFractionDigits: 5, maximumFractionDigits: 5 })} disabled />
        </div>
        <div><label className="label">Amount (SGD) {sgdReq}</label>
          <input name="amount" type="number" step="any" required={isAdd} value={amountSgd} onChange={(e) => setAmountSgd(e.target.value)} className="field text-right" placeholder="0.00" />
        </div>
      </div>

      {/* GST block — rate + code from the expense type; amount + base derived from the SGD amount. */}
      <div className="rounded-lg border border-[var(--ecs-border)] p-3">
        <div className="text-sm font-medium text-[var(--ecs-navy)] mb-2">GST</div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div><label className="label">GST Rate (%)</label><input className={`${RO} text-right`} value={fmt(rate)} disabled /></div>
          <div><label className="label">GST Code</label><input className={RO} value={type?.gstCode ?? '—'} disabled /></div>
          <div><label className="label">GST Amount</label><input className={`${RO} text-right`} value={fmt(gstAmount)} disabled /></div>
          <div><label className="label">Base Amount</label><input className={`${RO} text-right`} value={fmt(baseAmount)} disabled /></div>
        </div>
      </div>

      {/* Sponsorship (for gross claims) */}
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

      {/* Reason */}
      <div><label className="label">Reason For Expense</label>
        <textarea name="reason" rows={2} defaultValue={defaults?.reason ?? ''} className="field" />
      </div>
    </div>
  );
}
