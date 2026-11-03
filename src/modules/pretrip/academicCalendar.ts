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
