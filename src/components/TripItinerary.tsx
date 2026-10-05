'use client';
// §4.4/§13.20 Destination & Itinerary — a single section driven by the trip type
// (industry terms: Round-trip / One-way / Multi-city). Round-trip and One-way capture one
// destination (the system builds the itinerary on save); Multi-city reveals an inline leg
// builder whose legs are submitted as part of the same trip form (no separate save, nothing
// after the Save button). Multi-city covers multiple cities and/or countries (incl. open-jaw).
import { useState } from 'react';

export interface Opt { code: string; name: string }
export interface LegIn { originCode: string; destCode: string; departDate: string; arriveDate: string; nights: number; durationHours: string; isPersonal: boolean }

type TripType = 'ROUND_TRIP' | 'ONE_WAY' | 'MULTI_CITY';
const TYPES: { value: TripType; label: string }[] = [
  { value: 'ROUND_TRIP', label: 'Round-trip' },
  { value: 'ONE_WAY', label: 'One-way' },
  { value: 'MULTI_CITY', label: 'Multi-city' },
];

export function TripItinerary({ airports, countries, cities, initialTripType, initialOrigin, initialDestCountry, initialDestCity, initialDestAirport, initialLegs, disabled }: {
  airports: Opt[]; countries: Opt[]; cities: Opt[];
  initialTripType: TripType; initialOrigin: string; initialDestCountry: string; initialDestCity: string; initialDestAirport: string;
  initialLegs: LegIn[]; disabled?: boolean;
}) {
  const [type, setType] = useState<TripType>(initialTripType);
  const blank: LegIn = { originCode: 'SIN', destCode: '', departDate: '', arriveDate: '', nights: 0, durationHours: '', isPersonal: false };
  const [legs, setLegs] = useState<LegIn[]>(() => initialLegs.length ? initialLegs : [{ ...blank }]);
  const setLeg = (i: number, p: Partial<LegIn>) => setLegs((ls) => ls.map((l, j) => j === i ? { ...l, ...p } : l));
  const addLeg = () => setLegs((ls) => [...ls, { ...blank, originCode: ls[ls.length - 1]?.destCode || 'SIN' }]);
  const delLeg = (i: number) => setLegs((ls) => ls.filter((_, j) => j !== i));
  const move = (i: number, dir: -1 | 1) => setLegs((ls) => { const j = i + dir; if (j < 0 || j >= ls.length) return ls; const c = [...ls]; [c[i], c[j]] = [c[j], c[i]]; return c; });

  return (
    <div className="space-y-4">
      <input type="hidden" name="tripType" value={type} />
      {type === 'MULTI_CITY' && <input type="hidden" name="legsJson" value={JSON.stringify(legs.filter((l) => l.destCode))} />}

      <div>
        <label className="label">Trip type</label>
        <div className="inline-flex rounded border border-[var(--ecs-border)] overflow-hidden">
          {TYPES.map((t) => (
            <button key={t.value} type="button" disabled={disabled} onClick={() => setType(t.value)}
              className={`px-4 py-2 text-sm ${type === t.value ? 'bg-[var(--ecs-navy)] text-white font-semibold' : 'bg-white text-[var(--ecs-navy)]'} ${t.value !== 'ROUND_TRIP' ? 'border-l border-[var(--ecs-border)]' : ''}`}>
              {t.label}
            </button>
          ))}
        </div>
        <p className="text-xs text-[var(--ecs-muted)] mt-1">
          {type === 'ROUND_TRIP' ? 'There and back to one destination.' : type === 'ONE_WAY' ? 'A single outbound journey, no return.' : 'Several stops — multiple cities and/or countries (including open-jaw).'}
        </p>
      </div>

      {type !== 'MULTI_CITY' ? (
        <div className="grid md:grid-cols-4 gap-4">
          <div><label className="label">Origin airport</label>
            <select name="originCode" defaultValue={initialOrigin || 'SIN'} disabled={disabled} className="field">
              {airports.map((a) => <option key={a.code} value={a.code}>{a.code} — {a.name}</option>)}
            </select>
          </div>
          <div><label className="label">Destination country</label>
            <select name="destCountry" defaultValue={initialDestCountry} disabled={disabled} className="field" required>
              <option value="">Select…</option>{countries.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
            </select>
          </div>
          <div><label className="label">Destination city</label>
            <select name="destCity" defaultValue={initialDestCity} disabled={disabled} className="field" required>
              <option value="">Select…</option>{cities.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
            </select>
          </div>
          <div><label className="label">Destination airport</label>
            <select name="destAirport" defaultValue={initialDestAirport} disabled={disabled} className="field">
              <option value="">Select…</option>{airports.filter((a) => a.code !== 'SIN').map((a) => <option key={a.code} value={a.code}>{a.code} — {a.name}</option>)}
            </select>
          </div>
        </div>
      ) : (
        <div>
          <div className="text-sm font-semibold text-[var(--ecs-navy)] mb-2">Itinerary legs</div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr>
                <th className="th">#</th><th className="th">From</th><th className="th">To</th><th className="th">Depart</th><th className="th">Arrive</th><th className="th">Nights</th><th className="th">Personal</th><th className="th"></th>
              </tr></thead>
              <tbody>
                {legs.map((l, i) => (
                  <tr key={i}>
                    <td className="td">{i + 1}</td>
                    <td className="td"><select className="field" disabled={disabled} value={l.originCode} onChange={(e) => setLeg(i, { originCode: e.target.value })}>{airports.map((a) => <option key={a.code} value={a.code}>{a.code}</option>)}</select></td>
                    <td className="td"><select className="field" disabled={disabled} value={l.destCode} onChange={(e) => setLeg(i, { destCode: e.target.value })}><option value="">—</option>{airports.map((a) => <option key={a.code} value={a.code}>{a.code}</option>)}</select></td>
                    <td className="td"><input type="date" className="field" disabled={disabled} value={l.departDate} onChange={(e) => setLeg(i, { departDate: e.target.value, arriveDate: l.arriveDate || e.target.value })} /></td>
                    <td className="td"><input type="date" className="field" disabled={disabled} value={l.arriveDate} onChange={(e) => setLeg(i, { arriveDate: e.target.value })} /></td>
                    <td className="td"><input type="number" min="0" className="field w-20" disabled={disabled} value={l.nights} onChange={(e) => setLeg(i, { nights: Number(e.target.value) || 0 })} /></td>
                    <td className="td text-center"><input type="checkbox" disabled={disabled} checked={l.isPersonal} onChange={(e) => setLeg(i, { isPersonal: e.target.checked })} /></td>
                    <td className="td whitespace-nowrap">
                      <button type="button" className="btn-ghost text-xs" disabled={disabled || i === 0} onClick={() => move(i, -1)}>↑</button>
                      <button type="button" className="btn-ghost text-xs" disabled={disabled || i === legs.length - 1} onClick={() => move(i, 1)}>↓</button>
                      <button type="button" className="btn-ghost text-xs" disabled={disabled || legs.length === 1} onClick={() => delLeg(i)}>✕</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!disabled && <button type="button" className="btn-secondary mt-2" onClick={addLeg}>＋ Add leg</button>}
          <p className="text-xs text-[var(--ecs-muted)] mt-2">The main destination (for ODA defaults and class entitlement) is the longest-stay city, derived from the legs on save.</p>
        </div>
      )}
    </div>
  );
}
