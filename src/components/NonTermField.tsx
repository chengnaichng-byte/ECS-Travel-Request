'use client';
// §13.x Non-term research travel — a research-gated dropdown (shown under Booking arrangement on the
// Trip step) replacing the old collapsible card. Selectable only when the trip is research-funded; on
// "Yes" it reveals the inline offline-approval email attach. The value posts as name="nonTerm" (value
// "on") within the Trip form, so saveTrip stores it exactly as before.
import { useState } from 'react';

export function NonTermField({ eligible, declared, attachAction, approvals }: {
  eligible: boolean;
  declared: boolean;
  attachAction: (fd: FormData) => Promise<void>;
  approvals: { id: string; fileName: string; sizeKb: number }[];
}) {
  const [val, setVal] = useState(declared ? 'on' : '');
  const on = eligible && val === 'on';
  return (
    <div className="md:col-span-3">
      <label className="label">Non-term research travel — offline approval (§13.x)</label>
      <select name="nonTerm" value={eligible ? val : ''} disabled={!eligible} onChange={(e) => setVal(e.target.value)}
        className={`field max-w-xl ${!eligible ? 'bg-[var(--ecs-panel)] text-[var(--ecs-muted)] cursor-not-allowed' : ''}`}>
        <option value="">{eligible ? 'Not applicable' : 'Not available — research-funded travel only'}</option>
        {eligible && <option value="on">Yes — this trip is in non-term time and the offline approval has been obtained</option>}
      </select>
      <p className="text-xs text-[var(--ecs-muted)] mt-1">A research-funded trip in <b>non-term time</b> already carries an offline approval, so the pre-trip can be fast-tracked where the workflow allows it. Available only for research-funded travel (the Is-Research flag follows the charging account).</p>
      {on && (
        <div className="mt-2 max-w-xl">
          <label className="label">Offline approval e-mail <span className="text-[var(--ecs-red)]">*</span> — attach the approving e-mail (PDF/PNG/JPEG)</label>
          {approvals.length > 0 ? (
            <ul className="text-xs mb-1 space-y-0.5">
              {approvals.map((a) => <li key={a.id} className="flex items-center gap-2"><span className="pill-pass">Attached</span> {a.fileName} <span className="text-[var(--ecs-muted)]">({a.sizeKb} KB)</span></li>)}
            </ul>
          ) : (
            <p className="text-xs text-[var(--ecs-muted)] mb-1">Attach the approval e-mail that supports this attestation.</p>
          )}
          <div className="flex items-center gap-2">
            <input type="file" name="nonTermEmail" accept="application/pdf,image/png,image/jpeg" className="text-xs" />
            <button formAction={attachAction} className="btn-secondary text-xs">Attach approval e-mail</button>
          </div>
        </div>
      )}
    </div>
  );
}
