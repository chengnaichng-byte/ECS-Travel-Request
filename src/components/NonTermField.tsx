'use client';
// §13.x Non-term research travel — the flag is DERIVED from the university teaching calendar, not
// attested: when the travel window lies within the loaded calendar, this shows a read-only derived
// status (non-term time vs term time) with its basis. Only when the window is OUTSIDE the loaded
// calendar does it fall back to a manual attestation checkbox. Research-gated. The approval e-mail is
// still required for the non-term fast-track (belt-and-braces).
import { useRef, useState } from 'react';

function Paperclip() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
    </svg>
  );
}

export function NonTermField({ eligible, declared, derivation, attachAction, removeAction, approvals }: {
  eligible: boolean;
  declared: boolean;
  derivation: { covered: boolean; nonTerm: boolean; basis: string } | null;
  attachAction: (fd: FormData) => Promise<void>;
  removeAction: (attachmentId: string) => Promise<void>;
  approvals: { id: string; fileName: string; sizeKb: number }[];
}) {
  const [checked, setChecked] = useState(declared);
  const fileRef = useRef<HTMLInputElement>(null);
  const submitRef = useRef<HTMLButtonElement>(null);

  if (!eligible) {
    return <div className="md:col-span-3 text-sm text-[var(--ecs-muted)]">Non-term research fast-track — available on research-funded travel only.</div>;
  }

  const covered = !!derivation?.covered;
  const derivedOn = covered && !!derivation?.nonTerm;
  const showAttach = covered ? derivedOn : checked; // email shows when the flag is on (derived or attested)

  return (
    <div className="md:col-span-3 space-y-2">
      {covered ? (
        <div className={`rounded-md border p-3 ${derivedOn ? 'border-[#bfe3cc] bg-[#eef7f1]' : 'border-[var(--ecs-border)] bg-[var(--ecs-panel-2)]'}`}>
          <div className="flex items-center gap-2 flex-wrap">
            {derivedOn ? <span className="pill-pass">Non-term time research trip</span> : <span className="pill-info">Term-time trip</span>}
            <span className="txt-derived text-xs">derived from the academic calendar</span>
          </div>
          <div className="text-xs text-[var(--ecs-muted)] mt-1">{derivation?.basis}</div>
        </div>
      ) : (
        <>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="nonTerm" value="on" checked={checked} onChange={(e) => setChecked(e.target.checked)} className="w-4 h-4" />
            <span>This is a <strong>non-term time research trip</strong></span>
          </label>
          <div className="text-xs text-[var(--ecs-muted)]">{derivation?.basis ?? 'Set the travel dates to derive this automatically.'} Outside the loaded academic calendar — attest manually.</div>
        </>
      )}

      {showAttach && (
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" onClick={() => fileRef.current?.click()}
            className="btn-secondary text-xs inline-flex items-center gap-2 whitespace-nowrap">
            <Paperclip /> Attach approval e-mail
          </button>
          <input ref={fileRef} type="file" name="nonTermEmail" accept="application/pdf,image/png,image/jpeg"
            className="hidden" onChange={(e) => { if (e.target.files?.length) e.target.form?.requestSubmit(submitRef.current ?? undefined); }} />
          <button ref={submitRef} type="submit" formAction={attachAction} className="hidden" aria-hidden tabIndex={-1} />

          {approvals.map((a) => (
            <span key={a.id} className="inline-flex items-center gap-2 rounded-full bg-[color-mix(in_srgb,var(--ecs-green,#16a34a)_12%,transparent)] px-3 py-1 text-xs max-w-full">
              <span className="w-2 h-2 rounded-full bg-[var(--ecs-green,#16a34a)] shrink-0" />
              <span className="font-medium truncate">{a.fileName}</span>
              <span className="text-[var(--ecs-muted)] shrink-0">({a.sizeKb} KB)</span>
              <button type="button" onClick={() => removeAction(a.id)}
                title="Remove attachment" aria-label={`Remove ${a.fileName}`}
                className="shrink-0 text-[var(--ecs-muted)] hover:text-[var(--ecs-red)] leading-none">✕</button>
            </span>
          ))}
          {approvals.length === 0 && <span className="text-xs text-[var(--ecs-red)]">Approval e-mail required for the non-term fast-track.</span>}
        </div>
      )}
    </div>
  );
}
