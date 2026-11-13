// §4.5 Claim-side editable funded basis. The approved TR gives the starting per-city ODA (days) and
// accommodation (nights) breakdown; at claim the traveller edits the ACTUAL stay dates, rate, and the
// ACTUAL personal period(s). Everything else is DERIVED so nothing can disagree:
//   stay days   = depart − arrive + 1          personal days   = personalDaysInStay(arrive, depart, periods)
//   stay nights = checkOut − checkIn           personal nights = personalNightsInStay(checkIn, checkOut, periods)
//   funded      = stay − personal
// Personal days and personal nights therefore come from ONE personal-period declaration (they legitimately
// differ by a night — a tail extension's last day has no onward night). The edited basis OVERRIDES the TR
// for the claim header personal-day count and the ODA / accommodation expense-line amounts; the TR values
// stay the approved reference.
import { personalDaysInStay, personalNightsInStay, type PersonalPeriod } from '@/modules/pretrip/personal';

export type OdaBasisRow = { city: string | null; country: string; arrive: string; depart: string; dailyRate: number };
export type AccomBasisRow = { city: string; checkIn: string; checkOut: string; nightlyRate: number };
// A personal extension is a date range only — its city is AUTO-MATCHED from the ODA / accommodation stay
// whose window the dates fall in (personalDaysInStay / personalNightsInStay attribute per stop by date
// overlap), so the two counts never disagree and the traveller never picks a location.
export type PeriodRow = { start: string; end: string };

const iso = (x: Date | string | null | undefined) => (x instanceof Date ? x.toISOString().slice(0, 10) : (x ?? '') || '');
const num = (x: unknown) => { const v = Number(x); return Number.isFinite(v) ? v : 0; };
const toDate = (s: string | null | undefined) => (s ? new Date(s + 'T00:00:00Z') : null);
const round2 = (x: number) => Math.round(x * 100) / 100;

// TR-derived shapes (from the claimant's estimates) → editable rows.
export type TrOda = { city: string | null; country: string; arrive: Date | null; depart: Date | null; eligibleDays: number; personalDays: number; dailyRate: number };
export type TrAccom = { city: string; checkIn: Date | null; checkOut: Date | null; nights: number; personalNights: number; budgetedNightly: number };

export const seedOdaBasis = (rows: TrOda[]): OdaBasisRow[] => rows.map((o) => ({
  city: o.city, country: o.country, arrive: iso(o.arrive), depart: iso(o.depart), dailyRate: o.dailyRate,
}));
// Accommodation dates can be absent on the TR estimate; default them to the trip window so nights derive.
export const seedAccomBasis = (rows: TrAccom[], tripStart?: Date | null, tripEnd?: Date | null): AccomBasisRow[] => rows.map((a) => ({
  city: a.city, checkIn: iso(a.checkIn) || iso(tripStart), checkOut: iso(a.checkOut) || iso(tripEnd), nightlyRate: a.budgetedNightly,
}));

const parse = <T,>(json: string | null): T[] | null => {
  if (!json) return null;
  try { const a = JSON.parse(json); return Array.isArray(a) ? a : null; } catch { return null; }
};

export const effectiveOdaBasis = (odaBasisJson: string | null, tr: TrOda[]): OdaBasisRow[] => parse<OdaBasisRow>(odaBasisJson) ?? seedOdaBasis(tr);
export const effectiveAccomBasis = (accomBasisJson: string | null, tr: TrAccom[], tripStart?: Date | null, tripEnd?: Date | null): AccomBasisRow[] => parse<AccomBasisRow>(accomBasisJson) ?? seedAccomBasis(tr, tripStart, tripEnd);
const isISO = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
// The claim's personal periods (if edited), else the TR's declared periods — preserving each period's
// optional location (parsePersonalPeriods drops it, so parse the raw JSON here).
export const effectivePeriods = (claimPeriodsJson: string | null, trPeriodsJson: string | null): PeriodRow[] => {
  const json = claimPeriodsJson ?? trPeriodsJson;
  if (!json) return [];
  try {
    const arr = JSON.parse(json);
    if (!Array.isArray(arr)) return [];
    return arr.filter((r) => isISO(r?.start) && isISO(r?.end)).map((r) => ({ start: r.start, end: r.end }));
  } catch { return []; }
};
// PersonalPeriod.start/end are ISO YYYY-MM-DD STRINGS (personal.ts slices them), so pass them through.
const asPeriods = (rows: PeriodRow[]): PersonalPeriod[] => rows.filter((r) => r.start && r.end).map((r) => ({ start: r.start, end: r.end }));

// Per-row derivations — personalDaysInStay / personalNightsInStay already attribute each period to the
// stop whose [arrive, depart] / [checkIn, checkOut] window the dates fall in, so the city is matched by
// DATE overlap (no stored location).
export const odaStayDays = (r: OdaBasisRow) => { const a = toDate(r.arrive), d = toDate(r.depart); return a && d ? Math.max(Math.round((d.getTime() - a.getTime()) / 86400000) + 1, 0) : 0; };
export const accomStayNights = (r: AccomBasisRow) => { const a = toDate(r.checkIn), d = toDate(r.checkOut); return a && d ? Math.max(Math.round((d.getTime() - a.getTime()) / 86400000), 0) : 0; };
export const odaPersonalDays = (r: OdaBasisRow, periods: PeriodRow[]) => personalDaysInStay(toDate(r.arrive), toDate(r.depart), asPeriods(periods));
export const accomPersonalNights = (r: AccomBasisRow, periods: PeriodRow[]) => personalNightsInStay(toDate(r.checkIn), toDate(r.checkOut), asPeriods(periods));
export const odaFundedDays = (r: OdaBasisRow, periods: PeriodRow[]) => Math.max(odaStayDays(r) - odaPersonalDays(r, periods), 0);
export const accomFundedNights = (r: AccomBasisRow, periods: PeriodRow[]) => Math.max(accomStayNights(r) - accomPersonalNights(r, periods), 0);

export const fundedOdaTotal = (rows: OdaBasisRow[], periods: PeriodRow[]) => round2(rows.reduce((s, r) => s + odaFundedDays(r, periods) * num(r.dailyRate), 0));
export const fundedAccomTotal = (rows: AccomBasisRow[], periods: PeriodRow[]) => round2(rows.reduce((s, r) => s + accomFundedNights(r, periods) * num(r.nightlyRate), 0));

// Claim header personal-day count — the ODA basis is per DAY (matching the pre-existing "N personal days").
export const personalDaysTotal = (rows: OdaBasisRow[], periods: PeriodRow[]) => rows.reduce((s, r) => s + odaPersonalDays(r, periods), 0);
export const personalNightsTotal = (rows: AccomBasisRow[], periods: PeriodRow[]) => rows.reduce((s, r) => s + accomPersonalNights(r, periods), 0);

// Read basis rows / periods back out of a submitted form.
const s = (fd: FormData, k: string) => { const v = fd.get(k); return typeof v === 'string' ? v : ''; };
export function readOdaBasisForm(fd: FormData): OdaBasisRow[] {
  return Array.from({ length: num(fd.get('odaCount')) }, (_, i) => ({
    city: s(fd, `oda_${i}_city`) || null, country: s(fd, `oda_${i}_country`),
    arrive: s(fd, `oda_${i}_arrive`), depart: s(fd, `oda_${i}_depart`), dailyRate: num(fd.get(`oda_${i}_dailyRate`)),
  }));
}
export function readAccomBasisForm(fd: FormData): AccomBasisRow[] {
  return Array.from({ length: num(fd.get('accomCount')) }, (_, i) => ({
    city: s(fd, `accom_${i}_city`), checkIn: s(fd, `accom_${i}_checkIn`), checkOut: s(fd, `accom_${i}_checkOut`), nightlyRate: num(fd.get(`accom_${i}_nightlyRate`)),
  }));
}
export function readPeriodsForm(fd: FormData): PeriodRow[] {
  return Array.from({ length: num(fd.get('periodCount')) }, (_, i) => ({ start: s(fd, `period_${i}_start`), end: s(fd, `period_${i}_end`) }))
    .filter((p) => p.start && p.end);
}
