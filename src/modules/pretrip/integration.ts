// §13.8/§13.9 Integration Contract service. Resolves the editable contract by
// overlaying admin overrides (IntegrationFieldSetting) on the CONTRACT_FIELDS
// defaults, and derives the shapes consumed by the two payload builders:
//   • tmcEnabledSet(...)  → keys included in the outbound TMC booking instruction
//   • prepopContract(...) → per-field / per-line treatment for the TE claim sync
import { prisma } from '@/shared/db';
import { CONTRACT_FIELDS, CONTRACT_GUARDS, GUARD_PARAM_LABELS, guardEditable, type TeTreatment, type ContractGuard, type GuardFlow, type GuardParam } from '@/config/integrationContracts';

export interface ResolvedField { key: string; includeTmc: boolean; teTreatment: TeTreatment }
export type ResolvedContract = Record<string, ResolvedField>;

/** Merge persisted overrides over the declarative defaults. Core TMC fields are
 * always included; unset TE fields fall back to their catalogue default. */
export async function getContractSettings(): Promise<ResolvedContract> {
  const rows = await prisma.integrationFieldSetting.findMany();
  const byKey = new Map(rows.map((r) => [r.key, r]));
  const out: ResolvedContract = {};
  for (const f of CONTRACT_FIELDS) {
    const r = byKey.get(f.key);
    out[f.key] = {
      key: f.key,
      includeTmc: f.tmc === 'core' ? true : r ? r.includeTmc : Boolean(f.defaultTmc),
      teTreatment: (r?.teTreatment as TeTreatment) ?? f.defaultTe ?? 'EXCLUDED',
    };
  }
  return out;
}

/** Set of field keys included in the TMC booking instruction. */
export function tmcEnabledSet(resolved: ResolvedContract): Set<string> {
  return new Set(Object.values(resolved).filter((r) => r.includeTmc).map((r) => r.key));
}

export interface PrepopContract {
  header: Record<string, TeTreatment>;      // header field key → treatment
  line: Record<string, TeTreatment>;        // EXPENSE_CATEGORY → treatment
  bookedAmounts: boolean;                    // include the TMC-fed booked column?
}

/** Shape consumed by prepopulateClaim. */
export function prepopContract(resolved: ResolvedContract): PrepopContract {
  const header: Record<string, TeTreatment> = {};
  const line: Record<string, TeTreatment> = {};
  for (const f of CONTRACT_FIELDS) {
    if (f.te === 'field') header[f.key] = resolved[f.key].teTreatment;
    else if (f.te === 'line' && f.category) line[f.category] = resolved[f.key].teTreatment;
  }
  return { header, line, bookedAmounts: resolved['teBookedAmounts']?.teTreatment !== 'EXCLUDED' };
}

/* ---------------- Parameter filters (message guards, §13.9) ---------------- */

export interface ResolvedGuard extends ContractGuard { enabled: boolean }

/** Decode a persisted guard value: `in` guards store a JSON array, others a string. */
function decodeGuardValue(op: string, stored: string): string | string[] {
  if (op !== 'in') return stored;
  try { const a = JSON.parse(stored); return Array.isArray(a) ? a.map(String) : []; } catch { return []; }
}

/** Merge persisted guard overrides (enabled + editable value) over the catalogue. */
export async function getGuardSettings(): Promise<ResolvedGuard[]> {
  const rows = await prisma.integrationGuardSetting.findMany();
  const byKey = new Map(rows.map((r) => [r.key, r]));
  return CONTRACT_GUARDS.map((g) => {
    const r = byKey.get(g.key);
    let value = g.value;
    if (guardEditable(g) && r && r.value) {
      const decoded = decodeGuardValue(g.op, r.value);
      // Ignore a stored value that can't form a usable set for an `in` guard (e.g. a stale
      // value left by an eq→in operator change) — fall back to the catalogue default so the
      // guard never silently evaluates against an empty set and blocks the flow.
      value = g.op === 'in' ? (Array.isArray(decoded) && decoded.length ? decoded : g.value) : decoded;
    }
    return { ...g, value, enabled: r ? r.enabled : true };
  });
}

/** Minimal request context a guard reads. */
export interface GuardContext { status: string; bookingStatus: string; bookingMethod: string | null; authorisationNo: string | null }

function paramValue(ctx: GuardContext, param: GuardParam): string | null {
  switch (param) {
    case 'status': return ctx.status;
    case 'bookingStatus': return ctx.bookingStatus;
    case 'bookingMethod': return ctx.bookingMethod;
    case 'authorisationNo': return ctx.authorisationNo;
  }
}

function guardPasses(g: ResolvedGuard, ctx: GuardContext): boolean {
  const v = paramValue(ctx, g.param);
  if (g.op === 'isSet') return v != null && v !== '';
  if (g.op === 'eq') return v === g.value;
  if (g.op === 'in') return Array.isArray(g.value) && v != null && g.value.includes(v);
  return true;
}

/** Human-readable rule text, e.g. "Approval status = Approved". */
export function guardRuleText(g: ContractGuard, value?: string | string[]): string {
  const label = GUARD_PARAM_LABELS[g.param];
  const val = value ?? g.value;
  if (g.op === 'isSet') return `${label} is set`;
  if (g.op === 'in') return `${label} ∈ { ${(Array.isArray(val) ? val : []).join(', ')} }`;
  return `${label} = ${val}`;
}

export interface GuardCheck { key: string; label: string; rule: string; pass: boolean; actual: string }
export interface FlowEvaluation { ok: boolean; checks: GuardCheck[] }

/** Evaluate all enabled guards for a flow against a request context. */
export function evaluateFlow(ctx: GuardContext, flow: GuardFlow, guards: ResolvedGuard[]): FlowEvaluation {
  const checks = guards.filter((g) => g.flow === flow && g.enabled).map((g) => ({
    key: g.key, label: g.label, rule: guardRuleText(g, g.value), pass: guardPasses(g, ctx), actual: paramValue(ctx, g.param) ?? '—',
  }));
  return { ok: checks.every((c) => c.pass), checks };
}
