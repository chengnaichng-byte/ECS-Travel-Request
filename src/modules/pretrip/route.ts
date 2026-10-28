// §6.2 approval-route builder + §13.5 self-approval prevention + §13.14 group
// routing. Extends the existing ECS workflow engine conceptually: the evaluator
// takes module, workflow type, amount basis and request context (§2.3) and emits an
// ordered list of approval steps. Nothing here is hard-coded per user — it reads the
// reference workflow bands and org DOA lines.
import { EcsIdentity, EcsCharging, EcsWorkflow, EcsRoles } from '@/shared/ecs/services';
import { APPROVER_ROLE, ROLE } from '@/shared/enums';
import type { FullRequest } from './queries';
import { isGuestRequest } from './traveller';
import { resolveRoute, type Ctx, type RouteStepSpec } from './workflowRules';
import { compileScenario, TR_STANDARD_SCENARIO, type WorkflowScenario } from '@/config/workflowScenario';

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

export type RouteOpts = { exceptionApproverRequired: boolean; sameRouteResearch: boolean; approvalAmount: number; hasException: boolean; crossBaThresholdSgd: number; roRequirement: string; guestUpgradeProvostId?: string | null; researchPiSelfApproval?: boolean; selfApprovalLimitSgd?: number; emergency?: { authoriserId: string | null; retrospective: boolean } };

/** §2.3 Gather the closed FACTS the workflow engine evaluates, from the request + settings. Presence
 *  facts already apply §13.5 self-approval exclusion so a step the originator would fill is not raised. */
export function gatherWorkflowFacts(req: FullRequest, opts: RouteOpts, excluded: Set<string>): Ctx {
  const baSet = new Set<string>();
  for (const a of req.allocations) { const ba = EcsCharging.code(a.chargingCode)?.businessArea; if (ba) baSet.add(ba); }
  const crossChargeFO = req.allocations.map((a) => EcsCharging.code(a.chargingCode)).find((c) => c?.crossCharge && c.fundingOwnerId);
  return {
    approvalAmount: opts.approvalAmount,
    isGroup: req.isGroup,
    researchRoute: isResearchRequest(req) && !opts.sameRouteResearch,
    travellerIsPI: EcsIdentity.employee(req.travellerId)?.isPi === true,
    isGuest: isGuestRequest(req),
    hasPolicyException: opts.hasException,
    crossBaCount: baSet.size,
    crossChargeFundingOwnerPresent: !!(crossChargeFO?.fundingOwnerId && !excluded.has(crossChargeFO.fundingOwnerId)),
    additionalApproverPresent: !!(req.additionalApproverId && !excluded.has(req.additionalApproverId)),
    guestUpgradeProvostPresent: !!(opts.guestUpgradeProvostId && !excluded.has(opts.guestUpgradeProvostId)),
    isEmergency: !!opts.emergency,
    roRequirement: opts.roRequirement,
    exceptionApproverRequired: opts.exceptionApproverRequired,
    researchPiSelfApproval: !!opts.researchPiSelfApproval,
    selfApprovalLimitSgd: opts.selfApprovalLimitSgd ?? 0,
    crossBaThresholdSgd: opts.crossBaThresholdSgd,
  };
}

/** Resolve the engine's ordered step SPECS into concrete approval steps — reporting-line escalation,
 *  amount-band DOA tier, research line, cross-BA fan-out (0..N) and self-approval prevention all live
 *  here (the engine decides WHICH steps apply; this decides WHO fills each). */
function resolveSpecs(specs: RouteStepSpec[], req: FullRequest, opts: RouteOpts, excluded: Set<string>): RouteStep[] {
  const steps: RouteStep[] = [];
  const used = new Set<string>();   // approvers already on the route (cross-BA dedup, §13.5)
  const dept = EcsIdentity.department(highestChargingDept(req));
  const research = isResearchRequest(req) && !opts.sameRouteResearch;
  const band = EcsWorkflow.bandForAmount(opts.approvalAmount);
  let seq = 1;
  const push = (roleType: string, approverId: string | null, note: string) => { if (approverId) used.add(approverId); steps.push({ seq: seq++, roleType, approverId, note }); };

  for (const spec of specs) {
    // ECS "Approver" — a specific named approver pinned on the level overrides the resolver.
    if (spec.approverId && !excluded.has(spec.approverId)) { push(spec.roleType, spec.approverId, spec.note ?? 'Named approver'); continue; }

    if (spec.resolver === 'FIXED' && spec.ref === 'ADDITIONAL') {
      if (req.additionalApproverId && !excluded.has(req.additionalApproverId)) push(APPROVER_ROLE.AdditionalApprover, req.additionalApproverId, spec.note ?? 'Additional approver added by requestor');
    } else if (spec.resolver === 'RELATIONSHIP' && spec.ref === 'RO') {
      const ro = resolveRoStep(req.travellerId, excluded);
      if (ro.id) push(APPROVER_ROLE.RO, ro.id, ro.escalated ? 'Reporting Officer (escalated — self-approval prevention)' : 'Reporting Officer');
    } else if (spec.resolver === 'RELATIONSHIP' && spec.ref === 'FUNDING_OWNER') {
      const cc = req.allocations.map((a) => EcsCharging.code(a.chargingCode)).find((c) => c?.crossCharge && c.fundingOwnerId);
      if (cc?.fundingOwnerId && !excluded.has(cc.fundingOwnerId)) push(APPROVER_ROLE.FundingOwner, cc.fundingOwnerId, 'Cross-charge funding owner concurrence');
    } else if (spec.resolver === 'RELATIONSHIP' && spec.ref === 'CROSS_BA') {
      const baShare: Record<string, number> = {};
      for (const a of req.allocations) { const ba = EcsCharging.code(a.chargingCode)?.businessArea; if (ba) baShare[ba] = (baShare[ba] ?? 0) + a.percent; }
      for (const [ba, pct] of Object.entries(baShare).sort((x, y) => y[1] - x[1]).slice(1)) {
        const baAmount = opts.approvalAmount * (pct / 100);
        if (baAmount <= opts.crossBaThresholdSgd) continue;
        const code = req.allocations.map((a) => EcsCharging.code(a.chargingCode)).find((c) => c?.businessArea === ba);
        const baDept = code?.departmentId ? EcsIdentity.department(code.departmentId) : undefined;
        const candidates = [code?.fundingOwnerId, ...(baDept?.doaLine ?? [])].filter(Boolean) as string[];
        const approver = candidates.find((a) => !excluded.has(a) && !used.has(a)) ?? null;
        if (approver) push(APPROVER_ROLE.FundingOwner, approver, `Cross-BA concurrence — ${ba} share SGD ${baAmount.toFixed(0)} over SGD ${opts.crossBaThresholdSgd} threshold`);
      }
    } else if (spec.resolver === 'ROLE' && spec.ref === 'EXCEPTION_APPROVER') {
      const exc = EcsRoles.employeesWithRole(ROLE.ExceptionApprover).find((e) => !excluded.has(e.id));
      if (exc) push(APPROVER_ROLE.Exception, exc.id, 'Policy exception review');
    } else if (spec.resolver === 'RELATIONSHIP' && spec.ref === 'PROVOST') {
      if (opts.guestUpgradeProvostId && !excluded.has(opts.guestUpgradeProvostId)) push(APPROVER_ROLE.Provost, opts.guestUpgradeProvostId, 'Guest travel-class upgrade — Provost authorisation (§8 / DD-25)');
    } else if (spec.resolver === 'SELF') {
      // #1 the sanctioned exception to self-approval prevention — the PI is the DOA (assigned directly).
      push(APPROVER_ROLE.ResearchDOA, req.travellerId, `${band.label} · Research PI self-approval (≤ SGD ${(opts.selfApprovalLimitSgd ?? 0).toLocaleString('en-SG')})`);
    } else if (spec.resolver === 'BAND_DOA') {
      const line = research ? (dept?.researchDoaLine ?? dept?.doaLine ?? []) : (dept?.doaLine ?? []);
      let doaId: string | null; let doaNote: string;
      if (req.selectedDoaId && !excluded.has(req.selectedDoaId)) { doaId = req.selectedDoaId; doaNote = `${band.label} · traveller-selected`; }
      else { const d = pickDoa(line, band.doaTierIndex, excluded); doaId = d.id; doaNote = [band.label, d.note].filter(Boolean).join(' · '); }
      push(research ? APPROVER_ROLE.ResearchDOA : APPROVER_ROLE.DOA, doaId, doaNote);
    }
  }

  // §13.x / DD-23 emergency = the SAME route, ratified retrospectively (book-first). Flag every step.
  if (opts.emergency) for (const s of steps) s.note = s.note ? `${s.note} · retrospective ratification (emergency book-first, DD-23)` : 'Retrospective ratification (emergency book-first, DD-23)';
  return steps;
}

/** The active TR workflow scenario (Phase 1: the seeded default; a stored/edited scenario drives it
 *  in a later phase). Kept as a function so the source is a single place to swap. */
export function activeWorkflowScenario(): WorkflowScenario {
  return TR_STANDARD_SCENARIO;
}

export function buildRoute(req: FullRequest, opts: RouteOpts): RouteStep[] {
  // §13.5 no one may approve a request they are travelling on OR raised.
  const excluded = selfApprovalSet(req);
  const facts = gatherWorkflowFacts(req, opts, excluded);
  const resolved = resolveRoute(compileScenario(activeWorkflowScenario()), facts);
  if (resolved.outcome === 'BLOCK') return [];
  return resolveSpecs(resolved.steps, req, opts, excluded);
}

/** First pending step in a route determines the request's Pending-* status. */
export function statusForStep(roleType: string): string {
  if (roleType === APPROVER_ROLE.RO) return 'Pending RO Approval';
  if (roleType === APPROVER_ROLE.AdditionalApprover) return 'Pending Additional Approval';
  if (roleType === APPROVER_ROLE.Exception) return 'Pending Exception Approval';
  if (roleType === APPROVER_ROLE.Provost) return 'Pending Provost Approval';
  return 'Pending DOA Approval';
}
