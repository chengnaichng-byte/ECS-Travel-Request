'use client';
// §21/§13.14 Approval route. The chevron PREVIEW stays at the TOP of the Review page (orientation, in
// the approver's Workflow-bar language); the DOA / Additional Approver SELECTION sits at the BOTTOM,
// just above Submit — chosen after the traveller has reviewed and accepted the declaration. Both share
// state, so the top preview updates live as the selection changes. The server-rendered review body is
// passed as `children` and rendered between the preview and the selectors.
import { useState } from 'react';

export interface Opt { id: string; name: string; note?: string; title?: string }

export function ReviewRoute({ research, fixedSteps, doaRoleLabel, doaCandidates, additionalCandidates, initialDoa, initialAdditional, children }: {
  research: boolean;
  fixedSteps: { label: string; name: string }[];   // RO / Funding Owner / Exception etc. (resolved server-side)
  doaRoleLabel: string;
  doaCandidates: Opt[];
  additionalCandidates: Opt[];
  initialDoa: string;
  initialAdditional: string;
  children: React.ReactNode;
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
    <>
      {/* Preview — top of the page */}
      <div className="card p-4">
        <div className="text-xs font-semibold text-[var(--ecs-muted)] mb-2">Approval Route{research && <span className="ml-1 pill-navy">Research</span>}</div>
        <div className="chev-row overflow-x-auto">
          <div className="flex items-center"><div className="chev chev-done"><div className="font-semibold">Traveller</div><div className="opacity-80">submits</div></div></div>
          {addName && chev('Additional Approver', addName, 'todo')}
          {fixedSteps.map((s, i) => <div key={i} className="contents">{chev(s.label, s.name, 'todo')}</div>)}
          {chev(doaRoleLabel, doaName ?? 'Select the DOA', doa ? 'todo' : 'current')}
        </div>
      </div>

      {children}

      {/* Selection — just above Submit */}
      <div className="card p-4">
        <div className="text-xs font-semibold text-[var(--ecs-muted)] mb-3">Approver selection</div>
        <div className="grid md:grid-cols-2 gap-4">
          <div>
            <label className="label" htmlFor="selectedDoaId">Approving {doaRoleLabel} <span className="text-[var(--ecs-red)]">*</span></label>
            {/* Not a native `required` — a research-PI self-approval needs no external DOA; the server
                enforces DOA selection otherwise. On the emergency lane this same DOA is the authoriser. */}
            <select id="selectedDoaId" name="selectedDoaId" value={doa} onChange={(e) => setDoa(e.target.value)} className="field">
              <option value="">— select the {doaRoleLabel} —</option>
              {doaCandidates.map((c) => <option key={c.id} value={c.id}>{c.name}{c.note ? ` · ${c.note}` : ''}</option>)}
            </select>
            <p className="text-xs text-[var(--ecs-muted)] mt-1">Derived from the DOA system for the charging department &amp; amount band (§13.14), with self-approval prevention. <strong>Defaulted</strong> when that resolves to one eligible officer (a research PI within the self-approval limit is their own DOA); you <strong>select</strong> only when more than one officer can approve this amount. On the emergency lane this DOA is also the authoriser.</p>
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
    </>
  );
}
