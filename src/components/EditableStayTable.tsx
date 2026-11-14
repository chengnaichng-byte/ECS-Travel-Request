'use client';
// §4.5 EDITABLE per-stay / per-city funded basis. The stay dates, nightly rate and cities are SEEDED from
// the approved TR and the TMC feed, but the claimant can override them to the ACTUAL stay and add further
// stays (a multi-city trip, an unplanned extra night). Columns mirror the read-only View breakdown; the
// editable cells are City, Check-in / Check-out (or Arrival / Departure) and the rate. Duration, Personal,
// Funded and Amount are DERIVED live (Personal comes from the personal-period declaration — read-only here).
// The rows post as accom_<i>_* / oda_<i>_* hidden inputs (+ accomCount / odaCount) that the claim's
// updateClaimExpenseLine action reads, writing accomBasisJson / odaBasisJson and recomputing the line amount.
import { useEffect, useState } from 'react';

export interface StayCityOpt { code: string; name: string; countryCode: string; countryName: string }
export interface EditStayRow { city: string; from: string; to: string; rate: number; personal: number }

const HI = '#f0faf5';
const HIBORDER = '#a7dcc6';
const fmt = (n: number) => n.toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const toMs = (s: string) => { const d = s ? Date.parse(`${s}T00:00:00Z`) : NaN; return Number.isNaN(d) ? null : d; };

export function EditableStayTable({ kind, rows: initial, cities, onTotalChange }: {
  kind: 'accom' | 'oda';
  rows: EditStayRow[];
  cities: StayCityOpt[];
  onTotalChange?: (total: number) => void;
}) {
  const isAccom = kind === 'accom';
  const [rows, setRows] = useState<EditStayRow[]>(initial.length ? initial : []);

  const span = (r: EditStayRow) => { const a = toMs(r.from), b = toMs(r.to); if (a == null || b == null) return 0; const n = Math.round((b - a) / 86400000); return isAccom ? Math.max(n, 0) : Math.max(n + 1, 0); };
  const funded = (r: EditStayRow) => Math.max(span(r) - (Number(r.personal) || 0), 0);
  const amount = (r: EditStayRow) => Math.round(funded(r) * (Number(r.rate) || 0) * 100) / 100;
  const total = Math.round(rows.reduce((s, r) => s + amount(r), 0) * 100) / 100;

  useEffect(() => { onTotalChange?.(total); }, [total, onTotalChange]);

  const cityOf = (code: string) => cities.find((c) => c.code === code);
  const set = (i: number, patch: Partial<EditStayRow>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const addRow = () => setRows((rs) => [...rs, { city: '', from: '', to: '', rate: 0, personal: 0 }]);
  const removeRow = (i: number) => setRows((rs) => rs.filter((_, j) => j !== i));

  const unit = isAccom ? 'night' : 'day';
  const dateFrom = isAccom ? 'Check In Date' : 'Arrival Date';
  const dateTo = isAccom ? 'Check Out Date' : 'Departure Date';
  const rateLabel = isAccom ? 'Avg rate/night (SGD)' : 'ODA Rate';
  const amountFirst = !isAccom; // ODA shows Rate then Amount; accommodation shows Amount then Rate (matches the View)

  return (
    <div className="space-y-2">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr>
            <th className="th">Destination Country/Region</th><th className="th">City</th>
            <th className="th">{dateFrom}</th><th className="th">{dateTo}</th>
            <th className="th text-right">Duration</th>
            <th className="th text-right" style={{ background: HI }}>Personal</th>
            <th className="th text-right" style={{ background: HI }}>Funded {unit}s</th>
            {amountFirst && <th className="th text-right">{rateLabel}</th>}
            <th className="th text-right">Amount (SGD)</th>
            {!amountFirst && <th className="th text-right">{rateLabel}</th>}
            <th className="th" />
          </tr></thead>
          <tbody>
            {rows.map((r, i) => {
              const c = cityOf(r.city);
              const d = span(r), f = funded(r);
              const rateCell = (
                <td className="td" style={{ minWidth: 110 }}>
                  <input type="number" step="any" value={r.rate} onChange={(e) => set(i, { rate: Number(e.target.value) })} className="field text-right w-24 ml-auto" placeholder="0.00" />
                </td>
              );
              return (
                <tr key={i}>
                  <td className="td text-[var(--ecs-muted)] whitespace-nowrap">{c?.countryName ?? '—'}</td>
                  <td className="td" style={{ minWidth: 130 }}>
                    <select value={r.city} onChange={(e) => set(i, { city: e.target.value })} className="field">
                      <option value="">Select…</option>
                      {cities.map((o) => <option key={o.code} value={o.code}>{o.name}</option>)}
                    </select>
                  </td>
                  <td className="td" style={{ minWidth: 150 }}><input type="date" value={r.from} onChange={(e) => set(i, { from: e.target.value })} className="field" /></td>
                  <td className="td" style={{ minWidth: 150 }}><input type="date" value={r.to} onChange={(e) => set(i, { to: e.target.value })} className="field" /></td>
                  <td className="td text-right whitespace-nowrap">{d} {unit}{d === 1 ? '' : 's'}</td>
                  <td className={`td text-right ${r.personal > 0 ? 'font-medium text-amber-700' : 'text-[var(--ecs-muted)]'}`} style={{ background: HI }}>{r.personal}</td>
                  <td className="td text-right font-medium" style={{ background: HI }}>{f}</td>
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
              <tr><td colSpan={10} className="td text-center text-[var(--ecs-muted)] py-3">No stays — add one.</td></tr>
            )}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={amountFirst ? 8 : 8} className="td text-right text-[var(--ecs-muted)]">Funded total (becomes the claimed amount on save)</td>
              <td className="td text-right font-semibold whitespace-nowrap" style={{ borderTop: `2px solid ${HIBORDER}` }}>{fmt(total)}</td>
              <td className="td" style={{ borderTop: `2px solid ${HIBORDER}` }} />
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="flex items-center justify-between gap-3">
        <p className="text-[11px] text-[var(--ecs-muted)]">Seeded from the TMC feed / approved TR — edit the dates, rate or city to the <b>actual</b> stay, or add another. Personal {unit}s come from the personal-period declaration.</p>
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
