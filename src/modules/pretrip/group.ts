// §13.14 group-travel helpers. A group request carries multiple travellers; every
// estimate line is either attributed to a single traveller (airfare & ODA are always
// individual) or a shared line. Shared ACCOMMODATION is date-aware — each traveller's
// room cost = nightly rate × their own nights at that city (from their effective
// sub-itinerary, §13.20); other shared lines split equally. A traveller's share =
// individual lines + date-aware accommodation + equal split of other shared lines.
import { EcsIdentity, EcsReference } from '@/shared/ecs/services';
import { EXPENSE_CATEGORY } from '@/shared/enums';
import { isNonEmployeeMember, memberName, memberDeptName } from './traveller';
import type { FullRequest } from './queries';

/** §8/§13.14 Members who may carry a share of a SHARED line. Non-employees (guests AND students)
 *  are excluded: they have no TE claim and the non-employee settlement path (TMC direct-billing)
 *  covers only booked travel, so their slice of a shared incidental would be unsettleable — it
 *  must never exist. */
export function sharingMembers(req: { travellers: { employeeId: string; travellerType?: string | null }[] }) {
  return req.travellers.filter((t) => !isNonEmployeeMember(t));
}
/** Set of member ids that are non-employees — guests or students (for stripping their keys out of a shareMap). */
export function guestMemberIds(req: { travellers: { employeeId: string; travellerType?: string | null }[] }): Set<string> {
  return new Set(req.travellers.filter((t) => isNonEmployeeMember(t)).map((t) => t.employeeId));
}

/** §8 Validation: a guest may carry no shared-incidental slice and no ODA. Returns a
 *  human-readable reason per offending line. Empty = valid. Data-level safety net for the
 *  exclusion logic (guests are stripped from shared splits, and ODA is blocked at authoring). */
export function guestAttributionViolations(req: FullRequest): string[] {
  const guests = guestMemberIds(req);
  if (guests.size === 0) return [];
  const guestName = (eid: string) => req.travellers.find((t) => t.employeeId === eid)?.guestName
    ?? EcsIdentity.employee(eid)?.name ?? eid;
  const out: string[] = [];
  for (const e of req.expenses) {
    const type = EcsReference.expenseType(e.expenseTypeId)?.name ?? e.category;
    // (a) a shared line whose shareMap names a guest
    if (e.isShared && e.shareMap) {
      let sm: Record<string, number> = {};
      try { sm = JSON.parse(e.shareMap); } catch { sm = {}; }
      const named = Object.keys(sm).filter((eid) => guests.has(eid));
      if (named.length) out.push(`Shared ${type} attributes cost to a guest (${named.map(guestName).join(', ')}). A guest cannot carry a share of a shared incidental (§8).`);
    }
    // (b) an ODA line attributed to a guest
    if (e.category === EXPENSE_CATEGORY.ODA && e.travellerId && guests.has(e.travellerId)) {
      out.push(`ODA is attributed to a guest (${guestName(e.travellerId)}). A guest receives no overseas daily allowance (§8).`);
    }
  }
  return out;
}

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
  // §8 shared incidentals split across EMPLOYEE members only — guests never carry a shared
  // slice (it would have no settlement path). Guests' total is their own attributed lines.
  const n = sharingMembers(req).length || 1;
  const otherSharedTotal = req.expenses
    .filter((e) => e.isShared && e.category !== EXPENSE_CATEGORY.Accommodation)
    .reduce((s, e) => s + net(e), 0);
  const otherSharedPer = otherSharedTotal / n;

  const rows = travellers.map((t) => {
    const nonEmployee = isNonEmployeeMember(t);
    const individualSgd = req.expenses
      .filter((e) => !e.isShared && e.travellerId === t.employeeId)
      .reduce((s, e) => s + net(e), 0);
    const accommodationSgd = travellerAccommodationSgd(req, t.employeeId);
    const sharedPer = nonEmployee ? 0 : otherSharedPer; // guests/students carry no shared slice (§8/§13.14)
    const totalSgd = individualSgd + accommodationSgd + sharedPer;
    return {
      employeeId: t.employeeId,
      name: memberName(t),
      department: memberDeptName(t),
      confirmed: t.confirmed,
      individualSgd,
      sharedSgd: accommodationSgd + sharedPer,
      totalSgd,
      pct: 0,
    };
  });
  const grand = rows.reduce((s, r) => s + r.totalSgd, 0) || 1;
  rows.forEach((r) => (r.pct = (r.totalSgd / grand) * 100));
  return rows;
}

/** §13.13 a group request cannot receive final approval until all travellers confirm. */
/* ------------------------------------------------------------- group itinerary */

/** The shared group itinerary (the baseline). §13.20 A group travels on one shared itinerary by
 *  default; a traveller may DEVIATE with their own legs (see effectiveLegs), in which case those
 *  override the shared ones for that traveller. Non-deviating travellers follow these shared legs. */
export function sharedLegs(req: FullRequest) {
  return req.legs.filter((l) => !l.travellerId).sort((a, b) => a.seq - b.seq);
}

/** A traveller's OWN legs (their per-traveller sub-itinerary), if any. §13.20 */
export function ownLegs(req: FullRequest, employeeId: string) {
  return req.legs.filter((l) => l.travellerId === employeeId).sort((a, b) => a.seq - b.seq);
}

/** Effective itinerary for a traveller — their OWN legs if they have any (a declared deviation),
 *  else the shared group itinerary. Every per-traveller cost/entitlement derivation flows through
 *  this, so one traveller flying a different route/dates is costed on their own itinerary. §13.20 */
export function effectiveLegs(req: FullRequest, employeeId?: string) {
  if (employeeId) { const own = ownLegs(req, employeeId); if (own.length) return own; }
  return sharedLegs(req);
}

/** True when the traveller's effective itinerary includes a personal-extension leg. */
export function hasPersonalExtension(req: FullRequest, employeeId?: string) {
  return effectiveLegs(req, employeeId).some((l) => l.isPersonal);
}

/** True when any traveller on this request carries a per-traveller sub-itinerary (a deviation). */
export function hasPerTravellerItineraries(req: FullRequest) {
  return req.legs.some((l) => !!l.travellerId);
}
