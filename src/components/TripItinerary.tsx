'use client';
// §4.4/§13.20 Destination & Itinerary — ONE always-on itinerary. The leg builder is shown
// for every trip type; the trip-type selector (industry terms: Round-trip / One-way /
// Multi-city) is a convenience preset + label on the same legs, not a different input mode:
//   • Round-trip  → two legs (Outbound + Return); may carry a personal segment.
//   • One-way     → a single outbound leg.
//   • Multi-city  → user-determined legs (add / reorder / remove); multiple cities and/or
//                   countries, including open-jaw.
// The legs are submitted as part of the same trip form (nothing after the Save button) and the
// main destination (for ODA defaults + class entitlement) is derived from the longest-stay leg
// on save, uniformly for every trip type.
import { useState } from 'react';

export interface Opt { code: string; name: string }
export interface LegIn { originCode: string; destCode: string; departDate: string; arriveDate: string; nights: number; durationHours: string; isPersonal: boolean }

type TripType = 'ROUND_TRIP' | 'ONE_WAY' | 'MULTI_CITY';
const TYPES: { value: TripType; label: string }[] = [
  { value: 'ROUND_TRIP', label: 'Round-trip' },
  { value: 'ONE_WAY', label: 'One-way' },
  { value: 'MULTI_CITY', label: 'Multi-city' },
];

const blank = (origin = 'SIN'): LegIn => ({ originCode: origin, destCode: '', departDate: '', arriveDate: '', nights: 0, durationHours: '', isPersonal: false });

/** Reshape the current legs to the count a trip type implies, preserving what the user has
 *  already entered. Round-trip keeps/creates an Outbound + a mirrored Return; One-way keeps the
 *  first leg; Multi-city leaves the legs untouched. */
function reshape(type: TripType, legs: LegIn[]): LegIn[] {
  if (type === 'ONE_WAY') return [legs[0] ?? blank()];
  if (type === 'ROUND_TRIP') {
    const out = legs[0] ?? blank();
    const ret = legs[1] ?? { ...blank(out.destCode || 'SIN'), destCode: out.originCode || 'SIN', departDate: out.arriveDate || '' };
    return [out, ret];
  }
  return legs.length ? legs : [blank()];
}

/** Row label — Outbound/Return for a round-trip, Outbound for one-way, leg number otherwise. */
function legLabel(type: TripType, i: number): string {
  if (type === 'ROUND_TRIP') return i === 0 ? 'Outbound' : 'Return';
  if (type === 'ONE_WAY') return 'Outbound';
  return `Leg ${i + 1}`;
}

export function TripItinerary({ airports, initialTripType, initialLegs, disabled }: {
  airports: Opt[];
  initialTripType: TripType;
  initialLegs: LegIn[];
  disabled?: boolean;
}) {
  const [type, setType] = useState<TripType>(initialTripType);
  const [legs, setLegs] = useState<LegIn[]>(() => reshape(initialTripType, initialLegs));
  const multi = type === 'MULTI_CITY';

  const setLeg = (i: number, p: Partial<LegIn>) => setLegs((ls) => ls.map((l, j) => j === i ? { ...l, ...p } : l));
  const addLeg = () => setLegs((ls) => [...ls, blank(ls[ls.length - 1]?.destCode || 'SIN')]);
  const delLeg = (i: number) => setLegs((ls) => ls.filter((_, j) => j !== i));
  const move = (i: number, dir: -1 | 1) => setLegs((ls) => { const j = i + dir; if (j < 0 || j >= ls.length) return ls; const c = [...ls]; [c[i], c[j]] = [c[j], c[i]]; return c; });
  const pick = (t: TripType) => { setType(t); setLegs((ls) => reshape(t, ls)); };

  return (
    <div className="space-y-4">
      <input type="hidden" name="tripType" value={type} />
      <input type="hidden" name="legsJson" value={JSON.stringify(legs.filter((l) => l.destCode))} />

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
                  <td className="td"><select className="field" disabled={disabled} value={l.originCode} onChange={(e) => setLeg(i, { originCode: e.target.value })}>{airports.map((a) => <option key={a.code} value={a.code}>{a.code}</option>)}</select></td>
                  <td className="td"><select className="field" disabled={disabled} value={l.destCode} onChange={(e) => setLeg(i, { destCode: e.target.value })}><option value="">—</option>{airports.map((a) => <option key={a.code} value={a.code}>{a.code}</option>)}</select></td>
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
        <p className="text-xs text-[var(--ecs-muted)] mt-2">The main destination (for ODA defaults and class entitlement) is the longest-stay city, derived from the legs on save.</p>
      </div>
    </div>
  );
}
