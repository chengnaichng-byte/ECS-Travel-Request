// §13.14 group-travel helpers. A group request carries multiple travellers; every
// estimate line is either attributed to a single traveller (airfare & ODA are always
// individual) or a shared line. Shared ACCOMMODATION is date-aware — each traveller's
// room cost = nightly rate × their own nights at that city (from their effective
// sub-itinerary, §13.20); other shared lines split equally. A traveller's share =
// individual lines + date-aware accommodation + equal split of other shared lines.
import { EcsIdentity, EcsReference } from '@/shared/ecs/services';
import { EXPENSE_CATEGORY } from '@/shared/enums';
import { isGuestMember, memberName, memberDeptName } from './traveller';
import type { FullRequest } from './queries';

/** §8 Members who may carry a share of a SHARED line. Guests are excluded: a guest has no
 *  TE claim and the guest settlement path (TMC direct-billing) covers only booked travel,
 *  so a guest slice of a shared incidental would be unsettleable — it must never exist. */
export function sharingMembers(req: { travellers: { employeeId: string; travellerType?: string | null }[] }) {
  return req.travellers.filter((t) => !isGuestMember(t));
}
/** Set of member ids that are guests (for stripping guest keys out of a shareMap). */
export function guestMemberIds(req: { travellers: { employeeId: string; travellerType?: string | null }[] }): Set<string> {
  return new Set(req.travellers.filter((t) => isGuestMember(t)).map((t) => t.employeeId));
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
    const guest = isGuestMember(t);
    const individualSgd = req.expenses
      .filter((e) => !e.isShared && e.travellerId === t.employeeId)
      .reduce((s, e) => s + net(e), 0);
    const accommodationSgd = travellerAccommodationSgd(req, t.employeeId);
    const sharedPer = guest ? 0 : otherSharedPer; // guests carry no shared slice (§8)
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

/** The shared group itinerary. Group requests have ONE shared itinerary — there are no
 *  per-traveller sub-itineraries or deviations, so every traveller follows these legs. */
export function sharedLegs(req: FullRequest) {
  return req.legs.filter((l) => !l.travellerId).sort((a, b) => a.seq - b.seq);
}

/** Effective itinerary for a traveller — always the shared itinerary (no deviations). */
export function effectiveLegs(req: FullRequest, _employeeId?: string) {
  return sharedLegs(req);
}

/** True when the trip has a personal extension leg (shared across all travellers). */
export function hasPersonalExtension(req: FullRequest, _employeeId?: string) {
  return sharedLegs(req).some((l) => l.isPersonal);
}
