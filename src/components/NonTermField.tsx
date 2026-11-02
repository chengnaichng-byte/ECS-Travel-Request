'use client';
// §13.x Non-term research travel — a research-gated attestation checkbox that sits with the Trip-step
// detail checkboxes (below the visa-letter row). Ticking it attests the trip is in non-term time with
// the offline approval obtained; on check it reveals a styled "Attach approval e-mail" button and the
// uploaded-file chip, all on one responsive row. Research-gated: disabled (greyed, not clickable, with
// a hover tooltip) when the trip is not research-funded. Posts name="nonTerm" value="on".
import { useRef, useState } from 'react';

function Paperclip() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
    </svg>
  );
}

export function NonTermField({ eligible, declared, attachAction, removeAction, approvals }: {
  eligible: boolean;
  declared: boolean;
  attachAction: (fd: FormData) => Promise<void>;
  removeAction: (attachmentId: string) => Promise<void>;
  approvals: { id: string; fileName: string; sizeKb: number }[];
}) {
  const [checked, setChecked] = useState(declared);
  const fileRef = useRef<HTMLInputElement>(null);
  const submitRef = useRef<HTMLButtonElement>(null);
  const on = eligible && checked;
  return (
    <div className="md:col-span-3">
      <div className="flex flex-wrap items-center gap-3">
        <label className={`flex items-center gap-2 text-sm ${eligible ? '' : 'text-[var(--ecs-muted)] cursor-not-allowed'}`}
          title={eligible ? undefined : 'Research-funded travel only'}>
          <input type="checkbox" name="nonTerm" value="on" checked={on} disabled={!eligible}
            onChange={(e) => setChecked(e.target.checked)} className="w-4 h-4" />
          <span>This is a <strong>non-term time research trip</strong></span>
        </label>

        {on && (
          <>
            {/* Styled trigger — opens the hidden file picker; selecting a file auto-submits the attach
                action. Replaces the raw "Choose File" input so the control stays compact and responsive. */}
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
          </>
        )}
      </div>
    </div>
  );
}
