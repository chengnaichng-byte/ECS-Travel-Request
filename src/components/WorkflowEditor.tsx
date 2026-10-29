'use client';
// §6.2 Workflow editor — the ECS "Edit workflow rule" form, runtime-editable. Workflow details +
// Approval TIERS (amount range → Approving Levels: level · resolver · optional approver) + Decision
// POINTS (ANDed Field/Operator/Value conditions → Actions: Skip / Add / Replace an approver). The
// whole scenario is submitted as JSON to a server action; routing reads it on the next request.
import { useState, useTransition } from 'react';
import type { WorkflowScenario, ApprovalTier, ApprovingLevel, DecisionPoint, DecisionAction, DecisionVerb } from '@/config/workflowScenario';
import type { Cmp, Condition, FactDef, ResolverType } from '@/modules/pretrip/workflowRules';
import { OPS_BY_TYPE, OP_LABEL } from '@/modules/pretrip/workflowRules';

// APPROVER_ROLE values (kept as string literals; the client can't import the server enum freely).
const ROLES: { value: string; label: string }[] = [
  { value: 'ADDITIONAL_APPROVER', label: 'Additional Approver' },
  { value: 'RO', label: 'RO' },
  { value: 'EXCEPTION', label: 'Exception Approver' },
  { value: 'PROVOST', label: 'Provost' },
  { value: 'DOA', label: 'DOA' },
  { value: 'RESEARCH_DOA', label: 'Research DOA' },
];

// ECS-style single "Action" commands (verb + short role), as the ECS screen presents them
// ("Skip RO", "Skip DOA", "Add DOA", "Replace RO", …). Each maps to a DecisionAction.
type Command = { key: string; label: string; verb: DecisionVerb; targetLevel: string; resolver?: ResolverType; ref?: string; resolverLabel?: string; needsApprover?: boolean };
const COMMANDS: Command[] = [
  { key: 'SKIP_RO', label: 'Skip RO', verb: 'SKIP', targetLevel: 'RO' },
  { key: 'SKIP_DOA', label: 'Skip DOA', verb: 'SKIP', targetLevel: 'DOA' },
  { key: 'SKIP_ADDITIONAL', label: 'Skip Additional Approver', verb: 'SKIP', targetLevel: 'ADDITIONAL_APPROVER' },
  { key: 'SKIP_EXCEPTION', label: 'Skip Exception Approver', verb: 'SKIP', targetLevel: 'EXCEPTION' },
  { key: 'SKIP_PROVOST', label: 'Skip Provost', verb: 'SKIP', targetLevel: 'PROVOST' },
  { key: 'ADD_RO', label: 'Add RO', verb: 'ADD', targetLevel: 'RO', resolver: 'RELATIONSHIP', ref: 'RO', resolverLabel: 'RO of traveller from Workday' },
  { key: 'ADD_DOA', label: 'Add DOA', verb: 'ADD', targetLevel: 'DOA', resolver: 'BAND_DOA', resolverLabel: 'DOA of highest-charging dept by amount band' },
  { key: 'ADD_EXCEPTION', label: 'Add Exception Approver', verb: 'ADD', targetLevel: 'EXCEPTION', resolver: 'ROLE', ref: 'EXCEPTION_APPROVER', resolverLabel: 'All users with Exception Approver role' },
  { key: 'ADD_PROVOST', label: 'Add Provost', verb: 'ADD', targetLevel: 'PROVOST', resolver: 'RELATIONSHIP', ref: 'PROVOST', resolverLabel: 'Selected Provost (host school)' },
  { key: 'ADD_ADDITIONAL', label: 'Add Additional Approver', verb: 'ADD', targetLevel: 'ADDITIONAL_APPROVER', resolver: 'FIXED', ref: 'ADDITIONAL', resolverLabel: 'Requestor-selected additional approver' },
  { key: 'REPLACE_RO', label: 'Replace RO', verb: 'REPLACE', targetLevel: 'RO', needsApprover: true },
  { key: 'REPLACE_DOA', label: 'Replace DOA', verb: 'REPLACE', targetLevel: 'DOA', needsApprover: true },
  { key: 'REPLACE_DOA_SELF', label: 'Replace DOA with traveller (PI self-approval)', verb: 'REPLACE', targetLevel: 'DOA', resolver: 'SELF', resolverLabel: 'Traveller (research PI self-approval)' },
];
const commandKeyOf = (a: DecisionAction): string => {
  if (a.verb === 'SKIP') return COMMANDS.find((c) => c.verb === 'SKIP' && c.targetLevel === a.targetLevel)?.key ?? '';
  const exact = COMMANDS.find((c) => c.verb === a.verb && c.targetLevel === a.targetLevel && (c.resolver ?? '') === (a.resolver ?? '') && (c.ref ?? '') === (a.ref ?? ''));
  if (exact) return exact.key;
  if (a.verb === 'REPLACE') return COMMANDS.find((c) => c.verb === 'REPLACE' && c.targetLevel === a.targetLevel && c.needsApprover)?.key ?? '';
  return COMMANDS.find((c) => c.verb === a.verb && c.targetLevel === a.targetLevel)?.key ?? '';
};

// ECS-style resolver options → {resolver, ref, label}.
const RESOLVERS: { key: string; label: string; resolver: ResolverType; ref?: string }[] = [
  { key: 'RO_WORKDAY', label: 'RO of traveller from Workday', resolver: 'RELATIONSHIP', ref: 'RO' },
  { key: 'BAND_DOA', label: 'DOA of highest-charging dept by amount band', resolver: 'BAND_DOA' },
  { key: 'EXC_ROLE', label: 'All users with Exception Approver role', resolver: 'ROLE', ref: 'EXCEPTION_APPROVER' },
  { key: 'PROVOST', label: 'Selected Provost (host school)', resolver: 'RELATIONSHIP', ref: 'PROVOST' },
  { key: 'ADDITIONAL', label: 'Requestor-selected additional approver', resolver: 'FIXED', ref: 'ADDITIONAL' },
  { key: 'SELF', label: 'Traveller (research PI self-approval)', resolver: 'SELF' },
  { key: 'SPECIFIC', label: 'Specific named approver only', resolver: 'FIXED' },
];
const resolverKey = (resolver?: ResolverType, ref?: string) => RESOLVERS.find((r) => r.resolver === resolver && (r.ref ?? '') === (ref ?? ''))?.key ?? (resolver === 'FIXED' && !ref ? 'SPECIFIC' : '');

export function WorkflowEditor({ initial, facts, canEdit, action }: {
  initial: WorkflowScenario;
  facts: FactDef[];
  canEdit: boolean;
  action: (json: string) => Promise<void>;
}) {
  const [s, setS] = useState<WorkflowScenario>(initial);
  const [pending, start] = useTransition();
  const [saved, setSaved] = useState(false);
  const dis = !canEdit || pending;
  const fieldOf = (k: string) => facts.find((f) => f.key === k);

  // ---- tiers ----
  const setTier = (i: number, patch: Partial<ApprovalTier>) => setS((v) => ({ ...v, tiers: v.tiers.map((t, j) => j === i ? { ...t, ...patch } : t) }));
  const setLevel = (ti: number, li: number, patch: Partial<ApprovingLevel>) => setTier(ti, { levels: s.tiers[ti].levels.map((l, j) => j === li ? { ...l, ...patch } : l) });
  const addTier = () => setS((v) => ({ ...v, tiers: [...v.tiers, { seq: v.tiers.length + 1, amountFrom: 0, amountTo: null, levels: [{ seq: 1, level: 'DOA', resolver: 'BAND_DOA', resolverLabel: 'DOA of highest-charging dept by amount band' }] }] }));
  const delTier = (i: number) => setS((v) => ({ ...v, tiers: v.tiers.filter((_, j) => j !== i) }));
  const addLevel = (ti: number) => setTier(ti, { levels: [...s.tiers[ti].levels, { seq: s.tiers[ti].levels.length + 1, level: 'RO', resolver: 'RELATIONSHIP', ref: 'RO', resolverLabel: 'RO of traveller from Workday' }] });
  const delLevel = (ti: number, li: number) => setTier(ti, { levels: s.tiers[ti].levels.filter((_, j) => j !== li) });
  const setLevelResolver = (ti: number, li: number, key: string) => { const r = RESOLVERS.find((x) => x.key === key); if (r) setLevel(ti, li, { resolver: r.resolver, ref: r.ref, resolverLabel: r.label }); };

  // ---- decision points ----
  const setDp = (i: number, patch: Partial<DecisionPoint>) => setS((v) => ({ ...v, decisionPoints: v.decisionPoints.map((d, j) => j === i ? { ...d, ...patch } : d) }));
  const setCond = (di: number, ci: number, patch: Partial<Condition>) => setDp(di, { conditions: s.decisionPoints[di].conditions.map((c, j) => j === ci ? { ...c, ...patch } : c) });
  const setAct = (di: number, ai: number, patch: Partial<DecisionAction>) => setDp(di, { actions: s.decisionPoints[di].actions.map((a, j) => j === ai ? { ...a, ...patch } : a) });
  const addDp = () => setS((v) => ({ ...v, decisionPoints: [...v.decisionPoints, { seq: v.decisionPoints.length + 1, label: 'New decision point', conditions: [{ fact: facts[0].key, op: 'is', value: true }], actions: [{ verb: 'SKIP', targetLevel: 'RO' }] }] }));
  const delDp = (i: number) => setS((v) => ({ ...v, decisionPoints: v.decisionPoints.filter((_, j) => j !== i) }));
  const addCond = (di: number) => setDp(di, { conditions: [...s.decisionPoints[di].conditions, { fact: facts[0].key, op: 'is', value: true }] });
  const delCond = (di: number, ci: number) => setDp(di, { conditions: s.decisionPoints[di].conditions.filter((_, j) => j !== ci) });
  const addAct = (di: number) => setDp(di, { actions: [...s.decisionPoints[di].actions, { verb: 'ADD', targetLevel: 'DOA', resolver: 'BAND_DOA', resolverLabel: 'DOA of highest-charging dept by amount band' }] });
  const delAct = (di: number, ai: number) => setDp(di, { actions: s.decisionPoints[di].actions.filter((_, j) => j !== ai) });
  const applyCommand = (di: number, ai: number, key: string) => {
    const c = COMMANDS.find((x) => x.key === key); if (!c) return;
    setAct(di, ai, { verb: c.verb, targetLevel: c.targetLevel, resolver: c.resolver, ref: c.ref, resolverLabel: c.resolverLabel, approverId: c.needsApprover ? (s.decisionPoints[di].actions[ai].approverId ?? '') : undefined });
  };

  const coerce = (fieldKey: string, op: Cmp, raw: string): Condition['value'] => {
    const f = fieldOf(fieldKey);
    if (op === 'is') return raw === 'true';
    if (op === 'between') { const [a, b] = raw.split(',').map((x) => Number(x.trim())); return [a || 0, b || 0]; }
    if (op === 'in') return raw.split(',').map((x) => x.trim()).filter(Boolean);
    if (f?.type === 'number') return Number(raw);
    return raw;
  };
  const valInput = (v: Condition['value']): string => (v && typeof v === 'object' && 'fact' in v) ? '' : Array.isArray(v) ? v.join(', ') : String(v ?? '');

  const save = () => { setSaved(false); start(async () => { await action(JSON.stringify(s)); setSaved(true); }); };

  return (
    <div className="space-y-5">
      {/* Workflow details */}
      <div className="card p-4">
        <h3 className="font-semibold text-[var(--ecs-navy)] mb-3">Workflow details</h3>
        <div className="grid md:grid-cols-4 gap-4 items-end">
          <div className="md:col-span-2"><label className="label">Workflow Name</label><input className="field" disabled={dis} value={s.name} onChange={(e) => setS({ ...s, name: e.target.value })} /></div>
          <div><label className="label">Effective Start Date</label><input type="date" className="field" disabled={dis} value={s.effectiveFrom} onChange={(e) => setS({ ...s, effectiveFrom: e.target.value })} /></div>
          <div><label className="label">Effective End Date</label><input type="date" className="field" disabled={dis} value={s.effectiveTo} onChange={(e) => setS({ ...s, effectiveTo: e.target.value })} /></div>
          <label className="flex items-center gap-2 text-sm font-semibold text-[var(--ecs-navy)]"><input type="checkbox" className="w-4 h-4" disabled={dis} checked={s.enabled} onChange={(e) => setS({ ...s, enabled: e.target.checked })} /> Enable This Rule</label>
        </div>
      </div>

      {/* Approval tiers */}
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-[var(--ecs-navy)]">Approval tiers</h3>
        {canEdit && <button type="button" className="btn-secondary text-xs" onClick={addTier}>＋ Add approval tier</button>}
      </div>
      {s.tiers.map((tier, ti) => (
        <div key={ti} className="card p-4">
          <div className="flex items-center justify-between mb-2"><h4 className="font-semibold text-[var(--ecs-navy)]">Approval tier {ti + 1}</h4>{canEdit && s.tiers.length > 1 && <button type="button" className="btn-ghost text-xs" onClick={() => delTier(ti)}>Delete tier</button>}</div>
          <div className="flex items-center gap-2 text-sm mb-3">
            <span className="text-[var(--ecs-navy-2)] font-semibold">Rule — total expense amount from</span>
            <input type="number" step="any" className="field w-32" disabled={dis} value={tier.amountFrom} onChange={(e) => setTier(ti, { amountFrom: Number(e.target.value) })} />
            <span>to</span>
            <input type="number" step="any" className="field w-32" disabled={dis} placeholder="∞" value={tier.amountTo ?? ''} onChange={(e) => setTier(ti, { amountTo: e.target.value === '' ? null : Number(e.target.value) })} />
          </div>
          <p className="text-xs font-semibold text-[var(--ecs-navy-2)] mb-1">Workflow — approving levels</p>
          <div className="grid grid-cols-12 gap-2 text-[11px] font-semibold text-[var(--ecs-muted)] mb-1">
            <div className="col-span-3">Approving Level</div><div className="col-span-5">Resolved by</div><div className="col-span-3">Approver</div><div className="col-span-1"></div>
          </div>
          <div className="space-y-2">
            {tier.levels.map((l, li) => (
              <div key={li} className="grid grid-cols-12 gap-2 items-center">
                <select className="field col-span-3" disabled={dis} value={l.level} onChange={(e) => setLevel(ti, li, { level: e.target.value })}>{ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}</select>
                <select className="field col-span-5" disabled={dis} value={resolverKey(l.resolver, l.ref)} onChange={(e) => setLevelResolver(ti, li, e.target.value)}>{RESOLVERS.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}</select>
                <input className="field col-span-3" disabled={dis} value={l.approverId ?? ''} placeholder="Approver (optional id)" onChange={(e) => setLevel(ti, li, { approverId: e.target.value || undefined })} />
                <div className="col-span-1 text-right">{canEdit && tier.levels.length > 1 && <button type="button" className="btn-ghost text-xs" onClick={() => delLevel(ti, li)}>✕</button>}</div>
              </div>
            ))}
          </div>
          {canEdit && <button type="button" className="btn-secondary text-xs mt-2" onClick={() => addLevel(ti)}>＋ Add approver</button>}
        </div>
      ))}

      {/* Decision points */}
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-[var(--ecs-navy)]">Decision points</h3>
        {canEdit && <button type="button" className="btn-secondary text-xs" onClick={addDp}>＋ Add decision point</button>}
      </div>
      <p className="text-xs text-[var(--ecs-muted)] -mt-3">Decision points are evaluated <strong>independently (OR)</strong> — each one&apos;s action(s) apply whenever <strong>all</strong> of its own conditions hold (AND). Use a separate decision point for each alternative (e.g. two <em>Skip RO</em> points for two different situations).</p>
      {s.decisionPoints.map((dp, di) => (
        <div key={di} className="card p-4">
          <div className="flex items-center justify-between mb-2">
            <input className="field w-96 font-semibold" disabled={dis} value={dp.label ?? ''} placeholder={`Decision point ${di + 1}`} onChange={(e) => setDp(di, { label: e.target.value })} />
            {canEdit && <button type="button" className="btn-ghost text-xs" onClick={() => delDp(di)}>Delete</button>}
          </div>
          <p className="text-xs font-semibold text-[var(--ecs-navy-2)] mb-1">Condition(s) — all must hold</p>
          <div className="grid grid-cols-12 gap-2 text-[11px] font-semibold text-[var(--ecs-muted)] mb-1">
            <div className="col-span-4">Field</div><div className="col-span-2">Operator</div><div className="col-span-5">Value</div><div className="col-span-1"></div>
          </div>
          <div className="space-y-2">
            {dp.conditions.map((c, ci) => {
              const f = fieldOf(c.fact); const ops = OPS_BY_TYPE[f?.type ?? 'bool'] ?? ['is'];
              return (
                <div key={ci} className="grid grid-cols-12 gap-2 items-center">
                  <select className="field col-span-4" disabled={dis} value={c.fact} onChange={(e) => setCond(di, ci, { fact: e.target.value })}>{facts.map((fl) => <option key={fl.key} value={fl.key}>{fl.label}</option>)}</select>
                  <select className="field col-span-2" disabled={dis} value={c.op} onChange={(e) => setCond(di, ci, { op: e.target.value as Cmp })}>{ops.map((o) => <option key={o} value={o}>{OP_LABEL[o]}</option>)}</select>
                  <div className="col-span-5">
                    {c.op === 'is' ? (
                      <select className="field" disabled={dis} value={String(c.value)} onChange={(e) => setCond(di, ci, { value: e.target.value === 'true' })}><option value="true">Yes</option><option value="false">No</option></select>
                    ) : f?.type === 'enum' && c.op !== 'in' ? (
                      <select className="field" disabled={dis} value={String(c.value ?? '')} onChange={(e) => setCond(di, ci, { value: e.target.value })}><option value="">Select…</option>{f.values?.map((v) => <option key={v} value={v}>{v}</option>)}</select>
                    ) : (
                      <input className="field" disabled={dis} value={valInput(c.value)} placeholder={f?.type === 'number' ? 'number' : 'value'} onChange={(e) => setCond(di, ci, { value: coerce(c.fact, c.op, e.target.value) })} />
                    )}
                  </div>
                  <div className="col-span-1 text-right">{canEdit && dp.conditions.length > 1 && <button type="button" className="btn-ghost text-xs" onClick={() => delCond(di, ci)}>✕</button>}</div>
                </div>
              );
            })}
          </div>
          {canEdit && <button type="button" className="btn-secondary text-xs mt-2" onClick={() => addCond(di)}>＋ Add condition</button>}

          <p className="text-xs font-semibold text-[var(--ecs-navy-2)] mt-4 mb-1">Action(s)</p>
          <div className="grid grid-cols-12 gap-2 text-[11px] font-semibold text-[var(--ecs-muted)] mb-1">
            <div className="col-span-5">Action</div><div className="col-span-7"></div>
          </div>
          <div className="space-y-2">
            {dp.actions.map((a, ai) => {
              const cmd = COMMANDS.find((c) => c.key === commandKeyOf(a));
              return (
                <div key={ai} className="grid grid-cols-12 gap-2 items-center">
                  <select className="field col-span-5" disabled={dis} value={commandKeyOf(a)} onChange={(e) => applyCommand(di, ai, e.target.value)}>
                    <optgroup label="Skip">{COMMANDS.filter((c) => c.verb === 'SKIP').map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}</optgroup>
                    <optgroup label="Add">{COMMANDS.filter((c) => c.verb === 'ADD').map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}</optgroup>
                    <optgroup label="Replace">{COMMANDS.filter((c) => c.verb === 'REPLACE').map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}</optgroup>
                  </select>
                  {cmd?.needsApprover ? (
                    <input className="field col-span-6" disabled={dis} value={a.approverId ?? ''} placeholder="Replace with — approver (name or id)" onChange={(e) => setAct(di, ai, { approverId: e.target.value || undefined })} />
                  ) : (
                    <div className="col-span-6 text-xs text-[var(--ecs-muted)] self-center">{cmd?.verb === 'SKIP' ? 'Removes this approver from the route.' : cmd?.resolverLabel ? `Resolved by: ${cmd.resolverLabel}` : ''}</div>
                  )}
                  <div className="col-span-1 text-right">{canEdit && dp.actions.length > 1 && <button type="button" className="btn-ghost text-xs" onClick={() => delAct(di, ai)}>✕</button>}</div>
                </div>
              );
            })}
          </div>
          {canEdit && <button type="button" className="btn-secondary text-xs mt-2" onClick={() => addAct(di)}>＋ Add an action</button>}
        </div>
      ))}

      {canEdit && (
        <div className="flex items-center justify-end gap-3">
          {saved && !pending && <span className="pill-pass">Saved</span>}
          <button type="button" className="btn-primary" disabled={pending} onClick={save}>{pending ? 'Saving…' : 'Save workflow'}</button>
        </div>
      )}
    </div>
  );
}
