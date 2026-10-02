// §13.14 group-travel helpers. A group request carries multiple travellers; every
// estimate line is either attributed to a single traveller (airfare & ODA are always
// individual) or a shared line. Shared ACCOMMODATION is date-aware — each traveller's
// room cost = nightly rate × their own nights at that city (from their effective
// sub-itinerary, §13.20); other shared lines split equally. A traveller's share =
// individual lines + date-aware accommodation + equal split of other shared lines.
import { EcsIdentity, EcsReference } from '@/shared/ecs/services';
import { EXPENSE_CATEGORY } from '@/shared/enums';
import type { FullRequest } from './queries';

export interface TravellerShare {
  employeeId: string;
  name: string;
  department: string;
  confirmed: boolean;
  individualSgd: number;
  sharedSgd: number;
  totalSgd: number;
  pct: number;
}

const net = (e: { sgdAmount: number; sponsorSgd: number }) => e.sgdAmount - e.sponsorSgd;
const DAY = 86400000;

/** §13.20 chargeable nights a traveller spends at a city, derived from their effective
 *  sub-itinerary (own legs if any, else the shared group legs); personal legs excluded. */
export function travellerNightsAtCity(req: FullRequest, employeeId: string, cityCode: string): number {
  const legs = effectiveLegs(req, employeeId);
  let nights = 0;
  for (let i = 0; i < legs.length; i++) {
    const leg = legs[i];
    const next = legs[i + 1];
    const arrive = leg.arriveDate ?? leg.departDate;
    if (!next?.departDate || !arrive || leg.isPersonal) continue;
    const city = EcsReference.airport(leg.destCode)?.cityCode ?? leg.destCode;
    if (city !== cityCode) continue;
    nights += Math.max(Math.round((next.departDate.getTime() - arrive.getTime()) / DAY), 0);
  }
  return nights;
}

/** A traveller's date-aware accommodation cost across all shared accommodation lines. */
export function travellerAccommodationSgd(req: FullRequest, employeeId: string): number {
  return req.expenses
    .filter((e) => e.isShared && e.category === EXPENSE_CATEGORY.Accommodation && e.accommodation)
    .reduce((s, e) => s + e.accommodation!.budgetedNightly * travellerNightsAtCity(req, employeeId, e.accommodation!.city), 0);
}

export function computeTravellerShares(req: FullRequest): TravellerShare[] {
  const travellers = req.travellers;
  const n = travellers.length || 1;
  // Non-accommodation shared lines split equally; accommodation is date-aware below.
  const otherSharedTotal = req.expenses
    .filter((e) => e.isShared && e.category !== EXPENSE_CATEGORY.Accommodation)
    .reduce((s, e) => s + net(e), 0);
  const otherSharedPer = otherSharedTotal / n;

  const rows = travellers.map((t) => {
    const individualSgd = req.expenses
      .filter((e) => !e.isShared && e.travellerId === t.employeeId)
      .reduce((s, e) => s + net(e), 0);
    const accommodationSgd = travellerAccommodationSgd(req, t.employeeId);
    const totalSgd = individualSgd + accommodationSgd + otherSharedPer;
    return {
      employeeId: t.employeeId,
      name: EcsIdentity.employee(t.employeeId)?.name ?? t.employeeId,
      department: EcsIdentity.department(EcsIdentity.employee(t.employeeId)?.departmentId ?? '')?.name ?? '—',
      confirmed: t.confirmed,
      individualSgd,
      sharedSgd: accommodationSgd + otherSharedPer,
      totalSgd,
      pct: 0,
    };
  });
  const grand = rows.reduce((s, r) => s + r.totalSgd, 0) || 1;
  rows.forEach((r) => (r.pct = (r.totalSgd / grand) * 100));
  return rows;
}

/** §13.13 a group request cannot receive final approval until all travellers confirm. */
export function allTravellersConfirmed(req: FullRequest): boolean {
  return req.travellers.length > 0 && req.travellers.every((t) => t.confirmed);
}

export function unconfirmedCount(req: FullRequest): number {
  return req.travellers.filter((t) => !t.confirmed).length;
}

/* ---------------------------------------------- §13.20 per-traveller itineraries */

/** The shared group itinerary (legs with no traveller override). */
export function sharedLegs(req: FullRequest) {
  return req.legs.filter((l) => !l.travellerId).sort((a, b) => a.seq - b.seq);
}

/** A traveller's own sub-itinerary legs (may be empty). */
export function travellerLegs(req: FullRequest, employeeId: string) {
  return req.legs.filter((l) => l.travellerId === employeeId).sort((a, b) => a.seq - b.seq);
}

/** Effective itinerary for a traveller: their own legs if any, else the shared legs. */
export function effectiveLegs(req: FullRequest, employeeId: string) {
  const own = travellerLegs(req, employeeId);
  return own.length ? own : sharedLegs(req);
}

/** True when the traveller has deviated with their own sub-itinerary. */
export function hasOwnItinerary(req: FullRequest, employeeId: string) {
  return req.legs.some((l) => l.travellerId === employeeId);
}

/** §13.20 True only when the traveller has a genuine personal leg in their effective
 *  itinerary (a personal extension), not merely an own sub-itinerary. */
export function hasPersonalExtension(req: FullRequest, employeeId: string) {
  return effectiveLegs(req, employeeId).some((l) => l.isPersonal);
}
