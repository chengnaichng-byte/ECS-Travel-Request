// §13.x Duplicate / overlapping travel-request detection. Prevents two LIVE authorisations
// for the same trip (the "two live TAs" risk from a re-raise after a failed booking). A person
// cannot be on two trips at once, so the backstop is: same traveller + overlapping official
// dates. A same-destination match on top of that marks it a true duplicate (a re-raise) vs a
// mere scheduling clash. The block asks the traveller to cancel/amend the original first.
import { prisma } from '@/shared/db';
import { EcsReference } from '@/shared/ecs/services';
import { REQUEST_STATUS } from '@/shared/enums';
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

/** Employee members that anchor a trip (guests excluded — a guest may legitimately appear on
 *  more than one host's trip, and is never the duplicate concern). */
function employeeTravellerIds(r: { isGroup: boolean; travellerId: string; travellers: { employeeId: string; travellerType?: string | null }[] }): string[] {
  if (!r.isGroup) return [r.travellerId];
  return r.travellers.filter((t) => !(t.travellerType === 'GUEST' || t.employeeId.startsWith('G-'))).map((t) => t.employeeId);
}

/** Live requests (other than `req`) that share a traveller AND overlap `req`'s official dates.
 *  `sameDestination` flags the true-duplicate subset. Empty = no conflict. */
export async function findDuplicateRequests(req: FullRequest): Promise<DuplicateHit[]> {
  if (!req.startDate || !req.endDate) return [];
  const mine = new Set(employeeTravellerIds(req));
  if (mine.size === 0) return [];
  const candidates = await prisma.travelRequest.findMany({
    where: { id: { not: req.id }, status: { in: LIVE_STATUSES }, startDate: { not: null }, endDate: { not: null } },
    include: { travellers: true },
  });
  const hits: DuplicateHit[] = [];
  for (const c of candidates) {
    if (!c.startDate || !c.endDate) continue;
    // official date ranges intersect
    if (!(req.startDate <= c.endDate && c.startDate <= req.endDate)) continue;
    const shared = employeeTravellerIds(c).filter((t) => mine.has(t));
    if (shared.length === 0) continue;
    // same destination = same country, and same city when both are set
    const sameCountry = !!req.destCountry && req.destCountry === c.destCountry;
    const sameCity = !req.destCity || !c.destCity || req.destCity === c.destCity;
    hits.push({
      requestNumber: c.requestNumber,
      status: c.status,
      destination: EcsReference.city(c.destCity ?? '')?.name ?? c.destCity ?? (EcsReference.country(c.destCountry ?? '')?.name ?? c.destCountry ?? '—'),
      dates: `${c.startDate.toISOString().slice(0, 10)} → ${c.endDate.toISOString().slice(0, 10)}`,
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
