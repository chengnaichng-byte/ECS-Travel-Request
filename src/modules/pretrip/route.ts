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

/** §13.5 self-approval set — the people who must NOT appear as an approver on this request: every
 *  traveller on it AND the requestor who raised it. A dual-role persona (e.g. an RO or DOA who is
 *  also the traveller, or a delegate who raised the request and also holds an approver role) is
 *  therefore routed past their own step to an alternate approver. (Approver-only personas are
 *  already blocked from originating a request at all — see guards.canCreateTravelRequest.) */
export function selfApprovalSet(req: FullRequest): Set<string> {
  const ids = req.isGroup ? req.travellers.map((t) => t.employeeId) : [req.travellerId];
  return new Set<string>([...ids, req.requestorId]);
}

/** Walk up the reporting line from the traveller to the first Reporting Officer who is not in the
 *  self-approval set. Returns null if the chain is exhausted (no eligible RO). */
function resolveRoStep(travellerId: string, excluded: Set<string>): { id: string | null; escalated: boolean } {
  let current = EcsIdentity.employee(travellerId);
  let escalated = false;
  for (let i = 0; i < 12 && current?.reportingOfficerId; i++) {
    const ro = EcsIdentity.employee(current.reportingOfficerId);
    if (!ro) break;
    if (!excluded.has(ro.id)) return { id: ro.id, escalated };
    current = ro;
    escalated = true;
  }
  return { id: null, escalated };
}

/** §13.14 Eligible DOA candidates for a request — the highest-charging department's DOA
 *  line (research line for research routes) from the amount-band tier upward (the required
 *  tier plus any higher authority), excluding travellers. The DOA "system" may return more
 *  than one person, so the traveller picks one — it is never pre-selected. */
export function doaCandidatesFor(req: FullRequest, opts: { approvalAmount: number; sameRouteResearch: boolean }): { id: string; name: string; note: string }[] {
  const dept = EcsIdentity.department(highestChargingDept(req));
  const research = isResearchRequest(req) && !opts.sameRouteResearch;
  const line = research ? (dept?.researchDoaLine ?? dept?.doaLine ?? []) : (dept?.doaLine ?? []);
  const excluded = selfApprovalSet(req);
  const band = EcsWorkflow.bandForAmount(opts.approvalAmount);
  const tier = Math.min(band.doaTierIndex, Math.max(line.length - 1, 0));
  return line.slice(tier).filter((eid) => !excluded.has(eid)).map((eid, i) => ({
    id: eid, name: EcsIdentity.employee(eid)?.name ?? eid,
    note: i === 0 ? band.label : 'Higher authority (can approve this amount)',
  }));
}

/** Walk a DOA line and pick the tier, escalating past any holder in the self-approval set
 *  (a traveller on, or the requestor of, this request). */
function pickDoa(line: string[], tierIndex: number, excluded: Set<string>): { id: string | null; note?: string } {
  let idx = Math.min(tierIndex, line.length - 1);
  while (idx < line.length && excluded.has(line[idx])) idx++; // §13.5 self-approval prevention
  if (idx >= line.length) return { id: line[line.length - 1] ?? null, note: 'Escalated — no higher DOA tier available' };
  const note = idx !== Math.min(tierIndex, line.length - 1) ? 'Escalated to next-higher DOA (self-approval prevention)' : undefined;
  return { id: line[idx], note };
}

export function buildRoute(
  req: FullRequest,
  opts: { exceptionApproverRequired: boolean; sameRouteResearch: boolean; approvalAmount: number; hasException: boolean; crossBaThresholdSgd: number; roRequirement: string; guestUpgradeProvostId?: string | null; emergency?: { authoriserId: string | null; retrospective: boolean } },
): RouteStep[] {
  const steps: RouteStep[] = [];
  // §13.5 no one may approve a request they are travelling on OR raised — every step below routes
  // past anyone in this set (escalating up the line where a single-holder step would otherwise land
  // on them). Approver-only personas can't reach here at all (guards.canCreateTravelRequest).
  const excluded = selfApprovalSet(req);
  const deptId = highestChargingDept(req);
  const dept = EcsIdentity.department(deptId);
  const research = isResearchRequest(req) && !opts.sameRouteResearch;

  let seq = 1;

  // §13.x / DD-23 Emergency / retrospective lane — the emergency lane NO LONGER compresses the
  // route. It changes the TIMING of approval (book-first, ratified after the fact), never the SET
  // of approvers: the full workflow below is built exactly as for a standard request, so an
  // emergency cannot be used to skip the Additional / RO / cross-charge / Exception / DOA steps.
  // Each step is a retrospective ratification; the note (appended at the end) flags that to the
  // approver and in the audit trail. The authorising officer's e-mail authorises the book-first
  // hand-off; it is not itself a route step.
  const emergency = !!opts.emergency;

  // Pre-trip route (§51 configurable): Traveller → (optional Additional Approver, chosen by
  // the traveller — any AD person) → (Exception Approver when configured) → DOA. No RO step.
  // The Additional Approver is only inserted if one was selected and is not the traveller
  // (self-approval guard, §48).
  if (req.additionalApproverId && !excluded.has(req.additionalApproverId)) {
    steps.push({ seq: seq++, roleType: APPROVER_ROLE.AdditionalApprover, approverId: req.additionalApproverId, note: 'Additional approver added by requestor' });
  }

  // RO decision point (configurable — §51 workflow configuration): ALWAYS, INDIVIDUAL_ONLY
  // (present for individual requests, dropped for a group request), or NEVER. Resolved as the
  // traveller's Reporting Officer; when that RO is the traveller or the requestor, it escalates up
  // the reporting line to the next eligible officer (self-approval re-route, §13.5).
  const roNeeded = opts.roRequirement === 'ALWAYS' || (opts.roRequirement === 'INDIVIDUAL_ONLY' && !req.isGroup);
  if (roNeeded) {
    const ro = resolveRoStep(req.travellerId, excluded);
    if (ro.id) {
      steps.push({ seq: seq++, roleType: APPROVER_ROLE.RO, approverId: ro.id, note: ro.escalated ? 'Reporting Officer (escalated — self-approval prevention)' : 'Reporting Officer' });
    }
  }

  // Funding Owner for cross-charge requiring owner approval (§6.2).
  const crossCharge = req.allocations.map((a) => EcsCharging.code(a.chargingCode)).find((c) => c?.crossCharge && c.fundingOwnerId);
  if (crossCharge?.fundingOwnerId && !excluded.has(crossCharge.fundingOwnerId)) {
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
      // Candidate concurring approver: the BA's funding owner, else its DOA line. Pick the first who
      // is not in the self-approval set and not already on the route (§13.5 re-route).
      const candidates = [code?.fundingOwnerId, ...(baDept?.doaLine ?? [])].filter(Boolean) as string[];
      const approver = candidates.find((a) => !excluded.has(a) && !steps.some((s) => s.approverId === a)) ?? null;
      if (approver) {
        steps.push({ seq: seq++, roleType: APPROVER_ROLE.FundingOwner, approverId: approver, note: `Cross-BA concurrence — ${ba} share SGD ${baAmount.toFixed(0)} over SGD ${opts.crossBaThresholdSgd} threshold` });
      }
    }
  }

  // Exception approver inserted before DOA when a policy exception exists AND the
  // exception-routing setting is on; otherwise the exception is surfaced to the DOA (§26).
  if (opts.hasException && opts.exceptionApproverRequired) {
    // Pick the first exception approver who is not the traveller/requestor (§13.5 re-route).
    const exc = EcsRoles.employeesWithRole(ROLE.ExceptionApprover).find((e) => !excluded.has(e.id));
    if (exc) steps.push({ seq: seq++, roleType: APPROVER_ROLE.Exception, approverId: exc.id, note: 'Policy exception review' });
  }

  // §8 / DD-25 Guest travel-class upgrade — the selected Provost authorises the upgrade ahead of
  // the host DOA (the DOA still owns the cost). Inserted only for a guest upgrade with a chosen
  // Provost; the policy hard-stop guarantees a Provost is selected before submission.
  if (opts.guestUpgradeProvostId && !excluded.has(opts.guestUpgradeProvostId)) {
    steps.push({ seq: seq++, roleType: APPROVER_ROLE.Provost, approverId: opts.guestUpgradeProvostId, note: 'Guest travel-class upgrade — Provost authorisation (§8 / DD-25)' });
  }

  // DOA step — tier from amount band, line depends on research route.
  const band = EcsWorkflow.bandForAmount(opts.approvalAmount);
  const line = research ? (dept?.researchDoaLine ?? dept?.doaLine ?? []) : (dept?.doaLine ?? []);
  // §13.14 use the traveller's selected DOA when set (and not the traveller/requestor); else auto-pick.
  let doaId: string | null; let doaNote: string;
  if (req.selectedDoaId && !excluded.has(req.selectedDoaId)) {
    doaId = req.selectedDoaId; doaNote = `${band.label} · traveller-selected`;
  } else {
    const d = pickDoa(line, band.doaTierIndex, excluded); doaId = d.id; doaNote = [band.label, d.note].filter(Boolean).join(' · ');
  }
  steps.push({ seq: seq++, roleType: research ? APPROVER_ROLE.ResearchDOA : APPROVER_ROLE.DOA, approverId: doaId, note: doaNote });

  // §13.x / DD-23 emergency = the SAME route, ratified retrospectively (book-first). Flag every
  // step so the approver sees the booking was authorised ahead of their decision.
  if (emergency) {
    for (const s of steps) {
      s.note = s.note ? `${s.note} · retrospective ratification (emergency book-first, DD-23)` : 'Retrospective ratification (emergency book-first, DD-23)';
    }
  }

  return steps;
}

/** First pending step in a route determines the request's Pending-* status. */
export function statusForStep(roleType: string): string {
  if (roleType === APPROVER_ROLE.RO) return 'Pending RO Approval';
  if (roleType === APPROVER_ROLE.AdditionalApprover) return 'Pending Additional Approval';
  if (roleType === APPROVER_ROLE.Exception) return 'Pending Exception Approval';
  if (roleType === APPROVER_ROLE.Provost) return 'Pending Provost Approval';
  return 'Pending DOA Approval';
}
