// §6.2 ECS-structured TR approval-workflow configuration, mirroring the ECS "Edit workflow rule"
// screen: a named, effective-dated Workflow SCENARIO with two sections —
//   • Approval TIERS — the amount-band base route: "Total expense amount from X to Y" → ordered
//     Approving LEVELS (level + resolver + optional approver).
//   • Decision POINTS — conditional modifiers applied on top of the base: ANDed Field/Operator/Value
//     conditions → Actions that SKIP / ADD / REPLACE an approver (e.g. Skip RO, Add Exception approver,
//     Replace DOA with the traveller for PI self-approval).
// The seeded TR_STANDARD scenario reproduces route.ts EXACTLY and is the extension point for TR.
import { APPROVER_ROLE } from '@/shared/enums';
import type { BoolExpr, Condition, ResolverType, RouteStepSpec, Ctx, TraceEntry } from '@/modules/pretrip/workflowRules';
import { evalExpr, exprText } from '@/modules/pretrip/workflowRules';

export interface ApprovingLevel {
  seq: number;
  level: string;            // ECS "Approving Level" — the APPROVER_ROLE the step carries
  resolver: ResolverType;   // how the approver is resolved
  resolverLabel: string;    // ECS resolver wording, e.g. "All users with DOA role"
  ref?: string;
  approverId?: string;      // optional specific approver (ECS "Approver")
  order?: number;           // precedence in the final route
  note?: string;
}

export interface ApprovalTier {
  seq: number;
  amountFrom: number;
  amountTo: number | null;  // null = no upper bound
  levels: ApprovingLevel[];
}

export type DecisionVerb = 'SKIP' | 'ADD' | 'REPLACE';
export interface DecisionAction {
  verb: DecisionVerb;
  targetLevel: string;      // the APPROVER_ROLE to skip / replace, or the role an ADD carries
  resolver?: ResolverType;  // ADD/REPLACE: how to resolve the (new) approver
  resolverLabel?: string;
  ref?: string;
  approverId?: string;      // ADD/REPLACE with a specific named approver
  order?: number;           // ADD: precedence placement
  note?: string;
}
export interface DecisionPoint {
  seq: number;
  label?: string;
  conditions: Condition[];  // ANDed (ECS "Condition(s)")
  actions: DecisionAction[];
}

export interface WorkflowScenario {
  code: string;
  name: string;
  effectiveFrom: string;
  effectiveTo: string;
  enabled: boolean;
  tiers: ApprovalTier[];
  decisionPoints: DecisionPoint[];
}

// Canonical precedence so the final route keeps the §6.2 order regardless of how steps were added:
// Additional → RO → Exception → Provost → DOA. Cross-charge and cross-business-area authority is the
// DOA's — the DOA of the highest-share charging account — not a separate approver, so there is no
// Funding Owner / Cross-BA step.
export function defaultOrder(roleType: string, _ref?: string): number {
  if (roleType === APPROVER_ROLE.AdditionalApprover) return 10;
  if (roleType === APPROVER_ROLE.RO) return 20;
  if (roleType === APPROVER_ROLE.Exception) return 50;
  if (roleType === APPROVER_ROLE.Provost) return 60;
  return 70; // DOA / Research DOA
}

const PI_SELF_APPROVAL: Condition[] = [
  { fact: 'researchRoute', op: 'is', value: true },
  { fact: 'isGroup', op: 'is', value: false },
  { fact: 'researchPiSelfApproval', op: 'is', value: true },
  { fact: 'travellerIsPI', op: 'is', value: true },
  { fact: 'selfApprovalLimitSgd', op: 'gt', value: 0 },
  { fact: 'approvalAmount', op: 'lte', value: { fact: 'selfApprovalLimitSgd' } },
];

// Default TR scenario (§6.2). Core personas: RO → DOA. RO is the reporting-officer check for an
// INDIVIDUAL EMPLOYEE request; it is skipped for a group and for a guest. The Additional Approver is
// optional (added when the requestor selects one at submission). The Provost is the exception approver
// for a travel-class upgrade (guest-only for now; an admin can extend it to employees by relaxing the
// condition). Other policy exceptions go to the Exception Approver. A research-PI self-approval replaces
// the DOA with the traveller within the limit.
export const TR_STANDARD_SCENARIO: WorkflowScenario = {
  code: 'TR_STANDARD',
  name: 'Travel Request Approval Workflow',
  effectiveFrom: '2024-04-01',
  effectiveTo: '2031-03-31',
  enabled: true,
  tiers: [
    {
      seq: 1, amountFrom: 0, amountTo: null,
      levels: [
        { seq: 1, level: APPROVER_ROLE.RO, resolver: 'RELATIONSHIP', ref: 'RO', resolverLabel: 'RO of traveller from Workday', order: 20, note: 'Reporting Officer' },
        { seq: 2, level: APPROVER_ROLE.DOA, resolver: 'BAND_DOA', resolverLabel: 'DOA of highest-charging dept by amount band', order: 70, note: 'Delegation of Authority' },
      ],
    },
  ],
  decisionPoints: [
    // RO is the core approver for an individual employee; skip it for a group (handled as one request)
    // and for a guest (an external traveller has no NTU reporting officer).
    { seq: 1, label: 'Skip RO for a group request', conditions: [{ fact: 'isGroup', op: 'is', value: true }], actions: [{ verb: 'SKIP', targetLevel: APPROVER_ROLE.RO }] },
    { seq: 2, label: 'Skip RO for a guest request', conditions: [{ fact: 'isGuest', op: 'is', value: true }], actions: [{ verb: 'SKIP', targetLevel: APPROVER_ROLE.RO }] },
    // Optional, added at submission when the requestor selects one.
    { seq: 3, label: 'Add the requestor-selected Additional Approver', conditions: [{ fact: 'additionalApproverPresent', op: 'is', value: true }], actions: [{ verb: 'ADD', targetLevel: APPROVER_ROLE.AdditionalApprover, resolver: 'FIXED', ref: 'ADDITIONAL', resolverLabel: 'Requestor-selected additional approver', order: 10 }] },
    // Cross-charge and cross-business-area authority is the DOA's (the DOA of the highest-share charging
    // account resolved by the base BAND_DOA level) — NOT a separate approver.
    { seq: 4, label: 'Add the Exception Approver when a policy exception needs one', conditions: [{ fact: 'hasPolicyException', op: 'is', value: true }, { fact: 'exceptionApproverRequired', op: 'is', value: true }], actions: [{ verb: 'ADD', targetLevel: APPROVER_ROLE.Exception, resolver: 'ROLE', ref: 'EXCEPTION_APPROVER', resolverLabel: 'All users with Exception Approver role', order: 50 }] },
    // Provost = the exception approver for a travel-class upgrade. Guest-only for now (the isGuest
    // condition); an administrator can remove that condition to extend it to employee upgrades.
    { seq: 5, label: 'Add the Provost for a travel-class upgrade (guest)', conditions: [{ fact: 'isGuest', op: 'is', value: true }, { fact: 'travelClassUpgradeException', op: 'is', value: true }], actions: [{ verb: 'ADD', targetLevel: APPROVER_ROLE.Provost, resolver: 'RELATIONSHIP', ref: 'PROVOST', resolverLabel: 'Selected Provost (host school)', order: 60 }] },
    { seq: 6, label: 'Replace the DOA with the traveller for research PI self-approval', conditions: PI_SELF_APPROVAL, actions: [{ verb: 'REPLACE', targetLevel: APPROVER_ROLE.DOA, resolver: 'SELF', resolverLabel: 'Traveller (research PI self-approval)', note: 'Research PI self-approval' }] },
  ],
};

export function defaultScenarioFor(code: string): WorkflowScenario | null {
  return code === 'TR_STANDARD' ? TR_STANDARD_SCENARIO : null;
}

export interface ScenarioEval { steps: RouteStepSpec[]; trace: TraceEntry[] }

/** Evaluate a scenario against a request's facts → the ordered approval step SPECS + a decision trace.
 *  1) pick the amount tier → base level specs; 2) apply each decision point (Skip/Add/Replace) in
 *  order; 3) sort by canonical precedence. route.ts then resolves each spec to concrete approver(s). */
export function evaluateScenario(s: WorkflowScenario, ctx: Ctx): ScenarioEval {
  const trace: TraceEntry[] = [];
  const amount = Number(ctx.approvalAmount ?? 0);
  const tier = s.tiers.find((t) => amount >= t.amountFrom && (t.amountTo == null || amount <= t.amountTo)) ?? s.tiers[0];
  if (tier) trace.push({ text: `Amount tier: SGD ${tier.amountFrom.toLocaleString('en-SG')} – ${tier.amountTo == null ? '∞' : tier.amountTo.toLocaleString('en-SG')}`, result: true });

  let specs: RouteStepSpec[] = (tier?.levels ?? []).map((l) => ({ resolver: l.resolver, ref: l.ref, roleType: l.level, approverId: l.approverId, note: l.note, order: l.order ?? defaultOrder(l.level, l.ref) }));

  for (const dp of s.decisionPoints) {
    const match = dp.conditions.length > 0 && evalExpr({ all: dp.conditions } as BoolExpr, ctx);
    trace.push({ text: dp.label ?? exprText({ all: dp.conditions } as BoolExpr), result: match });
    if (!match) continue;
    for (const a of dp.actions) {
      if (a.verb === 'SKIP') {
        specs = specs.filter((sp) => sp.roleType !== a.targetLevel);
      } else if (a.verb === 'REPLACE') {
        specs = specs.map((sp) => sp.roleType === a.targetLevel
          ? { ...sp, resolver: a.resolver ?? sp.resolver, ref: a.ref ?? (a.resolver ? undefined : sp.ref), roleType: a.targetLevel, approverId: a.approverId ?? sp.approverId, note: a.note ?? sp.note }
          : sp);
      } else { // ADD
        specs.push({ resolver: a.resolver ?? 'ROLE', ref: a.ref, roleType: a.targetLevel, approverId: a.approverId, note: a.note, order: a.order ?? defaultOrder(a.targetLevel, a.ref) });
      }
    }
  }

  specs.sort((x, y) => (x.order ?? 999) - (y.order ?? 999));
  return { steps: specs, trace };
}
