// §51 Configurable TE claim approval workflow. The claim route mirrors the ECS claim
// flow — Verifier → (Exception, if a NEW exception) → (RO, per the same configurable RO
// rule as the Travel Request) → DOA (always). The DOA step is AUTO-GRANTED from the
// approved Travel Request when the claim stays within the configured tolerance, adds no
// new policy exception and no new expense type, and keeps the same charging DOA. The
// configuration is the shared ECS Module Settings (reused, not a separate engine).
import { EcsIdentity, EcsRoles, EcsWorkflow, EcsCharging } from '@/shared/ecs/services';
import { APPROVER_ROLE, ROLE, REQUEST_STATUS } from '@/shared/enums';
import { highestChargingDept, isResearchRequest } from '@/modules/pretrip/route';
import type { FullRequest } from '@/modules/pretrip/queries';

export interface ClaimLike {
  claimantId: string;
  lessCorpCard: number;
  lessPersonal: number;
  chargingMainCode: string | null;
  lines: { expenseTypeId: string; actualSgd: number; sponsorSgd: number; receiptType: string }[];
}

export interface ClaimWfOpts {
  exceptionApproverRequired: boolean;
  roRequirement: string;          // ALWAYS | INDIVIDUAL_ONLY | NEVER
  sameRouteResearch: boolean;
  teAutoGrantTolerancePct: number;
  teAutoGrantToleranceAbsSgd: number;
}

export interface ClaimStep { seq: number; roleType: string; approverId: string | null; autoGranted?: boolean; note?: string }

/** Total reimbursable claimed amount. */
export function claimTotal(claim: ClaimLike): number {
  const gross = claim.lines.reduce((s, l) => s + l.actualSgd, 0);
  return Math.max(gross - claim.lessCorpCard - claim.lessPersonal, 0);
}

/** The approved amount the DOA signed off on the Travel Request. */
export function approvedAmount(req: FullRequest): number {
  return req.approvalAmountSgd ?? req.expenses.reduce((s, e) => s + (e.sgdAmount - e.sponsorSgd), 0);
}

/** A claim expense type the Travel Request did not estimate. */
export function claimHasNewExpenseType(claim: ClaimLike, req: FullRequest): boolean {
  const trTypes = new Set(req.expenses.map((e) => e.expenseTypeId));
  return claim.lines.some((l) => !trTypes.has(l.expenseTypeId));
}

/** A NEW policy exception introduced at the claim: over the approved amount beyond
 *  tolerance, or any line claimed without a receipt (§26). */
export function claimHasNewException(claim: ClaimLike, req: FullRequest, opts: ClaimWfOpts): boolean {
  const over = claimTotal(claim) - approvedAmount(req);
  const beyondTolerance = over > opts.teAutoGrantToleranceAbsSgd || (approvedAmount(req) > 0 && over > (approvedAmount(req) * opts.teAutoGrantTolerancePct) / 100);
  const missingReceipt = claim.lines.some((l) => l.receiptType === 'NO_RECEIPT' && l.actualSgd > 0);
  return beyondTolerance || missingReceipt;
}

/** §51 Whether the claim's DOA approval is auto-granted from the approved Travel Request. */
export function doaAutoGrant(claim: ClaimLike, req: FullRequest, opts: ClaimWfOpts): { auto: boolean; reason: string } {
  if (req.status !== REQUEST_STATUS.Approved && req.status !== REQUEST_STATUS.Closed) return { auto: false, reason: 'Travel Request is not approved' };
  if (!req.authorisationNo) return { auto: false, reason: 'no Travel Authorisation on the request' };
  const over = claimTotal(claim) - approvedAmount(req);
  const withinTol = over <= opts.teAutoGrantToleranceAbsSgd && (approvedAmount(req) <= 0 || over <= (approvedAmount(req) * opts.teAutoGrantTolerancePct) / 100);
  if (!withinTol) return { auto: false, reason: `claim exceeds the approved amount beyond the ${opts.teAutoGrantTolerancePct}% / SGD ${opts.teAutoGrantToleranceAbsSgd} tolerance` };
  if (claimHasNewExpenseType(claim, req)) return { auto: false, reason: 'claim adds an expense type not on the approved request' };
  if (claimHasNewException(claim, req, opts)) return { auto: false, reason: 'claim introduces a new policy exception' };
  // Same charging DOA as the approved request (claim's main charging account → its department).
  const trDept = highestChargingDept(req);
  const claimDept = claim.chargingMainCode ? (EcsCharging.code(claim.chargingMainCode)?.departmentId ?? trDept) : trDept;
  if (claimDept !== trDept) return { auto: false, reason: 'claim changes the charging department / DOA' };
  return { auto: true, reason: `within the approved estimate (${req.authorisationNo})` };
}

/** §51 Build the configurable TE claim approval route. */
export function buildClaimRoute(claim: ClaimLike, req: FullRequest, opts: ClaimWfOpts): ClaimStep[] {
  const steps: ClaimStep[] = [];
  let seq = 1;

  // Verifier — always, first.
  const verifier = EcsRoles.employeesWithRole(ROLE.TravelAdmin)[0];
  steps.push({ seq: seq++, roleType: APPROVER_ROLE.Verifier, approverId: verifier?.id ?? null, note: 'Claim verification' });

  // Exception — only when the claim introduces a new exception AND the step is configured on.
  if (opts.exceptionApproverRequired && claimHasNewException(claim, req, opts)) {
    const exc = EcsRoles.employeesWithRole(ROLE.ExceptionApprover)[0];
    steps.push({ seq: seq++, roleType: APPROVER_ROLE.Exception, approverId: exc?.id ?? null, note: 'New policy exception on the claim' });
  }

  // RO — same configurable rule as the Travel Request (claimant's Reporting Officer).
  const roNeeded = opts.roRequirement === 'ALWAYS' || (opts.roRequirement === 'INDIVIDUAL_ONLY' && !req.isGroup);
  if (roNeeded) {
    const ro = EcsIdentity.reportingOfficer(claim.claimantId);
    if (ro && ro.id !== claim.claimantId) steps.push({ seq: seq++, roleType: APPROVER_ROLE.RO, approverId: ro.id, note: 'Reporting Officer' });
  }

  // DOA — always required; resolved from the highest-charging department + amount band.
  // Auto-granted from the approved Travel Request when the claim is within tolerance.
  const band = EcsWorkflow.bandForAmount(claimTotal(claim));
  const dept = EcsIdentity.department(highestChargingDept(req));
  const research = isResearchRequest(req) && !opts.sameRouteResearch;
  const line = research ? (dept?.researchDoaLine ?? dept?.doaLine ?? []) : (dept?.doaLine ?? []);
  const doaId = line[Math.min(band.doaTierIndex, line.length - 1)] ?? null;
  const ag = doaAutoGrant(claim, req, opts);
  steps.push({
    seq: seq++,
    roleType: research ? APPROVER_ROLE.ResearchDOA : APPROVER_ROLE.DOA,
    approverId: doaId,
    autoGranted: ag.auto,
    note: ag.auto ? `Auto-granted from ${req.authorisationNo} — ${ag.reason}` : band.label,
  });

  return steps;
}
