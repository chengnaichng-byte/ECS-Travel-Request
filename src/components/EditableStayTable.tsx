'use client';
// §4.5 EDITABLE claimable-segment basis. Each row is a CLAIMABLE stay segment (personal time already
// carved out when the rows were seeded from the booked window − the declared personal periods). The
// claimant overrides the dates / rate / city to the ACTUAL claimable stay and can add further segments
// (a multi-city trip, or the two halves of a stay split by a personal break). Duration and Amount derive
// live (Amount = nights/days × rate — no personal subtraction, so a deliberately claimed personal date
// still counts, and is flagged). Rows post as accom_<i>_* / oda_<i>_* (+ accomCount / odaCount) that the
// claim's updateClaimExpenseLine action stores and totals into the line amount.
import { useEffect, useState } from 'react';
import { SourceChip, type StaySrc } from '@/components/StayBreakdown';

export interface StayCityOpt { code: string; name: string; countryCode: string; countryName: string }
export interface EditStayRow { city: string; from: string; to: string; rate: number; src?: StaySrc }
export interface PeriodLite { start: string; end: string }

const DAY = 86400000;
const fmt = (n: number) => n.toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const toMs = (s: string) => { const d = s ? Date.parse(`${s}T00:00:00Z`) : NaN; return Number.isNaN(d) ? null : d; };
const pMs = (s: string) => Date.parse(`${s}T00:00:00Z`);

export function EditableStayTable({ kind, rows: initial, cities, declaredPeriods = [], onTotalChange }: {
  kind: 'accom' | 'oda';
  rows: EditStayRow[];
  cities: StayCityOpt[];
  declaredPeriods?: PeriodLite[];
  onTotalChange?: (total: number) => void;
}) {
  const isAccom = kind === 'accom';
  const [rows, setRows] = useState<EditStayRow[]>(initial.length ? initial : []);

  const span = (r: EditStayRow) => { const a = toMs(r.from), b = toMs(r.to); if (a == null || b == null) return 0; const n = Math.round((b - a) / DAY); return isAccom ? Math.max(n, 0) : Math.max(n + 1, 0); };
  const amount = (r: EditStayRow) => Math.round(span(r) * (Number(r.rate) || 0) * 100) / 100;
  const total = Math.round(rows.reduce((s, r) => s + amount(r), 0) * 100) / 100;
  // Does this row cover a declared-personal unit? (allow + flag — the claim still goes through.)
  const coversPersonal = (r: EditStayRow) => {
    const a = toMs(r.from), b = toMs(r.to); if (a == null || b == null || !declaredPeriods.length) return false;
    const last = isAccom ? b - DAY : b;
    for (let d = a; d <= last; d += DAY) if (declaredPeriods.some((p) => p.start && p.end && d >= pMs(p.start) && d <= pMs(p.end))) return true;
    return false;
  };

  useEffect(() => { onTotalChange?.(total); }, [total, onTotalChange]);

  const cityOf = (code: string) => cities.find((c) => c.code === code);
  // Any edit to a seeded row flips its provenance to "you confirmed"; a new row is claimant-entered.
  const set = (i: number, patch: Partial<EditStayRow>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch, src: 'edited' as StaySrc } : r)));
  const addRow = () => setRows((rs) => [...rs, { city: '', from: '', to: '', rate: 0, src: 'edited' }]);
  const removeRow = (i: number) => setRows((rs) => rs.filter((_, j) => j !== i));

  const unit = isAccom ? 'night' : 'day';
  const dateFrom = isAccom ? 'Check In Date' : 'From';
  const dateTo = isAccom ? 'Check Out Date' : 'To';
  const rateLabel = isAccom ? 'Avg rate/night (SGD)' : 'ODA Rate';
  const amountFirst = !isAccom; // ODA shows Rate then Amount; accommodation shows Amount then Rate (matches the View)
  const anyPersonal = rows.some(coversPersonal);

  return (
    <div className="space-y-2">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr>
            <th className="th">Destination Country/Region</th><th className="th">City</th>
            <th className="th">{dateFrom}</th><th className="th">{dateTo}</th>
            <th className="th text-right">Claimable {unit}s</th>
            {amountFirst && <th className="th text-right">{rateLabel}</th>}
            <th className="th text-right">Amount (SGD)</th>
            {!amountFirst && <th className="th text-right">{rateLabel}</th>}
            <th className="th" />
          </tr></thead>
          <tbody>
            {rows.map((r, i) => {
              const c = cityOf(r.city);
              const d = span(r);
              const warn = coversPersonal(r);
              const rateCell = (
                <td className="td" style={{ minWidth: 110 }}>
                  <input type="number" step="any" value={r.rate} onChange={(e) => set(i, { rate: Number(e.target.value) })} className="field text-right w-24 ml-auto" placeholder="0.00" />
                </td>
              );
              return (
                <tr key={i} style={warn ? { background: '#fdf6e3' } : undefined}>
                  <td className="td text-[var(--ecs-muted)] whitespace-nowrap">{c?.countryName ?? '—'} <SourceChip src={r.src} /></td>
                  <td className="td" style={{ minWidth: 130 }}>
                    <select value={r.city} onChange={(e) => set(i, { city: e.target.value })} className="field">
                      <option value="">Select…</option>
                      {cities.map((o) => <option key={o.code} value={o.code}>{o.name}</option>)}
                    </select>
                  </td>
                  <td className="td" style={{ minWidth: 148 }}><input type="date" value={r.from} onChange={(e) => set(i, { from: e.target.value })} className="field" /></td>
                  <td className="td" style={{ minWidth: 148 }}><input type="date" value={r.to} onChange={(e) => set(i, { to: e.target.value })} className="field" /></td>
                  <td className="td text-right whitespace-nowrap font-medium">
                    {d} {unit}{d === 1 ? '' : 's'}
                    {warn && <span title="This row covers a date you declared personal — it will still be claimed, and flagged for review." className="ml-1 text-amber-600 cursor-help">⚠</span>}
                  </td>
                  {amountFirst && rateCell}
                  <td className="td text-right font-medium whitespace-nowrap">{fmt(amount(r))}</td>
                  {!amountFirst && rateCell}
                  <td className="td text-center">
                    <button type="button" onClick={() => removeRow(i)} title="Remove this stay" className="inline-grid place-items-center w-7 h-7 rounded hover:bg-red-50 text-[var(--ecs-red)]">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
                    </button>
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr><td colSpan={8} className="td text-center text-[var(--ecs-muted)] py-3">No claimable {unit}s — add one, or the whole stay was personal.</td></tr>
            )}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={amountFirst ? 6 : 6} className="td text-right text-[var(--ecs-muted)]">Claimed total (becomes the claimed amount on save)</td>
              <td className="td text-right font-semibold whitespace-nowrap" style={{ borderTop: '2px solid var(--ecs-border)' }}>{fmt(total)}</td>
              <td className="td" style={{ borderTop: '2px solid var(--ecs-border)' }} />
            </tr>
          </tfoot>
        </table>
      </div>

      {anyPersonal && (
        <p className="text-[11px] text-amber-700">⚠ A row covers a date you declared personal — it will still be claimed and flagged for review.</p>
      )}
      <div className="flex items-center justify-between gap-3">
        <p className="text-[11px] text-[var(--ecs-muted)]">Each row is a <b>claimable</b> segment (personal time excluded). Dates tagged <b>from flights</b> are inferred from your itinerary — the feed carries no hotel dates, so confirm them; editing a row marks it <b>you confirmed</b>. A personal break mid-stay shows as two rows.</p>
        <button type="button" onClick={addRow} className="btn-secondary text-xs whitespace-nowrap">＋ Add {isAccom ? 'stay' : 'city'}</button>
      </div>

      {/* Hidden inputs the server action reads (accom_<i>_* / oda_<i>_* + the count). */}
      <input type="hidden" name={isAccom ? 'accomCount' : 'odaCount'} value={rows.length} />
      {rows.map((r, i) => (
        isAccom ? (
          <span key={i}>
            <input type="hidden" name={`accom_${i}_city`} value={r.city} />
            <input type="hidden" name={`accom_${i}_checkIn`} value={r.from} />
            <input type="hidden" name={`accom_${i}_checkOut`} value={r.to} />
            <input type="hidden" name={`accom_${i}_nightlyRate`} value={r.rate} />
          </span>
        ) : (
          <span key={i}>
            <input type="hidden" name={`oda_${i}_city`} value={r.city} />
            <input type="hidden" name={`oda_${i}_country`} value={cityOf(r.city)?.countryCode ?? ''} />
            <input type="hidden" name={`oda_${i}_arrive`} value={r.from} />
            <input type="hidden" name={`oda_${i}_depart`} value={r.to} />
            <input type="hidden" name={`oda_${i}_dailyRate`} value={r.rate} />
          </span>
        )
      ))}
    </div>
  );
}
