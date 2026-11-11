// §13.x University-wide teaching calendar — query + the non-term-time derivation. The non-term
// research flag is DERIVED (not attested): a trip is non-term time only when its whole travel window
// (personal included) contains no teaching or exam day, and only when the window is within the loaded
// calendar's coverage. A BREAK day overrides a teaching span (e.g. a recess week inside a semester),
// so overlapping admin-entered periods resolve correctly. Outside the loaded calendar → not covered,
// and the caller falls back to the manual attestation.
import { prisma } from '@/shared/db';

export interface NonTermResult {
  covered: boolean;   // the window lies within the loaded calendar's coverage
  nonTerm: boolean;   // covered AND no teaching/exam day in the window
  basis: string;      // human-readable reason
}

type Term = { name: string; type: string; startDate: Date; endDate: Date };

const DAY = 86400000;
const midUTC = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());

export async function listAcademicTerms() {
  return prisma.academicTerm.findMany({ orderBy: [{ academicYear: 'asc' }, { sortOrder: 'asc' }] });
}

/** Pick a travel window of `nights` nights that sits ENTIRELY inside a BREAK period, so a trip placed
 * there derives as non-term time. Prefers an upcoming break (one that has not already ended), chosen at
 * random among those long enough, and staggers the start within it for variety. Returns ISO date
 * strings (YYYY-MM-DD), or null when no loaded break can fit the window (caller keeps its own default,
 * which falls back to the manual attestation). Used by the non-term research demo seed so the launcher
 * stays self-consistent as the academic calendar changes, instead of hard-coding dates. */
export function pickNonTermWindow(terms: Term[], nights = 5): { start: string; end: string } | null {
  const now = new Date();
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  const breaks = terms
    .filter((t) => t.type === 'BREAK')
    .map((t) => ({ s: midUTC(t.startDate), e: midUTC(t.endDate) }))
    .filter((b) => (b.e - b.s) / DAY >= nights)           // long enough to hold start..start+nights
    .sort((a, b) => a.s - b.s);
  if (breaks.length === 0) return null;
  const upcoming = breaks.filter((b) => b.e >= today);     // break not already over
  const pool = upcoming.length ? upcoming : breaks;        // else fall back to any fitting break
  const br = pool[Math.floor(Math.random() * pool.length)];
  const earliest = Math.max(br.s, today);                  // do not start in the past
  const latestStart = br.e - nights * DAY;                 // last start that still fits the window
  const lo = Math.min(earliest, latestStart);              // guard when today is late in the break
  const slots = Math.max(0, Math.round((latestStart - lo) / DAY));
  const start = lo + Math.floor(Math.random() * (slots + 1)) * DAY;
  return { start: iso(start), end: iso(start + nights * DAY) };
}

/** Derive whether [start, end] (personal included) is non-term time against the teaching calendar. */
export function deriveNonTermTime(start: Date | null, end: Date | null, terms: Term[]): NonTermResult {
  if (!start || !end) return { covered: false, nonTerm: false, basis: 'No travel dates set.' };
  if (terms.length === 0) return { covered: false, nonTerm: false, basis: 'No academic calendar is configured.' };
  const s = midUTC(start), e = midUTC(end);
  const calStart = Math.min(...terms.map((t) => midUTC(t.startDate)));
  const calEnd = Math.max(...terms.map((t) => midUTC(t.endDate)));
  if (s < calStart || e > calEnd) return { covered: false, nonTerm: false, basis: 'Travel dates fall outside the loaded academic calendar.' };

  const teachingExam = terms.filter((t) => t.type === 'TEACHING' || t.type === 'EXAM').map((t) => ({ name: t.name, s: midUTC(t.startDate), e: midUTC(t.endDate) }));
  const breaks = terms.filter((t) => t.type === 'BREAK').map((t) => ({ s: midUTC(t.startDate), e: midUTC(t.endDate) }));
  const inBreak = (d: number) => breaks.some((b) => d >= b.s && d <= b.e);
  const hit = new Set<string>();
  let termDays = 0;
  for (let d = s; d <= e; d += DAY) {
    const te = teachingExam.find((p) => d >= p.s && d <= p.e);
    if (te && !inBreak(d)) { termDays++; hit.add(te.name); }
  }
  if (termDays === 0) {
    const br = terms.find((t) => t.type === 'BREAK' && midUTC(t.startDate) <= s && midUTC(t.endDate) >= s);
    return { covered: true, nonTerm: true, basis: `Travel window is entirely in non-teaching time${br ? ` — ${br.name}` : ''}.` };
  }
  return { covered: true, nonTerm: false, basis: `Travel window overlaps ${[...hit].join(', ')} (${termDays} teaching/exam day${termDays > 1 ? 's' : ''}).` };
}
