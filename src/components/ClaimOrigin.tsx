'use client';
// Unified claim ORIGIN controls, shown on every claim's Travel Booking Details:
//   • "No pre-trip Travel Request (exception)" — for a TR claim it is unchecked + disabled; for a legacy
//     claim checked + disabled; on a claim-side claim it is editable.
//   • "Booking not made on NTU's TRS" — for a TR / legacy claim it is DERIVED + read-only (posted as a
//     hidden field so Save does not clear it); on a claim-side claim it is an editable checkbox.
// On a CLAIM-SIDE claim the Reason + offline-approval-email block appears ONLY while "No pre-trip" is
// checked; unchecking it instead reveals a Travel-Request PICKER — selecting a TR links the claim and
// pre-populates it from that approved TR (it becomes a normal TR claim).
import { useState, type ReactNode } from 'react';

export interface LinkableTr { id: string; label: string }
export interface OriginEvidence { id: string; fileName: string; sizeKb: number; href: string; remove?: (fd: FormData) => void }

export function ClaimOrigin({
  mode, canEdit, trsNotBooked,
  noTrReason = '', evidence = [], exBookingRef = '',
  linkableTrs = [], linkAction,
}: {
  mode: 'tr' | 'legacy' | 'claimSide';
  canEdit: boolean;
  trsNotBooked: boolean;                 // derived (tr/legacy) or stored (claimSide)
  noTrReason?: string;
  evidence?: OriginEvidence[];
  exBookingRef?: string;
  linkableTrs?: LinkableTr[];
  linkAction?: (fd: FormData) => void;   // linkClaimToRequest bound — fired as a button formAction
}) {
  const editable = mode === 'claimSide' && canEdit;
  // "No pre-trip TR": tr → off, legacy/claim-side → on. Only editable on a claim-side claim.
  const [noTr, setNoTr] = useState(mode !== 'tr');
  const showReasonAttach = mode === 'claimSide' && noTr;   // the exception reason + offline-approval email
  const showPicker = mode === 'claimSide' && !noTr;        // unchecked → link an approved TR instead

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-x-8 gap-y-2">
        <label className="flex items-center gap-2 text-sm text-[var(--ecs-navy)]" title={mode === 'tr' ? 'This claim was created from an approved Travel Request.' : 'Tick to raise this as an exception claim with no pre-trip Travel Request; untick to link an approved Travel Request instead.'}>
          <input type="checkbox" checked={noTr} disabled={!editable} onChange={(e) => setNoTr(e.target.checked)} className="w-4 h-4" />
          <span className="font-medium">No pre-trip Travel Request (exception)</span>
        </label>
        <label className="flex items-center gap-2 text-sm" title={editable ? 'The trip may or may not have been booked through NTU’s TRS.' : 'Derived from the booking — not editable.'}>
          {editable
            ? <input type="checkbox" name="trsNotBooked" defaultChecked={trsNotBooked} className="w-4 h-4" />
            : <><input type="checkbox" checked={trsNotBooked} readOnly disabled className="w-4 h-4" /><input type="hidden" name="trsNotBooked" value={trsNotBooked ? 'on' : 'off'} /></>}
          Booking not made on NTU&apos;s Travel Reservation System (TRS)
          {!editable && <span className="text-[10px] text-[var(--ecs-muted)]">· derived</span>}
        </label>
      </div>

      {showReasonAttach && (
        <div className="grid md:grid-cols-2 gap-4">
          <div>
            <label className="label text-amber-800">Reason for no Travel Request <span className="text-[var(--ecs-red)]">* required</span></label>
            <textarea name="noTrReason" defaultValue={noTrReason} disabled={!canEdit} rows={4} className="field" placeholder="Why was this trip not raised as a pre-trip Travel Request? (e.g. emergency / short-notice travel)" />
          </div>
          <div>
            <label className="label text-amber-800">Offline approval email <span className="text-[var(--ecs-red)]">* required</span></label>
            {evidence.length > 0 ? (
              <ul className="space-y-1 mb-2">
                {evidence.map((a) => (
                  <li key={a.id} className="flex items-center gap-2 text-sm rounded border border-[var(--ecs-border)] bg-white px-2 py-1">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-[var(--ecs-muted)] shrink-0"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" /></svg>
                    <a href={a.href} target="_blank" rel="noreferrer" className="text-[var(--ecs-navy)] hover:underline truncate">{a.fileName}</a>
                    <span className="text-xs text-[var(--ecs-muted)] shrink-0">{a.sizeKb} KB</span>
                    {canEdit && a.remove && <button formAction={a.remove} title="Remove attachment" className="ml-auto text-[var(--ecs-red)] hover:bg-red-50 rounded px-1 shrink-0">✕</button>}
                  </li>
                ))}
              </ul>
            ) : <p className="text-xs text-[var(--ecs-red)] mb-2">No file attached yet — required before the claim can be submitted.</p>}
            {canEdit && <input type="file" name="offlineApprovalFile" className="block w-full text-sm text-[var(--ecs-muted)] file:mr-3 file:rounded file:border-0 file:bg-[var(--ecs-navy)] file:text-white file:px-3 file:py-1.5 file:text-sm hover:file:opacity-90" />}
            <p className="text-[10px] text-[var(--ecs-muted)] mt-1">The email/letter approving this trip offline (there was no pre-trip Travel Request). Added when you click <b>Save draft</b>.</p>
          </div>
        </div>
      )}

      {/* Linking an approved TR (once "No pre-trip" is unticked). The free-text booking reference itself
          lives in the Travel Booking Details grid below, matching the TR-claim layout. */}
      {showPicker && (
        <div>
          <label className="label">Link an approved Travel Request <span className="text-[var(--ecs-muted)] font-normal">— pre-populate this claim from it</span></label>
          {linkableTrs.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2">
              <select name="linkRequestId" defaultValue="" disabled={!canEdit} className="field max-w-md">
                <option value="" disabled>Select an approved Travel Request…</option>
                {linkableTrs.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
              </select>
              {canEdit && linkAction && <button type="submit" formAction={linkAction} className="btn-secondary whitespace-nowrap">Link &amp; pre-populate →</button>}
            </div>
          ) : <p className="text-sm text-[var(--ecs-muted)]">No approved Travel Request of yours is available to link.</p>}
          <p className="text-[11px] text-[var(--ecs-muted)] mt-1">Linking replaces the entered items with the Travel Request&apos;s budget lines and clears the exception — the claim becomes a normal TR claim.</p>
        </div>
      )}
    </div>
  );
}

// Convenience wrapper so a view can drop in a labelled sub-heading above the controls.
export function ClaimOriginBlock({ children }: { children: ReactNode }) {
  return <div className="mb-4 pb-4 border-b border-[var(--ecs-border)]">{children}</div>;
}
