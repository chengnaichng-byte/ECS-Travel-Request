'use client';
// §6.3 Policy editor — the ECS "Edit Policy Rule" form, runtime-editable. Policy details + ordered
// Policy Rules, each with ANDed Field/Operator/Value conditions and Actions (Show warning / Hard stop
// / Add exception approvers). The whole policy is submitted as JSON to a server action that persists
// it; the configured-policy engine then evaluates it on the next policy run.
import { useState, useTransition } from 'react';
import type { PolicyConfig, PolicyRuleCfg, PolicyAction, PolicyActionType } from '@/config/policyConfigs';
import { POLICY_ACTION_LABEL, POLICY_CATEGORIES, POLICY_COMPANY_CODES } from '@/config/policyConfigs';
import type { PolicyField } from '@/config/policyFields';
import { OPS_FOR_TYPE } from '@/config/policyFields';
import type { Cmp, Condition } from '@/modules/pretrip/workflowRules';
import { OP_LABEL } from '@/modules/pretrip/workflowRules';

type V = Condition['value'];

export function PolicyEditor({ initial, fields, canEdit, action }: {
  initial: PolicyConfig;
  fields: PolicyField[];
  canEdit: boolean;
  action: (json: string) => Promise<void>;
}) {
  const [p, setP] = useState<PolicyConfig>(initial);
  const [pending, start] = useTransition();
  const [saved, setSaved] = useState(false);
  const fieldOf = (key: string) => fields.find((f) => f.key === key);

  const setRule = (i: number, patch: Partial<PolicyRuleCfg>) => setP((s) => ({ ...s, rules: s.rules.map((r, j) => j === i ? { ...r, ...patch } : r) }));
  const setCond = (ri: number, ci: number, patch: Partial<Condition>) => setRule(ri, { conditions: p.rules[ri].conditions.map((c, j) => j === ci ? { ...c, ...patch } : c) });
  const setAction = (ri: number, ai: number, patch: Partial<PolicyAction>) => setRule(ri, { actions: p.rules[ri].actions.map((a, j) => j === ai ? { ...a, ...patch } : a) });

  const addRule = () => setP((s) => ({ ...s, rules: [...s.rules, { seq: s.rules.length + 1, code: `RULE_${Date.now().toString().slice(-5)}`, description: 'New rule', conditions: [{ fact: fields[0].key, op: 'eq', value: '' }], actions: [{ type: 'WARNING', message: '' }] }] }));
  const delRule = (i: number) => setP((s) => ({ ...s, rules: s.rules.filter((_, j) => j !== i) }));
  const addCond = (ri: number) => setRule(ri, { conditions: [...p.rules[ri].conditions, { fact: fields[0].key, op: 'eq', value: '' }] });
  const delCond = (ri: number, ci: number) => setRule(ri, { conditions: p.rules[ri].conditions.filter((_, j) => j !== ci) });
  const addAction = (ri: number) => setRule(ri, { actions: [...p.rules[ri].actions, { type: 'WARNING', message: '' }] });
  const delAction = (ri: number, ai: number) => setRule(ri, { actions: p.rules[ri].actions.filter((_, j) => j !== ai) });

  // Coerce the raw input into the right value type for the field/operator before storing.
  const coerce = (fieldKey: string, op: Cmp, raw: string): V => {
    const f = fieldOf(fieldKey);
    if (op === 'is') return raw === 'true';
    if (op === 'between') { const [a, b] = raw.split(',').map((x) => Number(x.trim())); return [a || 0, b || 0]; }
    if (op === 'in') return raw.split(',').map((x) => x.trim()).filter(Boolean);
    if (f?.type === 'number') return Number(raw);
    return raw;
  };
  const valueToInput = (v: V): string => Array.isArray(v) ? v.join(', ') : String(v ?? '');

  const save = () => { setSaved(false); start(async () => { await action(JSON.stringify(p)); setSaved(true); }); };

  const dis = !canEdit || pending;

  return (
    <div className="space-y-5">
      <div className="card p-4">
        <h3 className="font-semibold text-[var(--ecs-navy)] mb-3">Policy details</h3>
        <div className="grid md:grid-cols-3 gap-4">
          <div><label className="label">Policy Name</label><input className="field" disabled={dis} value={p.name} onChange={(e) => setP({ ...p, name: e.target.value })} /></div>
          <div><label className="label">Policy Category</label>
            <select className="field" disabled={dis} value={p.category} onChange={(e) => setP({ ...p, category: e.target.value })}>{POLICY_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}</select></div>
          <div><label className="label">Company Code</label>
            <select className="field" disabled={dis} value={p.companyCode} onChange={(e) => setP({ ...p, companyCode: e.target.value })}>{POLICY_COMPANY_CODES.map((c) => <option key={c} value={c}>{c}</option>)}</select></div>
          <div><label className="label">Effective Start Date</label><input type="date" className="field" disabled={dis} value={p.effectiveFrom} onChange={(e) => setP({ ...p, effectiveFrom: e.target.value })} /></div>
          <div><label className="label">Effective End Date</label><input type="date" className="field" disabled={dis} value={p.effectiveTo} onChange={(e) => setP({ ...p, effectiveTo: e.target.value })} /></div>
          <label className="flex items-center gap-2 text-sm font-semibold text-[var(--ecs-navy)] pt-6"><input type="checkbox" className="w-4 h-4" disabled={dis} checked={p.enabled} onChange={(e) => setP({ ...p, enabled: e.target.checked })} /> Enable This Policy</label>
        </div>
      </div>

      {p.rules.map((rule, ri) => (
        <div key={ri} className="card p-4">
          <div className="flex items-center justify-between mb-2">
            <h4 className="font-semibold text-[var(--ecs-navy)]">Policy rule {ri + 1}</h4>
            {canEdit && <button type="button" className="btn-ghost text-xs" onClick={() => delRule(ri)}>Delete rule</button>}
          </div>
          <div className="mb-3"><label className="label">Policy Description</label><input className="field" disabled={dis} value={rule.description} onChange={(e) => setRule(ri, { description: e.target.value })} /></div>

          <p className="text-xs font-semibold text-[var(--ecs-navy-2)] mb-1">Rule (all conditions must hold)</p>
          <div className="space-y-2">
            {rule.conditions.map((c, ci) => {
              const f = fieldOf(c.fact);
              const ops = OPS_FOR_TYPE[f?.type ?? 'text'] ?? ['eq'];
              return (
                <div key={ci} className="grid grid-cols-12 gap-2 items-center">
                  <select className="field col-span-4" disabled={dis} value={c.fact} onChange={(e) => setCond(ri, ci, { fact: e.target.value })}>
                    {fields.map((fl) => <option key={fl.key} value={fl.key}>{fl.label}{fl.scope === 'LINE' ? ' (line)' : ''}</option>)}
                  </select>
                  <select className="field col-span-2" disabled={dis} value={c.op} onChange={(e) => setCond(ri, ci, { op: e.target.value as Cmp })}>
                    {ops.map((o) => <option key={o} value={o}>{OP_LABEL[o]}</option>)}
                  </select>
                  <div className="col-span-5">
                    {c.op === 'is' ? (
                      <select className="field" disabled={dis} value={String(c.value)} onChange={(e) => setCond(ri, ci, { value: e.target.value === 'true' })}><option value="true">true</option><option value="false">false</option></select>
                    ) : f?.type === 'enum' && c.op !== 'in' ? (
                      <select className="field" disabled={dis} value={String(c.value ?? '')} onChange={(e) => setCond(ri, ci, { value: e.target.value })}><option value="">Select…</option>{f.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
                    ) : (
                      <input className="field" disabled={dis} value={valueToInput(c.value)} placeholder={c.op === 'between' ? 'min, max' : c.op === 'in' ? 'a, b, c' : f?.type === 'number' ? 'number' : 'value'} onChange={(e) => setCond(ri, ci, { value: coerce(c.fact, c.op, e.target.value) })} />
                    )}
                  </div>
                  <div className="col-span-1 text-right">{canEdit && rule.conditions.length > 1 && <button type="button" className="btn-ghost text-xs" onClick={() => delCond(ri, ci)}>✕</button>}</div>
                </div>
              );
            })}
          </div>
          {canEdit && <button type="button" className="btn-secondary text-xs mt-2" onClick={() => addCond(ri)}>＋ Add condition</button>}

          <p className="text-xs font-semibold text-[var(--ecs-navy-2)] mt-4 mb-1">Action(s) triggered on a detected violation</p>
          <div className="space-y-2">
            {rule.actions.map((a, ai) => (
              <div key={ai} className="grid grid-cols-12 gap-2 items-center">
                <select className="field col-span-3" disabled={dis} value={a.type} onChange={(e) => setAction(ri, ai, { type: e.target.value as PolicyActionType })}>
                  {(Object.keys(POLICY_ACTION_LABEL) as PolicyActionType[]).map((t) => <option key={t} value={t}>{POLICY_ACTION_LABEL[t]}</option>)}
                </select>
                <div className="col-span-8">
                  {a.type === 'EXCEPTION_APPROVERS' ? (
                    <input className="field" disabled={dis} value={(a.approverIds ?? []).join(', ')} placeholder="Exception approver id(s), comma-separated (optional)" onChange={(e) => setAction(ri, ai, { approverIds: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) })} />
                  ) : (
                    <input className="field" disabled={dis || a.type === 'HARD_STOP'} value={a.message ?? ''} placeholder={a.type === 'HARD_STOP' ? '(no message — blocks submission)' : 'Warning / detail message shown to the approver'} onChange={(e) => setAction(ri, ai, { message: e.target.value })} />
                  )}
                </div>
                <div className="col-span-1 text-right">{canEdit && rule.actions.length > 1 && <button type="button" className="btn-ghost text-xs" onClick={() => delAction(ri, ai)}>✕</button>}</div>
              </div>
            ))}
          </div>
          {canEdit && <button type="button" className="btn-secondary text-xs mt-2" onClick={() => addAction(ri)}>＋ Add an action</button>}
        </div>
      ))}

      {canEdit && (
        <div className="flex items-center justify-between">
          <button type="button" className="btn-secondary" onClick={addRule}>＋ Add policy rule</button>
          <div className="flex items-center gap-3">
            {saved && !pending && <span className="pill-pass">Saved</span>}
            <button type="button" className="btn-primary" disabled={pending} onClick={save}>{pending ? 'Saving…' : 'Save policy'}</button>
          </div>
        </div>
      )}
    </div>
  );
}
