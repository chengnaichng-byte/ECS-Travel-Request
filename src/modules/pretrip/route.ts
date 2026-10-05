// §6.2 approval-route builder + §13.5 self-approval prevention + §13.14 group
// routing. Extends the existing ECS workflow engine conceptually: the evaluator
// takes module, workflow type, amount basis and request context (§2.3) and emits an
// ordered list of approval steps. Nothing here is hard-coded per user — it reads the
// reference workflow bands and org DOA lines.
import { EcsIdentity, EcsCharging, EcsWorkflow, EcsRoles } from '@/shared/ecs/services';
import { APPROVER_ROLE, ROLE } from '@/shared/enums';
import type { FullRequest } from './queries';

export interface RouteStep {
  seq: number;
  roleType: string;
  approverId: string | null;
  onBehalfOf?: string | null;
  note?: string;
}

/** §13.14 highest charging department = department bearing the largest share. */
export function highestChargingDept(req: FullRequest): string {
  const byDept: Record<string, number> = {};
  for (const a of req.allocations) {
    const code = EcsCharging.code(a.chargingCode);
    if (!code) continue;
    byDept[code.departmentId] = (byDept[code.departmentId] ?? 0) + a.percent;
  }
  const sorted = Object.entries(byDept).sort((x, y) => y[1] - x[1]);
  if (sorted.length === 0) return EcsIdentity.employee(req.requestorId)?.departmentId ?? 'SCH-CS';
  // tie-break to the requestor's primary appointment department (§13.14)
  const top = sorted[0][1];
  const tied = sorted.filter(([, v]) => Math.abs(v - top) < 0.001).map(([d]) => d);
  if (tied.length > 1) {
    const reqDept = EcsIdentity.employee(req.requestorId)?.departmentId;
    if (reqDept && tied.includes(reqDept)) return reqDept;
  }
  return sorted[0][0];
}

export function isResearchRequest(req: FullRequest): boolean {
  return req.allocations.some((a) => EcsCharging.code(a.chargingCode)?.isResearch) || req.isResearch;
}

/** Walk a DOA line and pick the tier, escalating past any holder who is a traveller. */
function pickDoa(line: string[], tierIndex: number, travellerIds: string[]): { id: string | null; note?: string } {
  let idx = Math.min(tierIndex, line.length - 1);
  while (idx < line.length && travellerIds.includes(line[idx])) idx++; // §13.5 self-approval prevention
  if (idx >= line.length) return { id: line[line.length - 1] ?? null, note: 'Escalated — no higher DOA tier available' };
  const note = idx !== Math.min(tierIndex, line.length - 1) ? 'Escalated to next-higher DOA (self-approval prevention)' : undefined;
  return { id: line[idx], note };
}

export function buildRoute(
  req: FullRequest,
  opts: { exceptionApproverRequired: boolean; sameRouteResearch: boolean; approvalAmount: number; hasException: boolean; crossBaThresholdSgd: number; roRequirement: string },
): RouteStep[] {
  const steps: RouteStep[] = [];
  const travellerIds = req.isGroup ? req.travellers.map((t) => t.employeeId) : [req.travellerId];
  const deptId = highestChargingDept(req);
  const dept = EcsIdentity.department(deptId);
  const research = isResearchRequest(req) && !opts.sameRouteResearch;

  let seq = 1;

  // Pre-trip route (§51 configurable): Traveller → (optional Additional Approver, chosen by
  // the traveller — any AD person) → (Exception Approver when configured) → DOA. No RO step.
  // The Additional Approver is only inserted if one was selected and is not the traveller
  // (self-approval guard, §48).
  if (req.additionalApproverId && !travellerIds.includes(req.additionalApproverId)) {
    steps.push({ seq: seq++, roleType: APPROVER_ROLE.AdditionalApprover, approverId: req.additionalApproverId, note: 'Additional approver added by requestor' });
  }

  // RO decision point (configurable — §51 workflow configuration): ALWAYS, INDIVIDUAL_ONLY
  // (present for individual requests, dropped for a group request), or NEVER. Resolved as
  // the traveller's Reporting Officer; skipped when the RO is a traveller on the request
  // (self-approval guard) or cannot be resolved.
  const roNeeded = opts.roRequirement === 'ALWAYS' || (opts.roRequirement === 'INDIVIDUAL_ONLY' && !req.isGroup);
  if (roNeeded) {
    const ro = EcsIdentity.reportingOfficer(req.travellerId);
    if (ro && !travellerIds.includes(ro.id)) {
      steps.push({ seq: seq++, roleType: APPROVER_ROLE.RO, approverId: ro.id, note: 'Reporting Officer' });
    }
  }

  // Funding Owner for cross-charge requiring owner approval (§6.2).
  const crossCharge = req.allocations.map((a) => EcsCharging.code(a.chargingCode)).find((c) => c?.crossCharge && c.fundingOwnerId);
  if (crossCharge?.fundingOwnerId && !travellerIds.includes(crossCharge.fundingOwnerId)) {
    steps.push({ seq: seq++, roleType: APPROVER_ROLE.FundingOwner, approverId: crossCharge.fundingOwnerId, note: 'Cross-charge funding owner concurrence' });
  }

  // §18 Cross-business-area concurrence (AC5). When charging spans more than one BA, the
  // primary-BA DOA still owns the request, but every other BA whose cost share exceeds the
  // configured threshold must concur (that BA department's tier-1 DOA / funding owner).
  const baShare: Record<string, number> = {};
  for (const a of req.allocations) {
    const ba = EcsCharging.code(a.chargingCode)?.businessArea;
    if (ba) baShare[ba] = (baShare[ba] ?? 0) + a.percent;
  }
  const basByShare = Object.entries(baShare).sort((x, y) => y[1] - x[1]);
  if (basByShare.length > 1) {
    for (const [ba, pct] of basByShare.slice(1)) {
      const baAmount = opts.approvalAmount * (pct / 100);
      if (baAmount <= opts.crossBaThresholdSgd) continue;
      const code = req.allocations.map((a) => EcsCharging.code(a.chargingCode)).find((c) => c?.businessArea === ba);
      const baDept = code?.departmentId ? EcsIdentity.department(code.departmentId) : undefined;
      const approver = code?.fundingOwnerId ?? baDept?.doaLine?.[0] ?? null;
      // Skip when this approver is a traveller or already on the route (e.g. a cross-charge owner).
      if (approver && !travellerIds.includes(approver) && !steps.some((s) => s.approverId === approver)) {
        steps.push({ seq: seq++, roleType: APPROVER_ROLE.FundingOwner, approverId: approver, note: `Cross-BA concurrence — ${ba} share SGD ${baAmount.toFixed(0)} over SGD ${opts.crossBaThresholdSgd} threshold` });
      }
    }
  }

  // Exception approver inserted before DOA when a policy exception exists AND the
  // exception-routing setting is on; otherwise the exception is surfaced to the DOA (§26).
  if (opts.hasException && opts.exceptionApproverRequired) {
    const exc = EcsRoles.employeesWithRole(ROLE.ExceptionApprover)[0];
    if (exc) steps.push({ seq: seq++, roleType: APPROVER_ROLE.Exception, approverId: exc.id, note: 'Policy exception review' });
  }

  // DOA step — tier from amount band, line depends on research route.
  const band = EcsWorkflow.bandForAmount(opts.approvalAmount);
  const line = research ? (dept?.researchDoaLine ?? dept?.doaLine ?? []) : (dept?.doaLine ?? []);
  const doa = pickDoa(line, band.doaTierIndex, travellerIds);
  steps.push({
    seq: seq++,
    roleType: research ? APPROVER_ROLE.ResearchDOA : APPROVER_ROLE.DOA,
    approverId: doa.id,
    note: [band.label, doa.note].filter(Boolean).join(' · '),
  });

  return steps;
}

/** First pending step in a route determines the request's Pending-* status. */
export function statusForStep(roleType: string): string {
  if (roleType === APPROVER_ROLE.RO) return 'Pending RO Approval';
  if (roleType === APPROVER_ROLE.AdditionalApprover) return 'Pending Additional Approval';
  if (roleType === APPROVER_ROLE.Exception) return 'Pending Exception Approval';
  return 'Pending DOA Approval';
}
