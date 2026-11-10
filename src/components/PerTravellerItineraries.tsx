'use client';
// §13.20 Per-traveller group itineraries. Declared UPFRONT: for each group traveller the requestor
// ticks "different itinerary" and enters that traveller's own legs (origin / destination / dates).
// Saving replaces their own legs and re-derives their ODA / accommodation from that itinerary; an
// unticked traveller follows the shared itinerary. Shown only when the group-sub-itineraries setting
// is on (gated by the Trip page). The leg editor mirrors the shared "Itinerary legs" table on the
// Trip step (same columns / styling) so both read the same way.
import { useState } from 'react';

interface Leg { originCode: string; destCode: string; departDate: string; arriveDate: string; isPersonal: boolean }
export interface ItineraryMember { employeeId: string; name: string; legs: Leg[]; airfareEstimateSgd?: number | null; action: (fd: FormData) => Promise<void> }

// Nights at a leg's destination are AUTO-COMPUTED from the dates — the stay lasts from arriving at
// this leg's destination until the next leg departs (the last leg home has no onward departure → 0).
// Same rule as the shared itinerary table and syncAutoEstimates, so the figures agree.
const DAY = 86400000;
const toD = (s: string) => (s ? new Date(s + 'T00:00:00') : null);
function legNights(ls: Leg[], i: number): number {
  const cur = ls[i]; const next = ls[i + 1];
  const from = toD(cur.arriveDate) ?? toD(cur.departDate);
  const to = next ? (toD(next.departDate) ?? toD(next.arriveDate)) : null;
  if (!from || !to) return 0;
  return Math.max(Math.round((to.getTime() - from.getTime()) / DAY), 0);
}

const blank = (origin = 'SIN'): Leg => ({ originCode: origin, destCode: '', departDate: '', arriveDate: '', isPersonal: false });

export function PerTravellerItineraries({ members, airports, sharedRoute }: {
  members: ItineraryMember[]; airports: [string, string][]; sharedRoute: string;
}) {
  return (
    <div className="space-y-3">
      <p className="text-xs text-[var(--ecs-muted)]">Shared itinerary: <span className="font-mono">{sharedRoute || '—'}</span>. Tick a traveller to give them a different route or dates; their ODA and accommodation are then costed on their own itinerary.</p>
      {members.map((m) => <MemberRow key={m.employeeId} m={m} airports={airports} />)}
    </div>
  );
}

function MemberRow({ m, airports }: { m: ItineraryMember; airports: [string, string][] }) {
  const [deviates, setDeviates] = useState(m.legs.length > 0);
  const [legs, setLegs] = useState<Leg[]>(m.legs.length ? m.legs : [blank()]);
  const setLeg = (i: number, p: Partial<Leg>) => setLegs((ls) => ls.map((l, j) => (j === i ? { ...l, ...p } : l)));
  const addLeg = () => setLegs((ls) => [...ls, blank(ls[ls.length - 1]?.destCode || 'SIN')]);
  const delLeg = (i: number) => setLegs((ls) => ls.filter((_, j) => j !== i));
  const move = (i: number, dir: -1 | 1) => setLegs((ls) => { const j = i + dir; if (j < 0 || j >= ls.length) return ls; const c = [...ls]; [c[i], c[j]] = [c[j], c[i]]; return c; });
  const [airfare, setAirfare] = useState(m.airfareEstimateSgd != null ? String(m.airfareEstimateSgd) : '');
  const json = JSON.stringify(legs.filter((l) => l.originCode && l.destCode).map((l) => ({ originCode: l.originCode, destCode: l.destCode, departDate: l.departDate, arriveDate: l.arriveDate, isPersonal: l.isPersonal })));

  return (
    <div className="rounded border border-[var(--ecs-border)] p-3">
      <label className="flex items-center gap-2 text-sm font-medium">
        <input type="checkbox" checked={deviates} onChange={(e) => setDeviates(e.target.checked)} className="w-4 h-4" />
        {m.name}
        <span className="text-xs font-normal text-[var(--ecs-muted)]">· {deviates ? 'own itinerary' : 'follows the shared itinerary'}</span>
      </label>

      {deviates && (
        <form action={m.action} className="mt-3 space-y-2">
          <input type="hidden" name="legsJson" value={json} />
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr>
                <th className="th">Leg</th><th className="th">From</th><th className="th">To</th><th className="th">Depart</th><th className="th">Arrive</th><th className="th">Nights <span className="font-normal normal-case text-[var(--ecs-muted)]">(auto)</span></th><th className="th">Personal</th><th className="th"></th>
              </tr></thead>
              <tbody>
                {legs.map((l, i) => (
                  <tr key={i}>
                    <td className="td whitespace-nowrap font-medium">Leg {i + 1}</td>
                    <td className="td"><select className="field" value={l.originCode} onChange={(e) => setLeg(i, { originCode: e.target.value })}>{airports.map(([c, n]) => <option key={c} value={c}>{n}</option>)}</select></td>
                    <td className="td"><select className="field" value={l.destCode} onChange={(e) => setLeg(i, { destCode: e.target.value })}><option value="">—</option>{airports.map(([c, n]) => <option key={c} value={c}>{n}</option>)}</select></td>
                    <td className="td"><input type="date" className="field" value={l.departDate} onChange={(e) => setLeg(i, { departDate: e.target.value, arriveDate: l.arriveDate || e.target.value })} /></td>
                    <td className="td"><input type="date" className="field" value={l.arriveDate} onChange={(e) => setLeg(i, { arriveDate: e.target.value })} /></td>
                    <td className="td"><span className="inline-flex items-center justify-center min-w-[3rem] text-sm text-[var(--ecs-muted)]" title="Auto-computed from the dates — the stay until the next leg departs">{legNights(legs, i)}</span></td>
                    <td className="td text-center"><input type="checkbox" checked={l.isPersonal} onChange={(e) => setLeg(i, { isPersonal: e.target.checked })} /></td>
                    <td className="td whitespace-nowrap">
                      <button type="button" className="btn-ghost text-xs" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move leg up">↑</button>
                      <button type="button" className="btn-ghost text-xs" disabled={i === legs.length - 1} onClick={() => move(i, 1)} aria-label="Move leg down">↓</button>
                      <button type="button" className="btn-ghost text-xs text-[var(--ecs-red)]" disabled={legs.length === 1} onClick={() => delLeg(i)} aria-label="Remove leg">✕</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-end gap-2 pt-1">
            <div>
              <label className="text-[10px] uppercase tracking-wide text-[var(--ecs-muted)] block mb-0.5">Estimated airfare (SGD)</label>
              <input type="number" min="0" step="1" name="airfareEstimateSgd" value={airfare} onChange={(e) => setAirfare(e.target.value)} className="field w-40" placeholder="e.g. 1400" />
            </div>
            <button type="button" onClick={addLeg} className="btn-secondary text-xs">＋ Add leg</button>
            <button className="btn-primary text-xs">Save itinerary</button>
          </div>
          <p className="text-[11px] text-[var(--ecs-muted)]">Seeds this traveller&apos;s Airfare line on the Estimates step (overrides the shared amount). Editable there; this figure re-applies on save.</p>
        </form>
      )}

      {!deviates && m.legs.length > 0 && (
        <form action={m.action} className="mt-2">
          <input type="hidden" name="legsJson" value="[]" />
          <button className="btn-ghost text-xs">Revert to the shared itinerary</button>
        </form>
      )}
    </div>
  );
}
