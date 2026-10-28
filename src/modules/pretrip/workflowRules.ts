// §2.3 / §6.2 Rule-based approval routing for the Travel Request module — a nested decision tree
// (if/then/else) per TR workflow type, ported from the ECS/DOA "Workflow & Approval Config" engine.
// This engine is PURE (no DB): it reads a request's FACTS and emits an ordered list of approval
// STEP SPECS plus a decision trace. Turning a step spec into concrete approver(s) — reporting-line
// escalation, amount-band DOA tier, self-approval prevention, cross-BA fan-out — lives in the
// resolver layer (route.ts). Keeping the decision logic here as data is what makes TR routing
// configurable and extensible (a new condition or step is a tree edit, not a code change).

export type Cmp = 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'between' | 'is';
export type ScalarValue = string | number | boolean;
export type FactRef = { fact: string };   // compare a fact against ANOTHER fact (e.g. amount ≤ limit)
export type Condition = { fact: string; op: Cmp; value: ScalarValue | string[] | [number, number] | FactRef };
export type BoolExpr = Condition | { all: BoolExpr[] } | { any: BoolExpr[] } | { not: BoolExpr };

// How a step spec is resolved to a concrete approver in route.ts.
export type ResolverType = 'BAND_DOA' | 'RELATIONSHIP' | 'ROLE' | 'SELF' | 'FIXED';
// RELATIONSHIP refs (resolved relative to the traveller / charging), ROLE refs, FIXED refs.
export type RelationshipRef = 'RO' | 'FUNDING_OWNER' | 'CROSS_BA' | 'PROVOST';

export type RouteStepSpec = {
  resolver: ResolverType;
  ref?: string;        // RELATIONSHIP ref, ROLE code, or FIXED key
  roleType: string;    // APPROVER_ROLE the resolved step carries (ADDITIONAL_APPROVER | RO | DOA | …)
  approverId?: string; // ECS "Approver" — a specific named approver that overrides the resolver
  note?: string;       // builder note; the resolver may append detail (band label, escalation)
  requirement?: 'REQUIRED' | 'CONDITIONAL';
};

export type RuleNode =
  | { kind: 'sequence'; label?: string; nodes: RuleNode[] }                               // accumulate steps from each child in order
  | { kind: 'decision'; label?: string; when: BoolExpr; then: RuleNode; otherwise?: RuleNode }
  | { kind: 'route'; label?: string; steps: RouteStepSpec[] }
  | { kind: 'skip'; note?: string }                                                       // contributes no step (an empty slot)
  | { kind: 'block'; reason: string }
  | { kind: 'auto'; note?: string };

// ----- Fact catalogue (closed + typed, so the engine stays testable and the builder is guided) -----
export type FactDef = { key: string; label: string; type: 'number' | 'enum' | 'bool' | 'text'; values?: string[]; source?: string };
export const FACTS: FactDef[] = [
  { key: 'approvalAmount', label: 'Approval amount (SGD)', type: 'number', source: 'Charging' },
  { key: 'isGroup', label: 'Group request', type: 'bool', source: 'Request' },
  { key: 'researchRoute', label: 'Research funding route', type: 'bool', source: 'Charging' },
  { key: 'travellerIsPI', label: 'Traveller is Principal Investigator', type: 'bool', source: 'Workday' },
  { key: 'isGuest', label: 'Guest (non-employee) request', type: 'bool', source: 'Request' },
  { key: 'hasPolicyException', label: 'Has a policy exception', type: 'bool', source: 'Policy' },
  { key: 'crossBaCount', label: 'Business areas charged', type: 'number', source: 'Charging' },
  { key: 'crossChargeFundingOwnerPresent', label: 'Cross-charge funding owner present', type: 'bool', source: 'Charging' },
  { key: 'additionalApproverPresent', label: 'Additional approver selected', type: 'bool', source: 'Request' },
  { key: 'guestUpgradeProvostPresent', label: 'Guest-upgrade Provost selected', type: 'bool', source: 'Request' },
  { key: 'isEmergency', label: 'Emergency (book-first) lane', type: 'bool', source: 'Request' },
  // ModuleSettings scalars the route conditions reference (so the workflow config, not code, gates them)
  { key: 'roRequirement', label: 'RO requirement (setting)', type: 'enum', values: ['ALWAYS', 'INDIVIDUAL_ONLY', 'NEVER'], source: 'Settings' },
  { key: 'exceptionApproverRequired', label: 'Exception approver required (setting)', type: 'bool', source: 'Settings' },
  { key: 'researchPiSelfApproval', label: 'Research PI self-approval enabled (setting)', type: 'bool', source: 'Settings' },
  { key: 'selfApprovalLimitSgd', label: 'Self-approval limit (setting, SGD)', type: 'number', source: 'Settings' },
  { key: 'crossBaThresholdSgd', label: 'Cross-BA concurrence threshold (setting, SGD)', type: 'number', source: 'Settings' },
];
export const OPS_BY_TYPE: Record<string, Cmp[]> = { number: ['gt', 'gte', 'lt', 'lte', 'between', 'eq', 'ne'], enum: ['eq', 'ne', 'in'], text: ['eq', 'ne', 'in'], bool: ['is'] };
export const OP_LABEL: Record<Cmp, string> = { eq: '=', ne: '≠', gt: '>', gte: '≥', lt: '<', lte: '≤', in: 'in', between: 'between', is: 'is' };
export const factDef = (key: string) => FACTS.find((f) => f.key === key);
export const factLabel = (key: string) => factDef(key)?.label ?? key;

// ----- Evaluation -----
export type Ctx = Record<string, ScalarValue>;
export type TraceEntry = { text: string; result: boolean };

const isFactRef = (x: unknown): x is FactRef => typeof x === 'object' && x !== null && !Array.isArray(x) && 'fact' in (x as object);
/** The comparison right-hand side: a literal, or the current value of another fact (FactRef). */
function rhs(value: Condition['value'], ctx: Ctx): ScalarValue | string[] | [number, number] {
  return isFactRef(value) ? ctx[value.fact] : value;
}

function evalCondition(c: Condition, ctx: Ctx): boolean {
  const v = ctx[c.fact];
  const r = rhs(c.value, ctx);
  switch (c.op) {
    case 'eq': return v === r;
    case 'ne': return v !== r;
    case 'gt': return Number(v) > Number(r);
    case 'gte': return Number(v) >= Number(r);
    case 'lt': return Number(v) < Number(r);
    case 'lte': return Number(v) <= Number(r);
    case 'in': return Array.isArray(r) && (r as string[]).map(String).includes(String(v));
    case 'between': { const [a, b] = r as [number, number]; return Number(v) >= a && Number(v) <= b; }
    case 'is': return Boolean(v) === Boolean(r);
    default: return false;
  }
}

export function evalExpr(e: BoolExpr, ctx: Ctx): boolean {
  if ('all' in e) return e.all.every((x) => evalExpr(x, ctx));
  if ('any' in e) return e.any.some((x) => evalExpr(x, ctx));
  if ('not' in e) return !evalExpr(e.not, ctx);
  return evalCondition(e as Condition, ctx);
}

export function exprText(e: BoolExpr): string {
  if ('all' in e) return e.all.map((x) => ('all' in x || 'any' in x ? `(${exprText(x)})` : exprText(x))).join(' AND ');
  if ('any' in e) return e.any.map((x) => ('all' in x || 'any' in x ? `(${exprText(x)})` : exprText(x))).join(' OR ');
  if ('not' in e) return `NOT (${exprText(e.not)})`;
  const c = e as Condition;
  const val = isFactRef(c.value) ? factLabel(c.value.fact)
    : Array.isArray(c.value) ? (c.value as (string | number)[]).join(' / ')
    : String(c.value);
  return `${factLabel(c.fact)} ${OP_LABEL[c.op]} ${val}`;
}

export type ResolveOutcome = 'ROUTE' | 'BLOCK' | 'AUTO' | 'SKIP';
export type ResolveResult = { outcome: ResolveOutcome; steps: RouteStepSpec[]; reason?: string; trace: TraceEntry[] };

/** Walk the decision tree with a request context, recording the decision path taken. A `sequence`
 *  concatenates the step specs its children emit (a `skip`/`auto` child adds none); any `block`
 *  child blocks the whole route. */
export function resolveRoute(node: RuleNode, ctx: Ctx, trace: TraceEntry[] = []): ResolveResult {
  if (node.kind === 'route') return { outcome: 'ROUTE', steps: node.steps, trace };
  if (node.kind === 'skip') return { outcome: 'SKIP', steps: [], reason: node.note, trace };
  if (node.kind === 'block') return { outcome: 'BLOCK', steps: [], reason: node.reason, trace };
  if (node.kind === 'auto') return { outcome: 'AUTO', steps: [], reason: node.note ?? 'Auto-approved (no approver required).', trace };
  if (node.kind === 'sequence') {
    const steps: RouteStepSpec[] = [];
    for (const child of node.nodes) {
      const r = resolveRoute(child, ctx, trace);
      if (r.outcome === 'BLOCK') return r;
      steps.push(...r.steps);
    }
    return { outcome: 'ROUTE', steps, trace };
  }
  // decision
  const res = evalExpr(node.when, ctx);
  trace.push({ text: exprText(node.when), result: res });
  if (res) return resolveRoute(node.then, ctx, trace);
  if (node.otherwise) return resolveRoute(node.otherwise, ctx, trace);
  return { outcome: 'BLOCK', steps: [], reason: 'No matching branch — this slot routes nowhere (add an else/skip).', trace };
}
