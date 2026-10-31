// §13.x Non-term research travel — attestation + offline-approval e-mail evidence. Mirrors the
// emergency lane's email-approval pattern (see emergency.ts). When a research-funded (research WBS)
// trip takes place in non-term time, offline approval has already been obtained, so the pre-trip can
// be fast-tracked. The traveller attests this on the Submit step (TravelRequest.nonTermDeclared) and
// attaches the authorising e-mail under the docType below; the auto-approve routing is gated
// separately in the workflow configuration (off by default).
import { EcsCharging, EcsIdentity } from '@/shared/ecs/services';

export const NON_TERM_APPROVAL_DOC = 'Non-term Offline Approval Email';

/** True when the request carries the attached non-term offline-approval e-mail. */
export function hasNonTermApproval(req: { attachments: { docType: string }[] }): boolean {
  return req.attachments.some((a) => a.docType === NON_TERM_APPROVAL_DOC);
}

/** §13.x Whether the non-term lane is OFFERED on this request — governed by the research funding (the
 *  Is-Research flag follows the charging account). Once a charging account is set, the actual
 *  allocations govern, so changing the charging to a non-research account removes the option (and the
 *  declaration is cleared on the Charging step). Before charging is set, the traveller's Workday
 *  default account governs — researchers typically default their profile to a research WBS, so the
 *  lane is available from the Trip step. */
export function nonTermResearchEligible(req: { travellerId: string; allocations: { chargingCode: string }[] }): boolean {
  if (req.allocations.length > 0) return req.allocations.some((a) => !!EcsCharging.code(a.chargingCode)?.isResearch);
  const dc = EcsIdentity.employee(req.travellerId)?.defaultChargingCode;
  return dc ? !!EcsCharging.code(dc)?.isResearch : false;
}
