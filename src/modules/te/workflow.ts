// §51 Configurable TE claim approval workflow. The claim route mirrors the ECS claim
// flow — Verifier → (Exception, if a NEW exception) → (RO, per the same configurable RO
// rule as the Travel Request) → DOA (always). The DOA step is AUTO-GRANTED from the
// approved Travel Request when the claim stays within the configured tolerance, adds no
// new policy exception and no new expense type, and keeps the same charging DOA. The
// configuration is the shared ECS Module Settings (reused, not a separate engine).
import { EcsIdentity, EcsRoles, EcsWorkflow, EcsCharging } from '@/shared/ecs/services';
import { APPROVER_ROLE, ROLE, REQUEST_STATUS, TE_TREATMENT } from '@/shared/enums';
import { highestChargingDept, isResearchRequest } from '@/modules/pretrip/route';
import { isReimbursable } from '@/modules/pretrip/settlement';
import type { FullRequest } from '@/modules/pretrip/queries';

export interface ClaimLike {
  claimantId: string;
  lessCorpCard: number;
  lessPersonal: number;
  chargingMainCode: string | null;
  lines: { expenseTypeId: string; actualSgd: number; sponsorSgd: number; receiptType: string; treatment?: string }[];
}

export interface ClaimWfOpts {
  exceptionApproverRequired: boolean;
  roRequirement: string;          // ALWAYS | INDIVIDUAL_ONLY | NEVER
  sameRouteResearch: boolean;
  teAutoGrantTolerancePct: number;
  teAutoGrantToleranceAbsSgd: number;
}

export interface ClaimStep { seq: number; roleType: string; approverId: string | null; autoGranted?: boolean; note?: string }

/** Total REIMBURSABLE claimed amount — excludes Reference lines (DD-19: central CTA/TMC-billed
 *  airfare and CTA hotel are shown for comparison but never reimbursed to the employee). A line
 *  with no treatment set defaults to reimbursable. */
export function claimTotal(claim: ClaimLike): number {
  const gross = claim.lines.filter((l) => l.treatment !== TE_TREATMENT.Reference).reduce((s, l) => s + l.actualSgd, 0);
  return Math.max(gross - claim.lessCorpCard - claim.lessPersonal, 0);
}

/** The approved REIMBURSABLE baseline the DD-08 tolerance compares against — employee-settled
 *  lines only, so it is like-for-like with the (reimbursable) claim total. Central lines (TMC
 *  airfare, CTA hotel) are excluded from BOTH sides. This is deliberately NOT req.approvalAmountSgd:
 *  that is the FULL committed spend (airfare + hotel + ODA) used for routing/bands and is unchanged. */
export function approvedAmount(req: FullRequest): number {
  return req.expenses.filter((e) => isReimbursable(req, e.category)).reduce((s, e) => s + (e.sgdAmount - e.sponsorSgd), 0);
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

/** §51 / DD-08 The DOA authority a cost object answers to = its department AND whether it is a
 *  research line (research routes to the research DOA / funding owner). Two charging accounts
 *  share a DOA only when both match. */
export interface ChargingDoaContext {
  dept: string;          // DOA-owning department (the claim's effective charging, falling back to the TR)
  research: boolean;     // routes to the research DOA line
  changed: boolean;      // the claim's charging DOA differs from the approved Travel Request's
  code: string | null;   // the claim's main charging code, when set
}

/** Resolve the claim's effective charging-DOA context and whether it moved off the approved
 *  request's DOA (a changed department OR a change to/from a research line). */
export function claimChargingContext(claim: ClaimLike, req: FullRequest, opts: Pick<ClaimWfOpts, 'sameRouteResearch'>): ChargingDoaContext {
  const trDept = highestChargingDept(req);
  const trResearch = isResearchRequest(req) && !opts.sameRouteResearch;
  const code = claim.chargingMainCode ? EcsCharging.code(claim.chargingMainCode) : null;
  const dept = code?.departmentId ?? trDept;
  const research = (code ? code.isResearch : isResearchRequest(req)) && !opts.sameRouteResearch;
  return { dept, research, changed: dept !== trDept || research !== trResearch, code: claim.chargingMainCode ?? null };
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
  // DD-08 A changed charging account routes to the NEW account's DOA — never auto-granted off
  // the Travel Request's DOA. Compared at DOA-authority granularity (department + research line).
  const charging = claimChargingContext(claim, req, opts);
  if (charging.changed) {
    const name = charging.code ? (EcsCharging.code(charging.code)?.name ?? charging.code) : 'the new account';
    return { auto: false, reason: `charging changed to ${name} — routes to that account's DOA` };
  }
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

  // DOA — always required; resolved from the claim's EFFECTIVE charging department + amount band.
  // DD-08: when the claimant changed the charging account, the DOA follows the NEW account (its
  // department + research line), not the Travel Request's. Auto-granted off the TR only when the
  // charging DOA is unchanged and the claim is within tolerance.
  const charging = claimChargingContext(claim, req, opts);
  const band = EcsWorkflow.bandForAmount(claimTotal(claim));
  const dept = EcsIdentity.department(charging.dept);
  const line = charging.research ? (dept?.researchDoaLine ?? dept?.doaLine ?? []) : (dept?.doaLine ?? []);
  const doaId = line[Math.min(band.doaTierIndex, line.length - 1)] ?? null;
  const ag = doaAutoGrant(claim, req, opts);
  const chargeNote = charging.changed
    ? `Charging changed to ${charging.code ? (EcsCharging.code(charging.code)?.name ?? charging.code) : charging.dept} — routed to ${dept?.name ?? charging.dept}${charging.research ? ' research' : ''} DOA · ${band.label}`
    : band.label;
  steps.push({
    seq: seq++,
    roleType: charging.research ? APPROVER_ROLE.ResearchDOA : APPROVER_ROLE.DOA,
    approverId: doaId,
    autoGranted: ag.auto,
    note: ag.auto ? `Auto-granted from ${req.authorisationNo} — ${ag.reason}` : chargeNote,
  });

  return steps;
}
