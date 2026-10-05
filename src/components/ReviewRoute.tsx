'use client';
// §21/§13.14 Approval route — a visual (chevron) preview at the top of the Review page,
// in the same language as the approver's Workflow bar. The traveller SELECTS the approving
// DOA from the eligible candidates (the DOA system may return several; it is never
// pre-selected) and may optionally add one Additional Approver; the chevrons update live.
import { useState } from 'react';

export interface Opt { id: string; name: string; note?: string; title?: string }

export function ReviewRoute({ research, fixedSteps, doaRoleLabel, doaCandidates, additionalCandidates, initialDoa, initialAdditional }: {
  research: boolean;
  fixedSteps: { label: string; name: string }[];   // RO / Funding Owner / Exception etc. (resolved server-side)
  doaRoleLabel: string;
  doaCandidates: Opt[];
  additionalCandidates: Opt[];
  initialDoa: string;
  initialAdditional: string;
}) {
  const [doa, setDoa] = useState(initialDoa);
  const [additional, setAdditional] = useState(initialAdditional);
  const doaName = doaCandidates.find((c) => c.id === doa)?.name;
  const addName = additionalCandidates.find((c) => c.id === additional)?.name;

  const chev = (label: string, sub: string, state: 'done' | 'todo' | 'current') => (
    <div className="flex items-center">
      <span className="chev-conn" />
      <div className={`chev chev-${state}`}><div className="font-semibold">{label}</div>{sub && <div className="opacity-80">{sub}</div>}</div>
    </div>
  );

  return (
    <div className="card p-4">
      <div className="text-xs font-semibold text-[var(--ecs-muted)] mb-2">Approval Route{research && <span className="ml-1 pill-navy">Research</span>}</div>
      <div className="chev-row overflow-x-auto">
        <div className="flex items-center"><div className="chev chev-done"><div className="font-semibold">Traveller</div><div className="opacity-80">submits</div></div></div>
        {addName && chev('Additional Approver', addName, 'todo')}
        {fixedSteps.map((s, i) => chev(s.label, s.name, 'todo'))}
        {chev(doaRoleLabel, doaName ?? 'Select the DOA', doa ? 'todo' : 'current')}
      </div>

      <div className="grid md:grid-cols-2 gap-4 mt-4 border-t border-[var(--ecs-border)] pt-4">
        <div>
          <label className="label" htmlFor="selectedDoaId">Approving {doaRoleLabel} <span className="text-[var(--ecs-red)]">*</span></label>
          <select id="selectedDoaId" name="selectedDoaId" required value={doa} onChange={(e) => setDoa(e.target.value)} className="field">
            <option value="">— select the {doaRoleLabel} —</option>
            {doaCandidates.map((c) => <option key={c.id} value={c.id}>{c.name}{c.note ? ` · ${c.note}` : ''}</option>)}
          </select>
          <p className="text-xs text-[var(--ecs-muted)] mt-1">Pulled from the DOA system for the charging department &amp; amount band (§13.14); choose who approves — it is not pre-selected.</p>
        </div>
        <div>
          <label className="label" htmlFor="additionalApproverId">Additional Approver (optional)</label>
          <select id="additionalApproverId" name="additionalApproverId" value={additional} onChange={(e) => setAdditional(e.target.value)} className="field">
            <option value="">— none —</option>
            {additionalCandidates.map((e) => <option key={e.id} value={e.id}>{e.name}{e.title ? ` — ${e.title}` : ''}</option>)}
          </select>
          <p className="text-xs text-[var(--ecs-muted)] mt-1">Optionally route through one additional approver before the DOA (§23). You cannot select yourself.</p>
        </div>
      </div>
    </div>
  );
}
