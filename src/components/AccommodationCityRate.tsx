'use client';
// §4.5 Accommodation city + quoted rate. The quoted nightly rate defaults to the selected
// city's hotel cap (and follows a city change), but remains editable so the traveller can
// enter an actual quote. Keeps the two fields together so the rate can track the city.
import { useState } from 'react';

export function AccommodationCityRate({ cities, caps, defaultCity, defaultRate, lockCity }: {
  cities: [string, string][]; caps: Record<string, number>; defaultCity: string; defaultRate?: string; lockCity?: boolean;
}) {
  const first = defaultCity || cities[0]?.[0] || '';
  const capStr = (c: string) => (caps[c] != null ? String(caps[c]) : '');
  const [city, setCity] = useState(first);
  // When editing an existing line, start from its saved rate; otherwise default to the city cap.
  const [rate, setRate] = useState(() => defaultRate ?? capStr(first));
  const onCity = (c: string) => { setCity(c); setRate(capStr(c)); };
  return (
    <>
      <div>
        <label className="label">City</label>
        {lockCity ? (
          // Auto per-stop hotel — the city comes from the itinerary, shown read-only.
          <div className="field bg-[var(--ecs-panel)] text-[var(--ecs-muted)]">{cities.find(([v]) => v === city)?.[1] ?? city}</div>
        ) : (
          <select name="city" value={city} onChange={(e) => onCity(e.target.value)} className="field">
            {cities.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        )}
      </div>
      <div>
        <label className="label">Quoted rate / night</label>
        <input name="quotedNightly" type="number" step="any" value={rate} onChange={(e) => setRate(e.target.value)} className="field txt-default" />
      </div>
    </>
  );
}
