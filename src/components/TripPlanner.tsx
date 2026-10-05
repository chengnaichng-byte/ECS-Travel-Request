'use client';
// §4.4/§13.20 Trip planning — Dates, Destination & Itinerary and Travel class in one client
// component so the three can cross-validate and the itinerary can prefill from the official
// dates. Order: Dates first (they frame the trip window), then the always-on leg builder, then
// the derived travel class.
//
// • Trip type is a preset + label on ONE leg set (Round-trip = Outbound + mirrored Return,
//   One-way = single Outbound, Multi-city = user-determined). A personal segment is allowed.
// • From/To read the shared ECS Location master (IATA airports) — the SAME reference the TMC
//   books against (each leg's code flows verbatim into the TMC payload). Shown as "CODE — Name".
// • Date validation: official end ≥ start; per-leg arrive ≥ depart; legs chronological; leg
//   departures within the travel window; personal extension non-overlapping & well-ordered.
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Card } from './ui';

export interface Opt { code: string; name: string }
export interface ClassOpt { id: string; name: string }
export interface LegIn { originCode: string; destCode: string; departDate: string; arriveDate: string; nights: number; durationHours: string; isPersonal: boolean }

type TripType = 'ROUND_TRIP' | 'ONE_WAY' | 'MULTI_CITY';
const TYPES: { value: TripType; label: string }[] = [
  { value: 'ROUND_TRIP', label: 'Round-trip' },
  { value: 'ONE_WAY', label: 'One-way' },
  { value: 'MULTI_CITY', label: 'Multi-city' },
];

const blank = (origin = 'SIN'): LegIn => ({ originCode: origin, destCode: '', departDate: '', arriveDate: '', nights: 0, durationHours: '', isPersonal: false });

function reshape(type: TripType, legs: LegIn[]): LegIn[] {
  if (type === 'ONE_WAY') return [legs[0] ?? blank()];
  if (type === 'ROUND_TRIP') {
    const out = legs[0] ?? blank();
    const ret = legs[1] ?? { ...blank(out.destCode || 'SIN'), destCode: out.originCode || 'SIN', departDate: out.arriveDate || '' };
    return [out, ret];
  }
  return legs.length ? legs : [blank()];
}

function legLabel(type: TripType, i: number): string {
  if (type === 'ROUND_TRIP') return i === 0 ? 'Outbound' : 'Return';
  if (type === 'ONE_WAY') return 'Outbound';
  return `Leg ${i + 1}`;
}

const toD = (s: string) => (s ? new Date(s + 'T00:00:00') : null);

export function TripPlanner({
  airports, initialTripType, initialLegs,
  initialStart, initialEnd, initialPersonalStart, initialPersonalEnd,
  travelClasses, prefillClass, entitledName, basis, initialJustification, continueHref, disabled,
}: {
  airports: Opt[];
  initialTripType: TripType;
  initialLegs: LegIn[];
  initialStart: string; initialEnd: string; initialPersonalStart: string; initialPersonalEnd: string;
  travelClasses: ClassOpt[];
  prefillClass: string; entitledName: string; basis: string; initialJustification: string;
  continueHref: string;
  disabled?: boolean;
}) {
  const [start, setStartRaw] = useState(initialStart);
  const [end, setEndRaw] = useState(initialEnd);
  const [pStart, setPStart] = useState(initialPersonalStart);
  const [pEnd, setPEnd] = useState(initialPersonalEnd);
  const [type, setType] = useState<TripType>(initialTripType);
  const [legs, setLegs] = useState<LegIn[]>(() => reshape(initialTripType, initialLegs));
  const multi = type === 'MULTI_CITY';

  const setLeg = (i: number, p: Partial<LegIn>) => setLegs((ls) => ls.map((l, j) => j === i ? { ...l, ...p } : l));
  const addLeg = () => setLegs((ls) => [...ls, blank(ls[ls.length - 1]?.destCode || 'SIN')]);
  const delLeg = (i: number) => setLegs((ls) => ls.filter((_, j) => j !== i));
  const move = (i: number, dir: -1 | 1) => setLegs((ls) => { const j = i + dir; if (j < 0 || j >= ls.length) return ls; const c = [...ls]; [c[i], c[j]] = [c[j], c[i]]; return c; });
  const pick = (t: TripType) => { setType(t); setLegs((ls) => reshape(t, ls)); };

  // Prefill leg departures from the official dates — only when a leg's date is still empty, so
  // the traveller's own entries are never overwritten. Outbound ← official start; the final
  // round-trip leg ← official end.
  const setStart = (v: string) => {
    setStartRaw(v);
    if (v) setLegs((ls) => ls.map((l, i) => (i === 0 && !l.departDate) ? { ...l, departDate: v, arriveDate: l.arriveDate || v } : l));
  };
  const setEnd = (v: string) => {
    setEndRaw(v);
    if (v) setLegs((ls) => ls.map((l, i) => (type === 'ROUND_TRIP' && i === ls.length - 1 && i > 0 && !l.departDate) ? { ...l, departDate: v, arriveDate: l.arriveDate || v } : l));
  };

  // Live cross-field validation (mirrored server-side in saveTrip as the authority).
  const errors = useMemo(() => {
    const e: string[] = [];
    const os = toD(start), oe = toD(end), ps = toD(pStart), pe = toD(pEnd);
    if (os && oe && oe < os) e.push('Official end date must be on or after the official start date.');
    if (ps && pe && pe < ps) e.push('Personal extension end must be on or after its start.');
    if (os && oe && (ps || pe)) {
      const pS = ps ?? pe!, pE = pe ?? ps!;
      if (!(pE <= os || pS >= oe)) e.push('Personal extension must fall before the official start or after the official end — it cannot overlap the official travel dates.');
    }
    // Travel window the legs must sit inside (widened by a personal extension on either side).
    const winStart = ps && os && ps < os ? ps : os;
    const winEnd = pe && oe && pe > oe ? pe : oe;
    let prevDepart: Date | null = null;
    legs.forEach((l, i) => {
      const d = toD(l.departDate), a = toD(l.arriveDate);
      if (d && a && a < d) e.push(`Leg ${i + 1}: arrival cannot be before departure.`);
      if (d && winStart && winEnd && (d < winStart || d > winEnd)) e.push(`Leg ${i + 1}: departure is outside the travel window.`);
      if (d && prevDepart && d < prevDepart) e.push(`Leg ${i + 1}: departs before the previous leg.`);
      if (d) prevDepart = d;
    });
    return e;
  }, [start, end, pStart, pEnd, legs, type]);

  const blocking = errors.length > 0;

  return (
    <>
      <input type="hidden" name="tripType" value={type} />
      <input type="hidden" name="legsJson" value={JSON.stringify(legs.filter((l) => l.destCode))} />

      <Card title="Dates">
        <div className="grid md:grid-cols-4 gap-4">
          <div>
            <label className="label">Official start</label>
            <input type="date" name="startDate" value={start} onChange={(e) => setStart(e.target.value)} disabled={disabled} className="field" required />
          </div>
          <div>
            <label className="label">Official end</label>
            <input type="date" name="endDate" value={end} onChange={(e) => setEnd(e.target.value)} disabled={disabled} className="field" required />
          </div>
          <div>
            <label className="label">Personal extension start</label>
            <input type="date" name="personalStart" value={pStart} onChange={(e) => setPStart(e.target.value)} disabled={disabled} className="field" />
          </div>
          <div>
            <label className="label">Personal extension end</label>
            <input type="date" name="personalEnd" value={pEnd} onChange={(e) => setPEnd(e.target.value)} disabled={disabled} className="field" />
          </div>
        </div>
        <p className="text-xs text-[var(--ecs-muted)] mt-2">Personal days are excluded from ODA and personal nights from the accommodation budget (§4.5, AC18). Set the official dates first — the outbound and return legs below pre-fill from them.</p>
      </Card>

      <Card title="Destination & Itinerary">
        <div className="space-y-4">
          <div>
            <label className="label">Trip type</label>
            <div className="inline-flex rounded border border-[var(--ecs-border)] overflow-hidden">
              {TYPES.map((t) => (
                <button key={t.value} type="button" disabled={disabled} onClick={() => pick(t.value)}
                  className={`px-4 py-2 text-sm ${type === t.value ? 'bg-[var(--ecs-navy)] text-white font-semibold' : 'bg-white text-[var(--ecs-navy)]'} ${t.value !== 'ROUND_TRIP' ? 'border-l border-[var(--ecs-border)]' : ''}`}>
                  {t.label}
                </button>
              ))}
            </div>
            <p className="text-xs text-[var(--ecs-muted)] mt-1">
              {type === 'ROUND_TRIP' ? 'There and back to one destination — two legs (a personal segment is allowed).' : type === 'ONE_WAY' ? 'A single outbound journey, no return — one leg.' : 'Several stops — multiple cities and/or countries, including open-jaw. Add as many legs as needed.'}
            </p>
          </div>

          <div>
            <div className="text-sm font-semibold text-[var(--ecs-navy)] mb-2">Itinerary legs</div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr>
                  <th className="th">Leg</th><th className="th">From</th><th className="th">To</th><th className="th">Depart</th><th className="th">Arrive</th><th className="th">Nights</th><th className="th">Personal</th>{multi && <th className="th"></th>}
                </tr></thead>
                <tbody>
                  {legs.map((l, i) => (
                    <tr key={i}>
                      <td className="td whitespace-nowrap font-medium">{legLabel(type, i)}</td>
                      <td className="td"><select className="field" disabled={disabled} value={l.originCode} onChange={(e) => setLeg(i, { originCode: e.target.value })}>{airports.map((a) => <option key={a.code} value={a.code}>{a.code} — {a.name}</option>)}</select></td>
                      <td className="td"><select className="field" disabled={disabled} value={l.destCode} onChange={(e) => setLeg(i, { destCode: e.target.value })}><option value="">—</option>{airports.map((a) => <option key={a.code} value={a.code}>{a.code} — {a.name}</option>)}</select></td>
                      <td className="td"><input type="date" className="field" disabled={disabled} value={l.departDate} onChange={(e) => setLeg(i, { departDate: e.target.value, arriveDate: l.arriveDate || e.target.value })} /></td>
                      <td className="td"><input type="date" className="field" disabled={disabled} value={l.arriveDate} onChange={(e) => setLeg(i, { arriveDate: e.target.value })} /></td>
                      <td className="td"><input type="number" min="0" className="field w-20" disabled={disabled} value={l.nights} onChange={(e) => setLeg(i, { nights: Number(e.target.value) || 0 })} /></td>
                      <td className="td text-center"><input type="checkbox" disabled={disabled} checked={l.isPersonal} onChange={(e) => setLeg(i, { isPersonal: e.target.checked })} /></td>
                      {multi && (
                        <td className="td whitespace-nowrap">
                          <button type="button" className="btn-ghost text-xs" disabled={disabled || i === 0} onClick={() => move(i, -1)}>↑</button>
                          <button type="button" className="btn-ghost text-xs" disabled={disabled || i === legs.length - 1} onClick={() => move(i, 1)}>↓</button>
                          <button type="button" className="btn-ghost text-xs" disabled={disabled || legs.length === 1} onClick={() => delLeg(i)}>✕</button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {multi && !disabled && <button type="button" className="btn-secondary mt-2" onClick={addLeg}>＋ Add leg</button>}
            <p className="text-xs text-[var(--ecs-muted)] mt-2">
              Airports are the shared ECS Location master (IATA) — the same reference the TMC books against; each leg&apos;s code is carried verbatim into the booking instruction. In production this master is synced from the TMC/GDS airport feed. The main destination (for ODA defaults and class entitlement) is the longest-stay city, derived from the legs on save.
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-4 border-t border-[var(--ecs-border)] pt-4">
            <div>
              <label className="label">Travel class</label>
              <select name="travelClassId" defaultValue={prefillClass} disabled={disabled} className="field">
                {travelClasses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <p className="text-xs text-[var(--ecs-muted)] mt-1">Entitled: <strong>{entitledName}</strong> · <span className="italic">{basis}</span> (§13.19)</p>
            </div>
            <div className="md:col-span-2">
              <label className="label">Justification for higher class (required if above entitlement — §13.19)</label>
              <textarea name="classJustification" defaultValue={initialJustification} rows={2} disabled={disabled} className="field" placeholder="e.g. medical accommodation, red-eye connection…" />
            </div>
          </div>

          {blocking && (
            <div className="card p-3 text-sm text-red-800 bg-red-50 border-red-200">
              <div className="font-semibold mb-1">Please review the dates:</div>
              <ul className="list-disc list-inside space-y-0.5">{errors.map((e, i) => <li key={i}>{e}</li>)}</ul>
            </div>
          )}

          <div className="flex justify-end gap-2">
            {disabled
              ? <Link href={continueHref} className="btn-primary">Continue →</Link>
              : <button type="submit" disabled={blocking} className="btn-primary">Save trip &amp; continue →</button>}
          </div>
        </div>
      </Card>
    </>
  );
}
