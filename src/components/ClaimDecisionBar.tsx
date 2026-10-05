'use client';
// §51 Claim approver controls — Approve / Send Back only (no Reject, mirroring the TR).
import { useState } from 'react';
import { approveClaimStep, sendBackClaim } from '@/modules/te/actions';

export function ClaimDecisionBar({ claimId, roleLabel }: { claimId: string; roleLabel: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex items-center gap-2">
      <form action={approveClaimStep.bind(null, claimId)}>
        <button className="btn inline-flex items-center gap-1.5 px-3.5 py-2 rounded text-sm font-medium text-white" style={{ background: '#059669', borderColor: '#059669' }}>✓ Approve</button>
      </form>
      <button onClick={() => setOpen(true)} className="btn inline-flex items-center gap-1.5 px-3.5 py-2 rounded text-sm font-medium text-white" style={{ background: '#ea6a26', borderColor: '#ea6a26' }}>↩ Send Back</button>
      {open && (
        <div className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center p-4" onClick={() => setOpen(false)}>
          <div className="card w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <div className="card-head">Send claim back for changes</div>
            <form action={sendBackClaim.bind(null, claimId)} className="p-4 space-y-3">
              <p className="text-sm text-[var(--ecs-muted)]">You are acting as {roleLabel}. Provide a reason — it is recorded and shown to the claimant, who can revise and resubmit.</p>
              <textarea name="comment" rows={3} required className="field" placeholder="What needs to change…" />
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setOpen(false)} className="btn-secondary">Cancel</button>
                <button type="submit" className="btn-secondary" style={{ background: '#ea6a26', color: '#fff', borderColor: '#ea6a26' }}>Confirm send back</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
