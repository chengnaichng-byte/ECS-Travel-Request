'use client';
// Approver decision controls for the review page (OpenAI design): Approve / Send Back
// / Reject inline in the status bar, with a reason prompt for send-back and reject.
import { useState } from 'react';
import { approveStep, rejectStep, sendBack } from '@/modules/pretrip/actions';
import { rejectionReasons } from '@/data/rejectionReasons';

export function DecisionBar({ id, roleLabel, amendment }: { id: string; roleLabel: string; amendment?: boolean }) {
  const [mode, setMode] = useState<null | 'sendback' | 'reject'>(null);

  return (
    <div className="flex items-center gap-2">
      <form action={approveStep.bind(null, id)}>
        <button className="btn inline-flex items-center gap-1.5 px-3.5 py-2 rounded text-sm font-medium text-white" style={{ background: '#059669', borderColor: '#059669' }}>
          <span>✓</span> {amendment ? 'Approve amendment' : 'Approve'}
        </button>
      </form>
      <button onClick={() => setMode('sendback')} className="btn inline-flex items-center gap-1.5 px-3.5 py-2 rounded text-sm font-medium text-white" style={{ background: '#ea6a26', borderColor: '#ea6a26' }}>
        <span>↩</span> Send Back
      </button>
      <button onClick={() => setMode('reject')} className="btn inline-flex items-center gap-1.5 px-3.5 py-2 rounded text-sm font-medium text-white" style={{ background: '#dc2626', borderColor: '#dc2626' }}>
        <span>✕</span> Reject
      </button>

      {mode && (
        <div className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center p-4" onClick={() => setMode(null)}>
          <div className="card w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <div className="card-head">{mode === 'reject' ? 'Reject request' : 'Send back for changes'}</div>
            <form action={mode === 'reject' ? rejectStep.bind(null, id) : sendBack.bind(null, id)} className="p-4 space-y-3">
              <p className="text-sm text-[var(--ecs-muted)]">You are acting as {roleLabel}. Please provide a reason — it is recorded in the approval history and shown to the requestor.</p>
              {mode === 'reject' && (
                <div>
                  <label className="label" htmlFor="reasonCode">Rejection reason (§26)</label>
                  <select id="reasonCode" name="reasonCode" required className="field" defaultValue="">
                    <option value="" disabled>Select a reason…</option>
                    {rejectionReasons.map((r) => <option key={r.code} value={r.code}>{r.label}</option>)}
                  </select>
                </div>
              )}
              <textarea name="comment" rows={3} required={mode !== 'reject'} className="field" placeholder={mode === 'reject' ? 'Additional comment (optional)…' : 'What needs to change…'} />
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setMode(null)} className="btn-secondary">Cancel</button>
                <button type="submit" className={mode === 'reject' ? 'btn-danger' : 'btn-secondary'} style={mode === 'reject' ? {} : { background: '#ea6a26', color: '#fff', borderColor: '#ea6a26' }}>
                  {mode === 'reject' ? 'Confirm reject' : 'Confirm send back'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
