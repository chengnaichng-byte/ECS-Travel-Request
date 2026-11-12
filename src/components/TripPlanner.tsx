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
// • Date validation: Trip end ≥ start; per-leg arrive ≥ depart; legs chronological; leg departures
//   within the trip window; each declared personal period inside the trip window.
// • Dates: TRIP Start/End frame the whole footprint (first departure → final return). Event dates
//   (§10) show only for a conference purpose and are a reference, not a funding driver. Personal
//   extension is DECLARED by the traveller as one or more day ranges (before / during / after), the
//   single source of truth for the funded-vs-personal split.
import { useMemo, useState, useEffect } from 'react';
import Link from 'next/link';
import { Card } from './ui';
import { type PersonalPeriod } from '@/modules/pretrip/personal';

export interface Opt { code: string; name: string }
export interface ClassOpt { id: string; name: string }
export interface AirportMeta { city: string; country: string; cityCode: string; countryCode: string }
// §13.x a live request sharing a traveller with this one — intersected live against the itinerary
// (dates + derived main destination) to surface a duplicate / overlap warning as the trip is typed.
export interface TravellerConflict { requestNumber: string; status: string; destination: string; destCountry: string | null; destCity: string | null; startISO: string; endISO: string }
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

// Nights at a leg's destination are AUTO-COMPUTED from the dates — the stay lasts from arriving at
// this leg's destination until the next leg departs (the last leg home has no onward departure → 0).
// This is the same rule syncAutoEstimates uses to budget accommodation/ODA, so the itinerary's Nights
// column, the longest-stay main destination and the budget all agree instead of a hand-keyed value.
const DAY = 86400000;
function computeLegNights(ls: LegIn[], i: number): number {
  const cur = ls[i]; const next = ls[i + 1];
  const from = toD(cur.arriveDate) ?? toD(cur.departDate);
  const to = next ? (toD(next.departDate) ?? toD(next.arriveDate)) : null;
  if (!from || !to) return 0;
  return Math.max(Math.round((to.getTime() - from.getTime()) / DAY), 0);
}

export function TripPlanner({
  airports, airportMeta, initialTripType, initialLegs,
  initialStart, initialEnd, initialEventStart, initialEventEnd, initialPersonalPeriods,
  initialPurposeId, conferencePurposeIds,
  continueHref, disabled, conflicts, footer,
  action, header, perTravellerCard, saveFormId = 'trip-form',
  initialAirfareSgd = '', isGroup = false,
}: {
  airports: Opt[];
  airportMeta: Record<string, AirportMeta>;
  initialTripType: TripType;
  initialLegs: LegIn[];
  initialStart: string; initialEnd: string; initialEventStart: string; initialEventEnd: string;
  // §4.5 declared personal day ranges (the funded-vs-personal split source of truth)
  initialPersonalPeriods: PersonalPeriod[];
  // §10 the event/conference dates show only for a conference purpose; tracked live off the purpose select
  initialPurposeId: string; conferencePurposeIds: string[];
  continueHref: string;
  disabled?: boolean;
  // §4.5/§13.20 per-journey airfare estimate (SGD). Seeds the Airfare line(s) on the Estimates step.
  initialAirfareSgd?: string;
  isGroup?: boolean;
  // Live requests sharing a traveller — the Trip step runs the duplicate/overlap check against the
  // itinerary being entered and shows it in the validation panel (not only at the Submit gate).
  conflicts?: TravellerConflict[];
  // §13.x Rendered AFTER the itinerary card but BEFORE the Save actions — the Trip step passes the
  // Emergency / Non-term lane sections here so the Save buttons stay the last thing on the step.
  footer?: React.ReactNode;
  // §13.20 TripPlanner owns the Trip form (so the Save buttons can sit AFTER the per-traveller
  // itineraries card). `header` (the Trip Purpose card) and the date/leg fields live inside the
  // form; `perTravellerCard` renders OUTSIDE it (its traveller rows are their own forms — nesting
  // forms is invalid HTML), and the Save buttons submit the form by its id (`form={saveFormId}`),
  // so the `blocking` date-validation gate below still disables Continue.
  action: (fd: FormData) => void | Promise<void>;
  header: React.ReactNode;
  perTravellerCard?: React.ReactNode;
  saveFormId?: string;
}) {
  const [start, setStartRaw] = useState(initialStart);
  const [end, setEndRaw] = useState(initialEnd);
  const [eventStart, setEventStart] = useState(initialEventStart);
  const [eventEnd, setEventEnd] = useState(initialEventEnd);
  const [periods, setPeriods] = useState<PersonalPeriod[]>(initialPersonalPeriods);
  const [type, setType] = useState<TripType>(initialTripType);

  // §10 Event dates belong to a conference purpose only. Track the purpose select (which lives in the
  // header card, same form) so the Event fields show/hide live as the purpose changes.
  const confSet = useMemo(() => new Set(conferencePurposeIds), [conferencePurposeIds]);
  const [isConference, setIsConference] = useState(confSet.has(initialPurposeId));
  useEffect(() => {
    const form = document.getElementById(saveFormId) as HTMLFormElement | null;
    const sel = form?.elements.namedItem('purposeId') as HTMLSelectElement | null;
    if (!sel) return;
    const sync = () => setIsConference(confSet.has(sel.value));
    sync();
    sel.addEventListener('change', sync);
    return () => sel.removeEventListener('change', sync);
  }, [saveFormId, confSet]);

  // Personal-period row helpers.
  const addPeriod = () => setPeriods((ps) => [...ps, { start: start || '', end: end || '' }]);
  const setPeriod = (i: number, patch: Partial<PersonalPeriod>) => setPeriods((ps) => ps.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  const removePeriod = (i: number) => setPeriods((ps) => ps.filter((_, j) => j !== i));
  const [legs, setLegs] = useState<LegIn[]>(() => reshape(initialTripType, initialLegs));
  const multi = type === 'MULTI_CITY';

  // §13.14 main destination — the COUNTRY with the LONGEST stay (nights summed by destination country),
  // then the longest-stay city within it (same rule the server applies on save via mainDestination).
  // Shown read-only so the traveller sees what the review/approval pages will record.
  const mainDest = useMemo(() => {
    const idx = legs.map((l, i) => ({ l, i })).filter(({ l }) => l.destCode && airportMeta?.[l.destCode]);
    if (!idx.length) return null;
    const nonP = idx.filter(({ l }) => !l.isPersonal);
    const pool = nonP.length ? nonP : idx;
    type Agg = { nights: number; city: string; country: string; cityCode: string; countryCode: string; code: string };
    const byCountry = new Map<string, number>();
    const byCity = new Map<string, Agg>();
    for (const { l, i } of pool) {
      const m = airportMeta![l.destCode];
      const n = computeLegNights(legs, i);
      byCountry.set(m.countryCode, (byCountry.get(m.countryCode) ?? 0) + n);
      const cur = byCity.get(m.cityCode);
      byCity.set(m.cityCode, { nights: (cur?.nights ?? 0) + n, city: m.city, country: m.country, cityCode: m.cityCode, countryCode: m.countryCode, code: cur?.code ?? l.destCode });
    }
    const topCountry = [...byCountry.entries()].sort((a, b) => b[1] - a[1])[0];
    if (topCountry && topCountry[1] > 0) {
      const chosen = [...byCity.values()].filter((c) => c.countryCode === topCountry[0]).sort((a, b) => b.nights - a.nights)[0];
      if (chosen) return { code: chosen.code, city: chosen.city, country: chosen.country, cityCode: chosen.cityCode, countryCode: chosen.countryCode, nights: topCountry[1] };
    }
    // Fallback — longest-stay single leg (e.g. a same-day return with no nights captured).
    const main = [...pool].sort((a, b) => computeLegNights(legs, b.i) - computeLegNights(legs, a.i))[0];
    const m = airportMeta![main.l.destCode];
    return { code: main.l.destCode, city: m.city, country: m.country, cityCode: m.cityCode, countryCode: m.countryCode, nights: computeLegNights(legs, main.i) };
  }, [legs, airportMeta]);

  const setLeg = (i: number, p: Partial<LegIn>) => setLegs((ls) => {
    const oldDest = ls[i]?.destCode ?? '';
    let next = ls.map((l, j) => (j === i ? { ...l, ...p } : l));
    // §13.14 contiguous itinerary — from leg 2 onwards a leg's "Departure from" defaults to the
    // immediately prior leg's arrival airport. When this leg's destination changes, the NEXT leg's
    // origin follows it, but only while that origin is still the chained default (empty, equal to
    // this leg's PREVIOUS destination, or the untouched home default) — a deliberately diverged
    // (open-jaw) origin the traveller set is never overwritten.
    if (p.destCode !== undefined && p.destCode !== oldDest && i + 1 < next.length) {
      const nx = next[i + 1];
      if (!nx.originCode || nx.originCode === oldDest || (oldDest === '' && nx.originCode === 'SIN')) {
        next = next.map((l, j) => (j === i + 1 ? { ...l, originCode: p.destCode as string } : l));
      }
    }
    return next;
  });
  const addLeg = () => setLegs((ls) => [...ls, blank(ls[ls.length - 1]?.destCode || 'SIN')]);
  const delLeg = (i: number) => setLegs((ls) => ls.filter((_, j) => j !== i));
  const move = (i: number, dir: -1 | 1) => setLegs((ls) => { const j = i + dir; if (j < 0 || j >= ls.length) return ls; const c = [...ls]; [c[i], c[j]] = [c[j], c[i]]; return c; });
  const pick = (t: TripType) => { setType(t); setLegs((ls) => reshape(t, ls)); };

  // Keep the preset legs tracking the official dates — a leg follows an official-date change
  // when it was empty OR still equal to the PREVIOUS official date, so a mirrored Outbound/Return
  // moves with the change while a date the traveller set deliberately is never overwritten.
  // Outbound ← official start; the final round-trip leg ← official end.
  const setStart = (v: string) => {
    const prev = start;
    setStartRaw(v);
    if (v) setLegs((ls) => ls.map((l, i) => (i === 0 && (!l.departDate || l.departDate === prev))
      ? { ...l, departDate: v, arriveDate: (!l.arriveDate || l.arriveDate === prev) ? v : l.arriveDate } : l));
  };
  const setEnd = (v: string) => {
    const prev = end;
    setEndRaw(v);
    if (v) setLegs((ls) => ls.map((l, i) => (type === 'ROUND_TRIP' && i === ls.length - 1 && i > 0 && (!l.departDate || l.departDate === prev))
      ? { ...l, departDate: v, arriveDate: (!l.arriveDate || l.arriveDate === prev) ? v : l.arriveDate } : l));
  };

  // Live cross-field validation (mirrored server-side in saveTrip as the authority).
  const errors = useMemo(() => {
    const e: string[] = [];
    const ts = toD(start), te = toD(end), evs = toD(eventStart), eve = toD(eventEnd);
    if (ts && te && te < ts) e.push('Trip end date must be on or after the trip start date.');
    // §10 Event dates apply only to a conference purpose; when shown, they sit inside the trip window.
    if (isConference) {
      if (evs && eve && eve < evs) e.push('Event end date must be on or after the event start date.');
      if (ts && te && evs && (evs < ts || evs > te)) e.push('Event start date must fall within the trip dates.');
      if (ts && te && eve && (eve < ts || eve > te)) e.push('Event end date must fall within the trip dates.');
    }
    // §4.5 each declared personal period: well-ordered and inside the trip window (before, during or after).
    periods.forEach((p, i) => {
      const s = toD(p.start), en = toD(p.end);
      if (s && en && en < s) e.push(`Personal period ${i + 1}: end must be on or after its start.`);
      if (s && ts && te && (s < ts || s > te)) e.push(`Personal period ${i + 1}: start must fall within the trip dates.`);
      if (en && ts && te && (en < ts || en > te)) e.push(`Personal period ${i + 1}: end must fall within the trip dates.`);
    });
    // Legs sit inside the trip window (Trip Start → Trip End = the whole footprint).
    let prevDepart: Date | null = null;
    legs.forEach((l, i) => {
      const d = toD(l.departDate), a = toD(l.arriveDate);
      if (d && a && a < d) e.push(`Leg ${i + 1}: arrival cannot be before departure.`);
      if (d && ts && te && (d < ts || d > te)) e.push(`Leg ${i + 1}: departure is outside the trip window.`);
      if (d && prevDepart && d < prevDepart) e.push(`Leg ${i + 1}: departs before the previous leg.`);
      if (d) prevDepart = d;
    });
    return e;
  }, [start, end, eventStart, eventEnd, periods, legs, type, isConference]);

  const blocking = errors.length > 0;

  // §13.x Live duplicate / overlap check — run as the itinerary is entered, against the official
  // travel window (overlap) and the derived main destination (same-destination = true duplicate).
  // Mirrors findDuplicateRequests on the server; here it is a warning, not a save-block (the hard
  // block stays at the Submit gate). "Blocking" duplicates are same-destination date clashes.
  const dup = useMemo(() => {
    // Overlap window = the itinerary's actual travel footprint (first departure → last arrival from
    // the legs), not the official-business dates. Industry practice keys double-booking / duty-of-care
    // on where the traveller is physically present (the PNR dates); falls back to the official dates
    // only when the legs carry no dates yet. The server (travelWindow) uses the same rule.
    const legDates = legs.flatMap((l) => [toD(l.departDate), toD(l.arriveDate)]).filter((d): d is Date => !!d);
    const os = legDates.length ? new Date(Math.min(...legDates.map((d) => d.getTime()))) : toD(start);
    const oe = legDates.length ? new Date(Math.max(...legDates.map((d) => d.getTime()))) : toD(end);
    if (!conflicts?.length || !os || !oe) return { duplicate: [] as TravellerConflict[], clash: [] as TravellerConflict[] };
    const myCountry = mainDest?.countryCode ?? null;
    const myCity = mainDest?.cityCode ?? null;
    const duplicate: TravellerConflict[] = [];
    const clash: TravellerConflict[] = [];
    for (const c of conflicts) {
      const cs = toD(c.startISO), ce = toD(c.endISO);
      if (!cs || !ce) continue;
      if (!(os <= ce && cs <= oe)) continue; // official date ranges must intersect
      const sameCountry = !!myCountry && myCountry === c.destCountry;
      const sameCity = !myCity || !c.destCity || myCity === c.destCity;
      (sameCountry && sameCity ? duplicate : clash).push(c);
    }
    return { duplicate, clash };
  }, [conflicts, legs, start, end, mainDest]);

  return (
    <>
      <form id={saveFormId} action={action} className="space-y-5">
      {header}
      <input type="hidden" name="tripType" value={type} />
      <input type="hidden" name="legsJson" value={JSON.stringify(legs.map((l, i) => ({ ...l, nights: computeLegNights(legs, i) })).filter((l) => l.destCode))} />
      {/* §4.5 the declared personal periods travel with the form as JSON (parsed + validated server-side).
          For a GROUP, personal is declared PER MEMBER below, so no request-level value is submitted. */}
      {!isGroup && <input type="hidden" name="personalPeriodsJson" value={JSON.stringify(periods.filter((p) => p.start && p.end))} />}

      <Card title="Dates">
        <div className="grid md:grid-cols-4 gap-4">
          <div>
            <label className="label">Trip start</label>
            <input type="date" name="startDate" value={start} onChange={(e) => setStart(e.target.value)} disabled={disabled} className="field" required />
          </div>
          <div>
            <label className="label">Trip end</label>
            <input type="date" name="endDate" value={end} onChange={(e) => setEnd(e.target.value)} disabled={disabled} className="field" required />
          </div>
          {isConference && (
            <>
              <div>
                <label className="label">Event start (§10)</label>
                <input type="date" name="eventStartDate" value={eventStart} onChange={(e) => setEventStart(e.target.value)} disabled={disabled} className="field" />
              </div>
              <div>
                <label className="label">Event end</label>
                <input type="date" name="eventEndDate" value={eventEnd} onChange={(e) => setEventEnd(e.target.value)} disabled={disabled} className="field" />
              </div>
            </>
          )}
        </div>
        <p className="text-xs text-[var(--ecs-muted)] mt-2">
          <b>Trip start / end</b> frame the whole trip: the day you leave to the day you return (personal days included).
          {isConference ? ' The event dates (§10) are the conference days within the trip and are a reference for the booking, not a funding boundary.' : ' Event dates apply only to a Training / Conference purpose.'}
          {' '}The outbound and return legs below pre-fill from the trip dates.
        </p>

        {/* §4.5 Declared personal days — the traveller states which days are personal (before, during or
            after the business portion; one or many). Funded days / nights = the trip minus these. For a
            group each member declares their own below, so this request-level editor shows for individuals. */}
        {isGroup ? (
          <div className="mt-4 border-t border-[var(--ecs-border)] pt-3">
            <label className="label mb-0">Personal days (§4.5)</label>
            <p className="text-xs text-[var(--ecs-muted)] mt-1">Each travelling member declares their own personal days (before, during or after the business portion) in the <b>per-traveller personal days</b> section below.</p>
          </div>
        ) : (
        <div className="mt-4 border-t border-[var(--ecs-border)] pt-3">
          <div className="flex items-center justify-between">
            <label className="label mb-0">Personal days (§4.5)</label>
            {!disabled && <button type="button" onClick={addPeriod} className="text-sm font-medium text-[var(--ecs-navy)] hover:underline">+ Add personal days</button>}
          </div>
          <p className="text-xs text-[var(--ecs-muted)] mt-1">Declare any personal day ranges within the trip — immediately before, during, or immediately after the official business. These days are excluded from ODA and their nights from the accommodation budget; nothing is derived automatically.</p>
          {periods.length === 0 ? (
            <p className="text-sm text-[var(--ecs-muted)] mt-2 italic">No personal days — the whole trip is official business.</p>
          ) : (
            <div className="mt-2 space-y-2">
              {periods.map((p, i) => (
                <div key={i} className="grid md:grid-cols-[1fr_1fr_2fr_auto] gap-2 items-end">
                  <div>
                    <label className="text-[11px] text-[var(--ecs-muted)]">From</label>
                    <input type="date" value={p.start} min={start || undefined} max={end || undefined} onChange={(e) => setPeriod(i, { start: e.target.value })} disabled={disabled} className="field" />
                  </div>
                  <div>
                    <label className="text-[11px] text-[var(--ecs-muted)]">To</label>
                    <input type="date" value={p.end} min={p.start || start || undefined} max={end || undefined} onChange={(e) => setPeriod(i, { end: e.target.value })} disabled={disabled} className="field" />
                  </div>
                  <div>
                    <label className="text-[11px] text-[var(--ecs-muted)]">Note (optional)</label>
                    <input type="text" value={p.note ?? ''} onChange={(e) => setPeriod(i, { note: e.target.value })} disabled={disabled} className="field" placeholder="e.g. personal days before the conference" />
                  </div>
                  {!disabled && <button type="button" onClick={() => removePeriod(i)} aria-label="Remove" className="h-[38px] px-3 rounded border border-[var(--ecs-border)] text-[var(--ecs-muted)] hover:text-[var(--ecs-red)] hover:border-[var(--ecs-red)]">✕</button>}
                </div>
              ))}
            </div>
          )}
        </div>
        )}
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

          <div className="rounded border border-[var(--ecs-border)] bg-[var(--ecs-panel)] px-3 py-2 text-sm">
            <span className="text-xs font-semibold text-[var(--ecs-muted)] uppercase tracking-wide mr-2">Main destination</span>
            {mainDest
              ? <span className="txt-derived"><strong>{mainDest.city}, {mainDest.country}</strong> <span className="text-[var(--ecs-muted)]">· derived from the longest-stay country ({mainDest.country}{mainDest.nights ? `, ${mainDest.nights} night${mainDest.nights > 1 ? 's' : ''}` : ''})</span></span>
              : <span className="text-[var(--ecs-muted)] italic">Select a destination in the legs below.</span>}
          </div>

          <div>
            <div className="text-sm font-semibold text-[var(--ecs-navy)] mb-2">Itinerary legs</div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr>
                  <th className="th">Leg</th><th className="th">From</th><th className="th">To</th><th className="th">Depart</th><th className="th">Arrive</th><th className="th">Nights <span className="font-normal normal-case text-[var(--ecs-muted)]">(auto)</span></th><th className="th">Personal</th>{multi && <th className="th"></th>}
                </tr></thead>
                <tbody>
                  {legs.map((l, i) => (
                    <tr key={i}>
                      <td className="td whitespace-nowrap font-medium">{legLabel(type, i)}</td>
                      <td className="td"><select className="field" disabled={disabled} value={l.originCode} onChange={(e) => setLeg(i, { originCode: e.target.value })}>{airports.map((a) => <option key={a.code} value={a.code}>{a.code} — {a.name}</option>)}</select></td>
                      <td className="td"><select className="field" disabled={disabled} value={l.destCode} onChange={(e) => setLeg(i, { destCode: e.target.value })}><option value="">—</option>{airports.map((a) => <option key={a.code} value={a.code}>{a.code} — {a.name}</option>)}</select></td>
                      <td className="td"><input type="date" className="field" disabled={disabled} value={l.departDate} onChange={(e) => setLeg(i, { departDate: e.target.value, arriveDate: l.arriveDate || e.target.value })} /></td>
                      <td className="td"><input type="date" className="field" disabled={disabled} value={l.arriveDate} onChange={(e) => setLeg(i, { arriveDate: e.target.value })} /></td>
                      <td className="td"><span className="inline-flex items-center justify-center min-w-[3rem] text-sm text-[var(--ecs-muted)]" title="Auto-computed from the dates — the stay until the next leg departs">{computeLegNights(legs, i)}</span></td>
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
              Airports are the shared ECS Location master (IATA) — the same reference the TMC books against; each leg&apos;s code is carried verbatim into the booking instruction. In production this master is synced from the TMC/GDS airport feed. The main destination (for ODA defaults and class entitlement) is the longest-stay country — and the longest-stay city within it — derived from the legs on save.
            </p>
          </div>

          {/* §4.5/§13.20 Estimated airfare — seeds the Airfare line(s) on the Estimates step. */}
          <div>
            <label className="label">Estimated airfare{isGroup ? ' (SGD, per traveller)' : ' (SGD)'}</label>
            <div className="flex items-center gap-2">
              <span className="text-sm text-[var(--ecs-muted)]">SGD</span>
              <input type="number" min="0" step="1" name="airfareEstimateSgd" defaultValue={initialAirfareSgd} disabled={disabled} className="field w-48" placeholder="e.g. 1200" />
            </div>
            <p className="text-xs text-[var(--ecs-muted)] mt-1">
              Optional. Seeds an Airfare line on the Estimates step{isGroup ? ' for each traveller' : ''} at the entitled class — you can edit or remove it there. This amount stays the master: re-saving the trip re-applies it and flags any Estimates edit it replaced.{isGroup ? ' A traveller with their own itinerary sets their own fare in the Per-traveller itineraries section below.' : ''}
            </p>
          </div>

          {/* §13.19 Travel class is derived from the itinerary entitlement (shown in the cost
              items / review, and per traveller for groups) — it is not set on this form. */}

          {blocking && (
            <div className="card p-3 text-sm text-red-800 bg-red-50 border-red-200">
              <div className="font-semibold mb-1">Please review the dates:</div>
              <ul className="list-disc list-inside space-y-0.5">{errors.map((e, i) => <li key={i}>{e}</li>)}</ul>
            </div>
          )}

          {/* §13.x Duplicate / overlap check — run against the itinerary entered above. A same-
              destination overlap is a true duplicate (hard block at Submit); a different-destination
              overlap is a softer double-booking notice. Both are warnings here, not save-blocks. */}
          {dup.duplicate.length > 0 && (
            <div className="card p-3 text-sm text-red-800 bg-red-50 border-red-200">
              <b>Duplicate travel request.</b> An active request already covers this trip — this will block submission until you cancel or amend it:
              <ul className="list-disc pl-5 mt-1">
                {dup.duplicate.map((d) => (
                  <li key={d.requestNumber}><Link href={`/requests?find=${d.requestNumber}`} className="underline">{d.requestNumber}</Link> ({d.status}) — {d.destination}, {d.startISO} → {d.endISO}</li>
                ))}
              </ul>
            </div>
          )}
          {dup.clash.length > 0 && (
            <div className="card p-3 text-sm text-amber-900 bg-amber-50 border-amber-200">
              <b>Overlapping dates.</b> This traveller has another active request with overlapping dates (different destination) — check this is not a double-booking: {dup.clash.map((d) => `${d.requestNumber} (${d.destination}, ${d.startISO} → ${d.endISO})`).join('; ')}.
            </div>
          )}

        </div>
      </Card>
      {/* Emergency / Non-term lanes (passed from the Trip step) sit here — above the Save actions. */}
      {footer}
      </form>

      {/* §13.20 Per-traveller itineraries — OUTSIDE the form (its traveller rows are their own
          forms). The Save buttons follow it, submitting the Trip form by id. */}
      {perTravellerCard}

      <div className="flex justify-end gap-2 mt-5">
        {!disabled && <button type="submit" form={saveFormId} name="saveMode" value="draft" className="btn-secondary" title="Save what you have entered and return to the dashboard — finish it later">Save as draft</button>}
        {disabled
          ? <Link href={continueHref} className="btn-primary">Continue →</Link>
          : <button type="submit" form={saveFormId} disabled={blocking} className="btn-primary">Save trip &amp; continue →</button>}
      </div>
    </>
  );
}
