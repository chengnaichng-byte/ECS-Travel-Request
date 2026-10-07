// §8 Guest / non-employee travel (AC7). A request may be raised for a guest — a visiting
// speaker, external collaborator or interview candidate — who has NO ECS/HR profile; the
// guest's identity is captured on the request itself. These resolvers return the correct
// display identity whether the traveller is an employee or a guest, so every screen and
// the TMC payload stay correct without special-casing each call site.
import { EcsIdentity } from '@/shared/ecs/services';

export const GUEST_TRAVELLER_ID = 'GUEST';

/** The subset of request fields the resolvers need (works for both the full request and
 *  the lighter dashboard list row). */
export interface TravellerRef {
  travellerType?: string | null;
  travellerId: string;
  guestName?: string | null;
  guestEmail?: string | null;
  guestOrg?: string | null;
}

export function isGuestRequest(req: TravellerRef): boolean {
  return req.travellerType === 'GUEST' || req.travellerId === GUEST_TRAVELLER_ID;
}

export function travellerName(req: TravellerRef): string {
  if (isGuestRequest(req)) return req.guestName?.trim() || 'Guest traveller';
  return EcsIdentity.employee(req.travellerId)?.name ?? req.travellerId;
}

export function travellerTitle(req: TravellerRef): string {
  if (isGuestRequest(req)) return req.guestOrg?.trim() ? `Guest — ${req.guestOrg.trim()}` : 'Guest (non-employee)';
  return EcsIdentity.employee(req.travellerId)?.title ?? '';
}

/** Email is captured only for guests; employees are addressed through ECS/HR. */
export function travellerEmail(req: TravellerRef): string | null {
  if (isGuestRequest(req)) return req.guestEmail?.trim() || null;
  return null;
}

/* ------------------------------------------------- §8/§13.14 group members (mixed) */
// A group member is an employee OR a guest. For a guest member employeeId holds a synthetic
// "G-…" key (so expenses keyed by employeeId still work); identity comes from the guest fields.
export interface MemberRef {
  employeeId: string;
  travellerType?: string | null;
  guestName?: string | null;
  guestOrg?: string | null;
}
export function isGuestMember(t: MemberRef): boolean { return t.travellerType === 'GUEST' || t.employeeId.startsWith('G-'); }
export function memberName(t: MemberRef): string {
  if (isGuestMember(t)) return t.guestName?.trim() || 'Guest traveller';
  return EcsIdentity.employee(t.employeeId)?.name ?? t.employeeId;
}
export function memberDeptName(t: MemberRef): string {
  if (isGuestMember(t)) return t.guestOrg?.trim() ? `Guest · ${t.guestOrg.trim()}` : 'Guest (non-employee)';
  return EcsIdentity.department(EcsIdentity.employee(t.employeeId)?.departmentId ?? '')?.name ?? '';
}
