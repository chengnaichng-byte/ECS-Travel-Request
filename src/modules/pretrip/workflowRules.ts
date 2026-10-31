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
export type RelationshipRef = 'RO' | 'PROVOST';

export type RouteStepSpec = {
  resolver: ResolverType;
  ref?: string;        // RELATIONSHIP ref, ROLE code, or FIXED key
  roleType: string;    // APPROVER_ROLE the resolved step carries (ADDITIONAL_APPROVER | RO | DOA | …)
  approverId?: string; // ECS "Approver" — a specific named approver that overrides the resolver
  note?: string;       // builder note; the resolver may append detail (band label, escalation)
  order?: number;      // canonical precedence for ordering the final route (base levels + decision adds)
  requirement?: 'REQUIRED' | 'CONDITIONAL';
  autoGrant?: boolean; // §6.2 the step stays ON the route (named approver) but is auto-granted on
                       // submission — set by an AUTO_GRANT decision point (e.g. non-term research).
};

// ----- Fact catalogue (closed + typed, so the engine stays testable and the builder is guided) -----
export type FactDef = { key: string; label: string; type: 'number' | 'enum' | 'bool' | 'text'; values?: string[]; source?: string };
export const FACTS: FactDef[] = [
  { key: 'approvalAmount', label: 'Approval amount (SGD)', type: 'number', source: 'Charging' },
  { key: 'isGroup', label: 'Group request', type: 'bool', source: 'Request' },
  { key: 'researchRoute', label: 'Research funding route', type: 'bool', source: 'Charging' },
  { key: 'travellerIsPI', label: 'Traveller is Principal Investigator', type: 'bool', source: 'Workday' },
  { key: 'travellerIsEligibleDoa', label: 'Traveller is an eligible DOA (in the DOA list at tier)', type: 'bool', source: 'DOA rules' },
  { key: 'isGuest', label: 'Guest (non-employee) request', type: 'bool', source: 'Request' },
  { key: 'hasPolicyException', label: 'Has a policy exception', type: 'bool', source: 'Policy' },
  { key: 'nonTermResearchAutoApprove', label: 'Non-term research — auto-approve', type: 'bool', source: 'Policy' },
  { key: 'additionalApproverPresent', label: 'Additional approver selected', type: 'bool', source: 'Request' },
  { key: 'travelClassUpgradeException', label: 'Travel-class upgrade (exception)', type: 'bool', source: 'Policy' },
  // §6.2 ECS-mirrored fields (Expense-Claim "Edit workflow rule" → Travel-Request equivalents)
  { key: 'seniorManager', label: 'Senior manager (traveller)', type: 'bool', source: 'Workday' },
  { key: 'traveller', label: 'Traveller (user)', type: 'text', source: 'Request' },
  { key: 'travelPurpose', label: 'Travel purpose', type: 'text', source: 'Request' },
  { key: 'chargingAccountCode', label: 'Charging account (CC / WBS code)', type: 'text', source: 'Charging' },
  { key: 'chargingIsDefaultAccount', label: 'Charging = traveller default account (Workday)', type: 'bool', source: 'Charging' },
  { key: 'isEmergency', label: 'Emergency (book-first) lane', type: 'bool', source: 'Request' },
  // ModuleSettings scalars the route conditions reference (so the workflow config, not code, gates them)
  { key: 'roRequirement', label: 'RO requirement (setting)', type: 'enum', values: ['ALWAYS', 'INDIVIDUAL_ONLY', 'NEVER'], source: 'Settings' },
  { key: 'exceptionApproverRequired', label: 'Exception approver required (setting)', type: 'bool', source: 'Settings' },
  { key: 'researchPiSelfApproval', label: 'Research PI self-approval enabled (setting)', type: 'bool', source: 'Settings' },
  { key: 'selfApprovalLimitSgd', label: 'Self-approval limit (setting, SGD)', type: 'number', source: 'Settings' },
];
export const OPS_BY_TYPE: Record<string, Cmp[]> = { number: ['gt', 'gte', 'lt', 'lte', 'between', 'eq', 'ne'], enum: ['eq', 'ne', 'in'], text: ['eq', 'ne', 'in'], bool: ['is'] };
// ECS "Operator" wording (matches the Workflow Configurations ▸ Edit workflow rule screen). A boolean
// field compares with 'is' but reads as "Equal To" + Yes/No, exactly as ECS presents it.
export const OP_LABEL: Record<Cmp, string> = { eq: 'Equal To', ne: 'Not Equal To', gt: 'Greater Than', gte: 'Greater Or Equal To', lt: 'Less Than', lte: 'Less Or Equal To', in: 'In', between: 'Between', is: 'Equal To' };
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
    : c.op === 'is' ? (c.value ? 'Yes' : 'No')            // ECS boolean = Yes / No
    : Array.isArray(c.value) ? (c.value as (string | number)[]).join(' / ')
    : String(c.value);
  return `${factLabel(c.fact)} ${OP_LABEL[c.op]} ${val}`;
}

// The scenario evaluator (tiers + decision points) lives in @/config/workflowScenario (evaluateScenario),
// which uses the primitives above (evalExpr / exprText / RouteStepSpec) to emit the ordered route specs.
