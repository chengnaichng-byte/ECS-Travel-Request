// §6.2 ECS-structured TR approval-workflow configuration. Mirrors the ECS "Workflow configurations"
// screen: a named, effective-dated, enable-able Workflow SCENARIO → ordered Approval TIERS (an amount
// range, optionally with extra TR conditions) → ordered Approving LEVELS (an approval level + a
// resolver + an optional named approver, each gated by a TR condition). The scenario compiles to the
// pure decision-tree engine (workflowRules.ts). The default below REPRODUCES route.ts exactly and is
// the extension point for TR (add a tier, a level, or a condition without touching code).
import { APPROVER_ROLE } from '@/shared/enums';
import type { BoolExpr, ResolverType, RuleNode, RouteStepSpec } from '@/modules/pretrip/workflowRules';

export interface ApprovingLevel {
  seq: number;
  level: string;            // ECS "Approving Level" — the APPROVER_ROLE the step carries
  resolver: ResolverType;   // how the approver is resolved
  resolverLabel: string;    // ECS resolver wording, e.g. "All users with DOA role"
  ref?: string;             // RELATIONSHIP ref / ROLE code / FIXED key
  approverId?: string;      // optional specific approver (ECS "Approver")
  condition?: BoolExpr;     // TR extension — when this level applies (undefined = always)
  note?: string;
}

export interface ApprovalTier {
  seq: number;
  label: string;
  amountFrom: number;
  amountTo: number | null;  // null = no upper bound
  condition?: BoolExpr;     // TR extension — an extra gate on the whole tier
  levels: ApprovingLevel[];
}

export interface WorkflowScenario {
  code: string;
  name: string;
  effectiveFrom: string;
  effectiveTo: string;
  enabled: boolean;
  tiers: ApprovalTier[];
}

// The research-PI self-approval gate (#1), reused to make the DOA level its complement.
const PI_SELF_APPROVAL: BoolExpr = {
  all: [
    { fact: 'researchRoute', op: 'is', value: true },
    { fact: 'isGroup', op: 'is', value: false },
    { fact: 'researchPiSelfApproval', op: 'is', value: true },
    { fact: 'travellerIsPI', op: 'is', value: true },
    { fact: 'selfApprovalLimitSgd', op: 'gt', value: 0 },
    { fact: 'approvalAmount', op: 'lte', value: { fact: 'selfApprovalLimitSgd' } },
  ],
};

// Default TR workflow scenario — one tier spanning all amounts (the DOA level self-selects its tier
// by amount band), with the ordered approving levels that reproduce the hand-coded route in route.ts.
export const TR_STANDARD_SCENARIO: WorkflowScenario = {
  code: 'TR_STANDARD',
  name: 'Travel Request Approval Workflow',
  effectiveFrom: '2024-04-01',
  effectiveTo: '2031-03-31',
  enabled: true,
  tiers: [
    {
      seq: 1, label: 'All travel requests', amountFrom: 0, amountTo: null,
      levels: [
        { seq: 1, level: APPROVER_ROLE.AdditionalApprover, resolver: 'FIXED', ref: 'ADDITIONAL', resolverLabel: 'Requestor-selected additional approver',
          condition: { fact: 'additionalApproverPresent', op: 'is', value: true }, note: 'Additional approver added by requestor' },
        { seq: 2, level: APPROVER_ROLE.RO, resolver: 'RELATIONSHIP', ref: 'RO', resolverLabel: 'RO of traveller from Workday',
          condition: { any: [ { fact: 'roRequirement', op: 'eq', value: 'ALWAYS' }, { all: [ { fact: 'roRequirement', op: 'eq', value: 'INDIVIDUAL_ONLY' }, { fact: 'isGroup', op: 'is', value: false } ] } ] }, note: 'Reporting Officer' },
        { seq: 3, level: APPROVER_ROLE.FundingOwner, resolver: 'RELATIONSHIP', ref: 'FUNDING_OWNER', resolverLabel: 'Cross-charge account funding owner',
          condition: { fact: 'crossChargeFundingOwnerPresent', op: 'is', value: true }, note: 'Cross-charge funding owner concurrence' },
        { seq: 4, level: APPROVER_ROLE.FundingOwner, resolver: 'RELATIONSHIP', ref: 'CROSS_BA', resolverLabel: 'Non-primary BA funding owner / DOA (over threshold)',
          condition: { fact: 'crossBaCount', op: 'gt', value: 1 }, note: 'Cross-BA concurrence' },
        { seq: 5, level: APPROVER_ROLE.Exception, resolver: 'ROLE', ref: 'EXCEPTION_APPROVER', resolverLabel: 'All users with Exception Approver role',
          condition: { all: [ { fact: 'hasPolicyException', op: 'is', value: true }, { fact: 'exceptionApproverRequired', op: 'is', value: true } ] }, note: 'Policy exception review' },
        { seq: 6, level: APPROVER_ROLE.Provost, resolver: 'RELATIONSHIP', ref: 'PROVOST', resolverLabel: 'Selected Provost (host school)',
          condition: { fact: 'guestUpgradeProvostPresent', op: 'is', value: true }, note: 'Guest travel-class upgrade — Provost authorisation (§8 / DD-25)' },
        { seq: 7, level: APPROVER_ROLE.ResearchDOA, resolver: 'SELF', resolverLabel: 'Traveller (research PI self-approval)',
          condition: PI_SELF_APPROVAL, note: 'Research PI self-approval' },
        { seq: 8, level: APPROVER_ROLE.DOA, resolver: 'BAND_DOA', resolverLabel: 'DOA of highest-charging dept by amount band',
          condition: { not: PI_SELF_APPROVAL }, note: 'Delegation of Authority' },
      ],
    },
  ],
};

/** Compile an ECS-structured scenario to the pure decision-tree engine. Each tier becomes a decision
 *  on its amount range (+ any tier condition); its levels become an ordered sequence of per-level
 *  decisions that each emit one step spec when their condition holds. */
export function compileScenario(s: WorkflowScenario): RuleNode {
  const route = (l: ApprovingLevel): RuleNode => ({
    kind: 'route',
    steps: [{ resolver: l.resolver, ref: l.ref, roleType: l.level, approverId: l.approverId, note: l.note, requirement: l.condition ? 'CONDITIONAL' : 'REQUIRED' } as RouteStepSpec],
  });
  const tierNodes: RuleNode[] = s.tiers.map((tier) => {
    const amountGate: BoolExpr = tier.amountTo == null
      ? { fact: 'approvalAmount', op: 'gte', value: tier.amountFrom }
      : { all: [ { fact: 'approvalAmount', op: 'gte', value: tier.amountFrom }, { fact: 'approvalAmount', op: 'lte', value: tier.amountTo } ] };
    const gate: BoolExpr = tier.condition ? { all: [amountGate, tier.condition] } : amountGate;
    const levelSeq: RuleNode = {
      kind: 'sequence', label: tier.label,
      nodes: tier.levels.map((l) => l.condition
        ? ({ kind: 'decision', label: l.level, when: l.condition, then: route(l), otherwise: { kind: 'skip' } } as RuleNode)
        : route(l)),
    };
    return { kind: 'decision', label: tier.label, when: gate, then: levelSeq, otherwise: { kind: 'skip' } } as RuleNode;
  });
  return { kind: 'sequence', label: s.name, nodes: tierNodes };
}
