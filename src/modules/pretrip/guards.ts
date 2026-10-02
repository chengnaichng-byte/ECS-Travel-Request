// §13.1 server-side lifecycle guards (AC24 "only valid transitions") + approver
// authorization (AC14/AC22). Server actions must not trust the UI to have gated them —
// every mutating action checks the request is in a valid source state and (for approver
// decisions) that the acting persona is actually entitled to act.
import { REQUEST_STATUS, STATUS_TRANSITIONS, ROLE } from '@/shared/enums';
import { EcsIdentity, EcsDelegation } from '@/shared/ecs/services';
import { employees } from '@/data/employees';

/** Is `to` a valid next status from `from` per the §13.1 model? */
export function canTransition(from: string, to: string): boolean {
  return (STATUS_TRANSITIONS[from] ?? []).includes(to);
}

/** Source statuses from which each lifecycle action may run. Aligned with §13.1 and the
 * request-detail UI gating; the Draft→Submitted→Pending* chain is collapsed (submit runs
 * directly from an editable state). */
export const ACTION_SOURCE: Record<string, string[]> = {
  submit:   [REQUEST_STATUS.Draft, REQUEST_STATUS.SentBack],
  approve:  [REQUEST_STATUS.PendingRO, REQUEST_STATUS.PendingAdditional, REQUEST_STATUS.PendingException, REQUEST_STATUS.PendingDOA, REQUEST_STATUS.AmendmentInProgress],
  reject:   [REQUEST_STATUS.PendingRO, REQUEST_STATUS.PendingAdditional, REQUEST_STATUS.PendingException, REQUEST_STATUS.PendingDOA, REQUEST_STATUS.AmendmentInProgress],
  sendBack: [REQUEST_STATUS.PendingRO, REQUEST_STATUS.PendingAdditional, REQUEST_STATUS.PendingException, REQUEST_STATUS.PendingDOA, REQUEST_STATUS.AmendmentInProgress],
  withdraw: [REQUEST_STATUS.Draft, REQUEST_STATUS.SentBack, REQUEST_STATUS.PendingRO, REQUEST_STATUS.PendingAdditional, REQUEST_STATUS.PendingException, REQUEST_STATUS.PendingDOA],
  reopen:   [REQUEST_STATUS.SentBack],
  cancel:   [REQUEST_STATUS.Approved, REQUEST_STATUS.AmendmentInProgress, REQUEST_STATUS.Expired],
};

/** True when `action` may run against a request currently in `status`. */
export function actionAllowed(action: string, status: string): boolean {
  return (ACTION_SOURCE[action] ?? []).includes(status);
}

/** Approver authorization (AC14/AC22): the acting persona must be the step's assigned
 * approver, or a Travel Administrator acting as an override. A step with no resolved
 * approver is NOT open to arbitrary personas (closes the null-approver self-approval hole). */
export function canActOnStep(approverId: string | null | undefined, persona: string): boolean {
  if (EcsIdentity.hasRole(persona, 'TRAVEL_ADMIN')) return true;
  return !!approverId && approverId === persona;
}

/** Travellers the persona may raise a request for (§13.13): themselves (if a traveller),
 * anyone who delegated to them, and — for a Travel Requestor/PA — travellers in their
 * department. Mirrors the create-page gating so the server does not trust the posted id. */
export function creatableTravellerIds(personaId: string): Set<string> {
  const persona = EcsIdentity.employee(personaId);
  const set = new Set<string>();
  if (persona?.isTraveller) set.add(persona.id);
  EcsDelegation.canCreateTravelRequestFor(personaId).forEach((id) => set.add(id));
  if (persona?.roles.includes(ROLE.TravelRequestor)) {
    employees.filter((e) => e.isTraveller && e.departmentId === persona.departmentId).forEach((e) => set.add(e.id));
  }
  if (set.size === 0) employees.filter((e) => e.isTraveller).forEach((e) => set.add(e.id));
  return set;
}

export function canCreateFor(personaId: string, travellerId: string): boolean {
  return creatableTravellerIds(personaId).has(travellerId);
}
