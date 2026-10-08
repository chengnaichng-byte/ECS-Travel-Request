// §8 Guest settlement. A guest (non-employee) has no login and files no TE claim, so their
// cost is NOT reconciled through the claim pipeline. Instead it is HOST-SETTLED: the TMC
// direct-bills the host (requestor) department cost object, and the actual is read from the
// guest's own booking in the group fan-out (CanonicalInbound). This module derives, per guest,
// the amount, cost object and source (direct-billed actual vs pending estimate).
import { EcsIdentity, EcsCharging } from '@/shared/ecs/services';
import { EXPENSE_CATEGORY } from '@/shared/enums';
import { isGuestMember, memberName } from './traveller';
import type { FullRequest } from './queries';

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

export function hasGuestMembers(req: FullRequest): boolean {
  return req.travellers.some(isGuestMember);
}
