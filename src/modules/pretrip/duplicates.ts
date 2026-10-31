// §13.x Duplicate / overlapping travel-request detection. Prevents two LIVE authorisations
// for the same trip (the "two live TAs" risk from a re-raise after a failed booking). A person
// cannot be on two trips at once, so the backstop is: same traveller + overlapping official
// dates. A same-destination match on top of that marks it a true duplicate (a re-raise) vs a
// mere scheduling clash. The block asks the traveller to cancel/amend the original first.
import { prisma } from '@/shared/db';
import { EcsReference } from '@/shared/ecs/services';
import { REQUEST_STATUS } from '@/shared/enums';
import { isNonEmployeeMember } from './traveller';
import type { FullRequest } from './queries';

// A request is "live" (holds or is seeking an authorisation) in these states. Terminal states
// (Cancelled / Withdrawn / Closed / Rejected) and plain Drafts are not live conflicts.
const LIVE_STATUSES: string[] = [
  REQUEST_STATUS.Submitted, REQUEST_STATUS.PendingRO, REQUEST_STATUS.PendingAdditional,
  REQUEST_STATUS.PendingException, REQUEST_STATUS.PendingDOA, REQUEST_STATUS.Approved,
  REQUEST_STATUS.AmendmentInProgress,
];

export interface DuplicateHit {
  requestNumber: string;
  status: string;
  destination: string;
  dates: string;
  sameDestination: boolean; // true = true duplicate; false = date clash, different destination
  sharedTravellers: string[];
}

/** Employee members that anchor a trip (non-employees excluded — a guest or student may
 *  legitimately appear on more than one host's trip, and is never the duplicate concern). */
function employeeTravellerIds(r: { isGroup: boolean; travellerId: string; travellers: { employeeId: string; travellerType?: string | null }[] }): string[] {
  if (!r.isGroup) return [r.travellerId];
  return r.travellers.filter((t) => !isNonEmployeeMember(t)).map((t) => t.employeeId);
}

/** The trip's actual travel footprint — first departure → last arrival, taken from the itinerary
 *  legs (the trip-level, non-traveller legs). This is the window used for clash detection: industry
 *  practice keys double-booking / duty-of-care on where the traveller is physically present (the
 *  PNR dates), not the administrative official-business dates. Falls back to the official dates when
 *  the legs carry no dates yet, and is null when neither is known. */
export function travelWindow(r: {
  startDate: Date | null; endDate: Date | null;
  legs: { travellerId: string | null; departDate: Date | null; arriveDate: Date | null }[];
}): { start: Date; end: Date } | null {
  const ds = r.legs
    .filter((l) => !l.travellerId)
    .flatMap((l) => [l.departDate, l.arriveDate])
    .filter((d): d is Date => !!d);
  if (ds.length) {
    const t = ds.map((d) => d.getTime());
    return { start: new Date(Math.min(...t)), end: new Date(Math.max(...t)) };
  }
  if (r.startDate && r.endDate) return { start: r.startDate, end: r.endDate };
  return null;
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Live requests (other than `req`) that share a traveller AND overlap `req`'s official dates.
 *  `sameDestination` flags the true-duplicate subset. Empty = no conflict. */
export async function findDuplicateRequests(req: FullRequest): Promise<DuplicateHit[]> {
  const myWin = travelWindow(req);
  if (!myWin) return [];
  const mine = new Set(employeeTravellerIds(req));
  if (mine.size === 0) return [];
  const candidates = await prisma.travelRequest.findMany({
    where: { id: { not: req.id }, status: { in: LIVE_STATUSES } },
    include: { travellers: true, legs: true },
  });
  const hits: DuplicateHit[] = [];
  for (const c of candidates) {
    // travel footprints (first departure → last arrival) intersect
    const cWin = travelWindow(c);
    if (!cWin) continue;
    if (!(myWin.start <= cWin.end && cWin.start <= myWin.end)) continue;
    const shared = employeeTravellerIds(c).filter((t) => mine.has(t));
    if (shared.length === 0) continue;
    // same destination = same country, and same city when both are set
    const sameCountry = !!req.destCountry && req.destCountry === c.destCountry;
    const sameCity = !req.destCity || !c.destCity || req.destCity === c.destCity;
    hits.push({
      requestNumber: c.requestNumber,
      status: c.status,
      destination: EcsReference.city(c.destCity ?? '')?.name ?? c.destCity ?? (EcsReference.country(c.destCountry ?? '')?.name ?? c.destCountry ?? '—'),
      dates: `${iso(cWin.start)} → ${iso(cWin.end)}`,
      sameDestination: sameCountry && sameCity,
      sharedTravellers: shared,
    });
  }
  // true duplicates first
  return hits.sort((a, b) => Number(b.sameDestination) - Number(a.sameDestination));
}

/** The hard-block subset: a true duplicate (same traveller, overlapping dates, same destination). */
export async function findBlockingDuplicates(req: FullRequest): Promise<DuplicateHit[]> {
  return (await findDuplicateRequests(req)).filter((h) => h.sameDestination);
}

/** A live request sharing a traveller with `req`, with its dates and destination codes — NOT
 *  date-filtered. Handed to the Trip step so the duplicate/overlap check can run live against the
 *  itinerary being entered (the client intersects dates and compares the derived main destination),
 *  rather than only against the last-saved dates. */
export interface TravellerConflict {
  requestNumber: string;
  status: string;
  destination: string;        // display name (city, else country)
  destCountry: string | null;
  destCity: string | null;
  startISO: string;           // yyyy-mm-dd
  endISO: string;
}

/** All live requests (other than `req`) that share a traveller with it, regardless of date overlap.
 *  The overlap and same-destination tests are left to the live client so the warning tracks the
 *  itinerary as it is typed. Empty when the request has no employee traveller. */
export async function findTravellerConflicts(req: FullRequest): Promise<TravellerConflict[]> {
  const mine = new Set(employeeTravellerIds(req));
  if (mine.size === 0) return [];
  const candidates = await prisma.travelRequest.findMany({
    where: { id: { not: req.id }, status: { in: LIVE_STATUSES } },
    include: { travellers: true, legs: true },
  });
  const out: TravellerConflict[] = [];
  for (const c of candidates) {
    // Each candidate's window is its own travel footprint (first departure → last arrival), so the
    // live client compares footprint-against-footprint — the same basis on both sides.
    const cWin = travelWindow(c);
    if (!cWin) continue;
    if (employeeTravellerIds(c).filter((t) => mine.has(t)).length === 0) continue;
    out.push({
      requestNumber: c.requestNumber,
      status: c.status,
      destination: EcsReference.city(c.destCity ?? '')?.name ?? c.destCity ?? (EcsReference.country(c.destCountry ?? '')?.name ?? c.destCountry ?? '—'),
      destCountry: c.destCountry,
      destCity: c.destCity,
      startISO: iso(cWin.start),
      endISO: iso(cWin.end),
    });
  }
  return out;
}
