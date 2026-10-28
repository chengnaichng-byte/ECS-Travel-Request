'use client';
// §6.2 Workflow simulator — enter a request's FACTS and see the decision trace the engine walks and
// the approval route (approving levels) it resolves. Pure client-side: it runs the same engine the
// server routes with, so "what would approve this?" is answerable without raising a request.
import { useMemo, useState } from 'react';
import { compileScenario, type WorkflowScenario } from '@/config/workflowScenario';
import { resolveRoute, type FactDef, type Ctx, type ScalarValue } from '@/modules/pretrip/workflowRules';

const ROLE_LABEL: Record<string, string> = {
  ADDITIONAL_APPROVER: 'Additional Approver', RO: 'Reporting Officer', FUNDING_OWNER: 'Funding Owner',
  EXCEPTION: 'Exception Approver', PROVOST: 'Provost', DOA: 'DOA', RESEARCH_DOA: 'Research DOA',
};

export function WorkflowSimulator({ scenario, facts, defaults }: { scenario: WorkflowScenario; facts: FactDef[]; defaults: Ctx }) {
  const [ctx, setCtx] = useState<Ctx>(defaults);
  const set = (k: string, v: ScalarValue) => setCtx((c) => ({ ...c, [k]: v }));
  const tree = useMemo(() => compileScenario(scenario), [scenario]);
  const result = useMemo(() => resolveRoute(tree, ctx), [tree, ctx]);

  return (
    <div className="grid lg:grid-cols-2 gap-5">
      <div>
        <h4 className="text-sm font-semibold text-[var(--ecs-navy)] mb-2">Request facts</h4>
        <div className="space-y-2">
          {facts.map((f) => (
            <div key={f.key} className="flex items-center justify-between gap-3 text-sm">
              <label className="text-[var(--ecs-navy-2)]">{f.label}<span className="text-[var(--ecs-muted)] text-xs"> · {f.source}</span></label>
              {f.type === 'bool' ? (
                <input type="checkbox" className="w-4 h-4" checked={Boolean(ctx[f.key])} onChange={(e) => set(f.key, e.target.checked)} />
              ) : f.type === 'number' ? (
                <input type="number" step="any" className="field w-32" value={Number(ctx[f.key] ?? 0)} onChange={(e) => set(f.key, Number(e.target.value))} />
              ) : f.type === 'enum' && f.values ? (
                <select className="field w-44" value={String(ctx[f.key] ?? '')} onChange={(e) => set(f.key, e.target.value)}>
                  {f.values.map((v) => <option key={v} value={v}>{v}</option>)}
                </select>
              ) : (
                <input className="field w-44" value={String(ctx[f.key] ?? '')} onChange={(e) => set(f.key, e.target.value)} />
              )}
            </div>
          ))}
        </div>
      </div>

      <div>
        <h4 className="text-sm font-semibold text-[var(--ecs-navy)] mb-2">Resolved approval route</h4>
        {result.outcome === 'BLOCK' ? (
          <p className="text-sm text-amber-700">Blocked — {result.reason}</p>
        ) : result.steps.length === 0 ? (
          <p className="text-sm text-[var(--ecs-muted)]">No approval step applies to these facts.</p>
        ) : (
          <ol className="space-y-1">
            {result.steps.map((s, i) => (
              <li key={i} className="flex items-center gap-2 text-sm">
                <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-[var(--ecs-navy)] text-white text-[11px]">{i + 1}</span>
                <span className="font-medium">{ROLE_LABEL[s.roleType] ?? s.roleType}</span>
                <span className="pill-info text-[10px]">{s.resolver}{s.ref ? ` · ${s.ref}` : ''}</span>
                {s.note && <span className="text-xs text-[var(--ecs-muted)]">{s.note}</span>}
              </li>
            ))}
          </ol>
        )}

        <h4 className="text-sm font-semibold text-[var(--ecs-navy)] mt-4 mb-2">Decision trace</h4>
        <ol className="space-y-0.5">
          {result.trace.map((t, i) => (
            <li key={i} className="text-xs flex items-start gap-2">
              <span className={t.result ? 'text-emerald-700' : 'text-[var(--ecs-muted)]'}>{t.result ? '✓' : '✗'}</span>
              <span className={t.result ? '' : 'text-[var(--ecs-muted)] line-through'}>{t.text}</span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
