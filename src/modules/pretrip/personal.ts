// §4.5/§13.18 Personal extension — the traveller DECLARES the personal day ranges (before, during or
// after the business portion; one or many). This is the single source of truth for the funded-vs-
// personal split: funded days/nights = the Trip window minus these declared periods. Stored as
// TravelRequest.personalPeriodsJson. These helpers parse the declaration and count personal days /
// nights that fall inside a given stay, so the ODA (per day) and accommodation (per night) estimates
// can exclude them without re-deriving "personal" from the business dates.

export interface PersonalPeriod {
  start: string;   // ISO YYYY-MM-DD (inclusive)
  end: string;     // ISO YYYY-MM-DD (inclusive)
  note?: string;
}

const DAY = 86400000;
const isISO = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
const utc = (iso: string) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));
const toISO = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Parse the stored JSON into clean, ordered periods (start ≤ end, sorted, bad rows dropped). */
export function parsePersonalPeriods(json: string | null | undefined): PersonalPeriod[] {
  if (!json) return [];
  let raw: unknown;
  try { raw = JSON.parse(json); } catch { return []; }
  if (!Array.isArray(raw)) return [];
  const out: PersonalPeriod[] = [];
  for (const r of raw) {
    const o = r as { start?: unknown; end?: unknown; note?: unknown };
    if (!isISO(o.start) || !isISO(o.end)) continue;
    const start = utc(o.start) <= utc(o.end) ? o.start : o.end;   // tolerate reversed input
    const end = utc(o.start) <= utc(o.end) ? o.end : o.start;
    out.push({ start, end, note: typeof o.note === 'string' && o.note.trim() ? o.note.trim() : undefined });
  }
  return out.sort((a, b) => utc(a.start) - utc(b.start));
}

/** Serialise for storage (normalised). */
export function serializePersonalPeriods(periods: PersonalPeriod[]): string | null {
  return periods.length ? JSON.stringify(periods.map((p) => ({ start: p.start, end: p.end, ...(p.note ? { note: p.note } : {}) }))) : null;
}

/** Overall min/max across all periods — kept on personalStart/personalEnd for compatible display. */
export function personalSpan(periods: PersonalPeriod[]): { start: Date; end: Date } | null {
  if (!periods.length) return null;
  const starts = periods.map((p) => utc(p.start));
  const ends = periods.map((p) => utc(p.end));
  return { start: new Date(Math.min(...starts)), end: new Date(Math.max(...ends)) };
}

/** Is this calendar day (a Date at any time, compared by UTC date) inside any personal period? */
export function isPersonalDay(day: Date, periods: PersonalPeriod[]): boolean {
  const d = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate());
  return periods.some((p) => d >= utc(p.start) && d <= utc(p.end));
}

/** Count personal DAYS within an inclusive stay [arrive, depart] — the basis the ODA day-count uses
 *  (computeOda totalDays = depart − arrive + 1). */
export function personalDaysInStay(arrive: Date | null, depart: Date | null, periods: PersonalPeriod[]): number {
  if (!arrive || !depart || !periods.length) return 0;
  let n = 0;
  for (let d = Date.UTC(arrive.getUTCFullYear(), arrive.getUTCMonth(), arrive.getUTCDate());
    d <= Date.UTC(depart.getUTCFullYear(), depart.getUTCMonth(), depart.getUTCDate()); d += DAY) {
    if (periods.some((p) => d >= utc(p.start) && d <= utc(p.end))) n++;
  }
  return n;
}

/** Count personal NIGHTS within a stay [checkIn, checkOut] — a night belongs to its check-in day, so
 *  the nights are the days checkIn … checkOut−1. The basis accommodation personalNights uses. */
export function personalNightsInStay(checkIn: Date | null, checkOut: Date | null, periods: PersonalPeriod[]): number {
  if (!checkIn || !checkOut || !periods.length) return 0;
  let n = 0;
  for (let d = Date.UTC(checkIn.getUTCFullYear(), checkIn.getUTCMonth(), checkIn.getUTCDate());
    d < Date.UTC(checkOut.getUTCFullYear(), checkOut.getUTCMonth(), checkOut.getUTCDate()); d += DAY) {
    if (periods.some((p) => d >= utc(p.start) && d <= utc(p.end))) n++;
  }
  return n;
}

/** Validation against the Trip window: each period must lie inside [tripStart, tripEnd]. Returns the
 *  human-readable problems (empty = ok). */
export function validatePersonalPeriods(periods: PersonalPeriod[], tripStart: Date | null, tripEnd: Date | null): string[] {
  const errs: string[] = [];
  if (!periods.length) return errs;
  if (!tripStart || !tripEnd) { errs.push('Set the trip start and end dates before declaring personal days.'); return errs; }
  const ts = Date.UTC(tripStart.getUTCFullYear(), tripStart.getUTCMonth(), tripStart.getUTCDate());
  const te = Date.UTC(tripEnd.getUTCFullYear(), tripEnd.getUTCMonth(), tripEnd.getUTCDate());
  for (const p of periods) {
    if (utc(p.start) < ts || utc(p.end) > te) {
      errs.push(`Personal days ${p.start} to ${p.end} must fall within the trip dates (${toISO(ts)} to ${toISO(te)}).`);
    }
  }
  return errs;
}
