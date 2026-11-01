'use client';
// §13.x Non-term research travel — a research-gated attestation checkbox that sits with the Trip-step
// detail checkboxes (below the visa-letter row). Ticking it attests the trip is in non-term time with
// the offline approval obtained; on check it reveals the offline-approval e-mail upload. Research-gated:
// disabled (greyed, not clickable, with a hover tooltip) when the trip is not research-funded. Posts
// name="nonTerm" value="on" within the Trip form, so saveTrip stores it exactly as before.
import { useState } from 'react';

export function NonTermField({ eligible, declared, attachAction, approvals }: {
  eligible: boolean;
  declared: boolean;
  attachAction: (fd: FormData) => Promise<void>;
  approvals: { id: string; fileName: string; sizeKb: number }[];
}) {
  const [checked, setChecked] = useState(declared);
  const on = eligible && checked;
  return (
    <div className="md:col-span-3">
      <label className={`flex items-center gap-2 text-sm ${eligible ? '' : 'text-[var(--ecs-muted)] cursor-not-allowed'}`}
        title={eligible ? undefined : 'Research-funded travel only'}>
        <input type="checkbox" name="nonTerm" value="on" checked={on} disabled={!eligible}
          onChange={(e) => setChecked(e.target.checked)} className="w-4 h-4" />
        <span>This is a <strong>non-term research trip</strong></span>
      </label>
      {on && (
        <div className="mt-2 max-w-xl">
          <label className="label">Upload approval attachment <span className="text-[var(--ecs-red)]">*</span></label>
          {approvals.length > 0 ? (
            <ul className="text-xs mb-1 space-y-0.5">
              {approvals.map((a) => <li key={a.id} className="flex items-center gap-2"><span className="pill-pass">Attached</span> {a.fileName} <span className="text-[var(--ecs-muted)]">({a.sizeKb} KB)</span></li>)}
            </ul>
          ) : null}
          <div className="flex items-center gap-2">
            <input type="file" name="nonTermEmail" accept="application/pdf,image/png,image/jpeg" className="text-xs" />
            <button formAction={attachAction} className="btn-secondary text-xs">Attach approval e-mail</button>
          </div>
        </div>
      )}
    </div>
  );
}
