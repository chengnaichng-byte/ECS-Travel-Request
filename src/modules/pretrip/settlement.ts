// §8 Guest settlement. A guest (non-employee) has no login and files no TE claim, so their
// cost is NOT reconciled through the claim pipeline. Instead it is HOST-SETTLED: the TMC
// direct-bills the host (requestor) department cost object, and the actual is read from the
// guest's own booking in the group fan-out (CanonicalInbound). This module derives, per guest,
// the amount, cost object and source (direct-billed actual vs pending estimate).
import { EcsIdentity, EcsCharging } from '@/shared/ecs/services';
import { EXPENSE_CATEGORY } from '@/shared/enums';
import { isGuestMember, memberName, isGuestRequest, travellerName } from './traveller';
import { isTmcArrangement } from './booking';
import type { FullRequest } from './queries';

// ─────────────────────────────────────────────────────────────────────────────
// DD-19 Settlement channel — the SINGLE SOURCE OF TRUTH for "who fronts the money",
// and therefore whether a cost line is reimbursable to the employee or reference-only.
//
//   • CENTRAL  — paid centrally (CTA / TMC-billed). Shown in the claim for the full cost
//                picture and estimate-to-actual, but NOT reimbursable (the employee never
//                fronted it; reimbursing would double-pay).
//   • EMPLOYEE — the employee pays and claims it back. Reimbursable.
//
// Rules (settlement-driven, not category-driven):
//   AIRFARE        → CENTRAL when the trip is a TMC arrangement (CTA); EMPLOYEE when self-booked.
//   ACCOMMODATION  → CENTRAL when the requestor chose CTA (req.hotelSettlement); else EMPLOYEE.
//   ODA / OTHER /  → always EMPLOYEE.
//   CONFERENCE
//
// This helper is read by the TMC payload (billTo), the TE claim-line treatment, and the DD-08
// reimbursable-scope — so settlement is decided in exactly one place. It does NOT affect the
// approval amount, routing, or charging allocation (settlement ≠ authorisation ≠ cost ownership).
export type LineSettlement = 'CENTRAL' | 'EMPLOYEE';

export const HOTEL_SETTLEMENT = { Cta: 'CTA', Individual: 'INDIVIDUAL' } as const;

/** Whether CTA (central) hotel settlement is offerable — only when the trip routes via a TMC
 *  (you cannot central-bill a room the traveller self-arranges). */
export function hotelCtaAvailable(req: { bookingArrangement?: string | null }): boolean {
  return isTmcArrangement(req.bookingArrangement);
}

/** The settlement channel for a cost category on this request. */
export function lineSettlement(
  req: { bookingArrangement?: string | null; hotelSettlement?: string | null },
  category: string,
): LineSettlement {
  if (category === EXPENSE_CATEGORY.Airfare) return isTmcArrangement(req.bookingArrangement) ? 'CENTRAL' : 'EMPLOYEE';
  if (category === EXPENSE_CATEGORY.Accommodation) {
    return hotelCtaAvailable(req) && req.hotelSettlement === HOTEL_SETTLEMENT.Cta ? 'CENTRAL' : 'EMPLOYEE';
  }
  return 'EMPLOYEE';
}

/** Reimbursable to the employee iff the line is employee-settled. Central (CTA/TMC-billed)
 *  lines are reference-only. */
export function isReimbursable(
  req: { bookingArrangement?: string | null; hotelSettlement?: string | null },
  category: string,
): boolean {
  return lineSettlement(req, category) === 'EMPLOYEE';
}

const hotelOf = (segs: { type: string; amount?: number | null }[] | undefined) =>
  (segs ?? []).filter((s) => s.type === 'HOTEL').reduce((h, s) => h + (s.amount ?? 0), 0);

// Only TMC-booked categories are host direct-billable for a guest (airfare + accommodation).
// ODA / incidentals are not settled through this flow (no claim, not TMC-billed).
const DIRECT_BILLABLE: string[] = [EXPENSE_CATEGORY.Airfare, EXPENSE_CATEGORY.Accommodation];

export interface GuestSettlementRow {
  employeeId: string;
  name: string;
  org: string | null;
  costObject: string;         // host / guest charging code
  costObjectName: string;
  estimatedSgd: number;       // approved estimate (the guest's own attributed lines)
  billedSgd: number | null;   // TMC booking actual, null until booked
  source: 'TMC_DIRECT_BILL' | 'ESTIMATE';
  status: string;
}

/** The host (requestor) department cost object that bears guest cost by default. */
export function hostCostObject(req: FullRequest): string {
  return EcsIdentity.employee(req.requestorId)?.defaultChargingCode
    ?? EcsIdentity.employee(req.travellerId)?.defaultChargingCode ?? '';
}

export function guestSettlements(req: FullRequest): GuestSettlementRow[] {
  const host = hostCostObject(req);
  // §8 / DD-13 Standalone Guest request — one guest held at request level (no member rows).
  // Groups are employees-only, so this is now the primary guest-settlement case.
  if (isGuestRequest(req) && !req.isGroup) {
    const estimatedSgd = req.expenses
      .filter((e) => !e.isShared && DIRECT_BILLABLE.includes(e.category))
      .reduce((s, e) => s + Math.max(e.sgdAmount - e.sponsorSgd, 0), 0);
    // Actual aggregated across the guest's booking(s) — a trip may hold multiple PNRs (DD-17).
    const billedSgd = req.bookings.length
      ? Math.round(req.bookings.reduce((s, b) => s + (b.fare ?? 0) + (b.taxes ?? 0) + (b.fees ?? 0) + hotelOf(b.segments), 0) * 100) / 100
      : null;
    const costObject = req.expenses.find((e) => e.chargingCode)?.chargingCode || host;
    return [{
      employeeId: req.travellerId,
      name: travellerName(req),
      org: req.guestOrg ?? null,
      costObject,
      costObjectName: EcsCharging.code(costObject)?.name ?? costObject,
      estimatedSgd,
      billedSgd,
      source: billedSgd != null ? 'TMC_DIRECT_BILL' : 'ESTIMATE',
      status: billedSgd != null ? 'Direct-billed to host' : 'Pending TMC booking',
    }];
  }
  return req.travellers.filter(isGuestMember).map((t) => {
    // Approved estimate = the guest's own attributed (never shared) airfare + accommodation.
    const estimatedSgd = req.expenses
      .filter((e) => e.travellerId === t.employeeId && !e.isShared && DIRECT_BILLABLE.includes(e.category))
      .reduce((s, e) => s + Math.max(e.sgdAmount - e.sponsorSgd, 0), 0);
    // Actual from the guest's own booking in the fan-out (air fare+taxes+fees + hotel segments).
    const booking = req.bookings.find((b) => b.travellerId === t.employeeId);
    const hotel = booking?.segments?.filter((s) => s.type === 'HOTEL').reduce((s2, s) => s2 + (s.amount ?? 0), 0) ?? 0;
    const billedSgd = booking
      ? Math.round(((booking.fare ?? 0) + (booking.taxes ?? 0) + (booking.fees ?? 0) + hotel) * 100) / 100
      : null;
    // Cost object: an explicitly-charged guest line overrides the host default (§17 edit).
    const charged = req.expenses.find((e) => e.travellerId === t.employeeId && e.chargingCode)?.chargingCode;
    const costObject = charged || host;
    return {
      employeeId: t.employeeId,
      name: memberName(t),
      org: t.guestOrg ?? null,
      costObject,
      costObjectName: EcsCharging.code(costObject)?.name ?? costObject,
      estimatedSgd,
      billedSgd,
      source: billedSgd != null ? 'TMC_DIRECT_BILL' : 'ESTIMATE',
      status: billedSgd != null ? 'Direct-billed to host' : 'Pending TMC booking',
    };
  });
}

/** True when the request carries any guest cost to settle — a standalone Guest request, or
 *  (legacy, when mixing is enabled) a group with guest members. */
export function hasGuestMembers(req: FullRequest): boolean {
  return (isGuestRequest(req) && !req.isGroup) || req.travellers.some(isGuestMember);
}
