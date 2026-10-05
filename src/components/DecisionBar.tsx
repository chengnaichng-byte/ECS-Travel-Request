'use client';
// Approver decision controls for the review page (OpenAI design): Approve / Send Back
// / Reject inline in the status bar, with a reason prompt for send-back and reject.
import { useState } from 'react';
import { approveStep, rejectStep, sendBack } from '@/modules/pretrip/actions';
import { rejectionReasons } from '@/data/rejectionReasons';

export function DecisionBar({ id, roleLabel, amendment, highRisk }: { id: string; roleLabel: string; amendment?: boolean; highRisk?: boolean }) {
  const [mode, setMode] = useState<null | 'sendback' | 'reject' | 'approve'>(null);

  return (
    <div className="flex items-center gap-2">
      {highRisk ? (
        <button onClick={() => setMode('approve')} className="btn inline-flex items-center gap-1.5 px-3.5 py-2 rounded text-sm font-medium text-white" style={{ background: '#059669', borderColor: '#059669' }}>
          <span>✓</span> {amendment ? 'Approve amendment' : 'Approve'}
        </button>
      ) : (
        <form action={approveStep.bind(null, id)}>
          <button className="btn inline-flex items-center gap-1.5 px-3.5 py-2 rounded text-sm font-medium text-white" style={{ background: '#059669', borderColor: '#059669' }}>
            <span>✓</span> {amendment ? 'Approve amendment' : 'Approve'}
          </button>
        </form>
      )}
      <button onClick={() => setMode('sendback')} className="btn inline-flex items-center gap-1.5 px-3.5 py-2 rounded text-sm font-medium text-white" style={{ background: '#ea6a26', borderColor: '#ea6a26' }}>
        <span>↩</span> Send Back
      </button>
      <button onClick={() => setMode('reject')} className="btn inline-flex items-center gap-1.5 px-3.5 py-2 rounded text-sm font-medium text-white" style={{ background: '#dc2626', borderColor: '#dc2626' }}>
        <span>✕</span> Reject
      </button>

      {mode === 'approve' && (
        <div className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center p-4" onClick={() => setMode(null)}>
          <div className="card w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <div className="card-head">Approve high-risk travel (§4.8)</div>
            <form action={approveStep.bind(null, id)} className="p-4 space-y-3">
              <p className="text-sm text-[var(--ecs-muted)]">This request is to a <strong className="text-[var(--ecs-red)]">high-risk destination</strong>. As {roleLabel}, you must acknowledge the travel risk advisory to approve.</p>
              <label className="flex items-start gap-2 text-sm text-red-900 bg-red-50 border border-red-200 rounded p-2">
                <input type="checkbox" name="highRiskAck" value="on" required className="mt-0.5 w-4 h-4" />
                <span>I have reviewed the high-risk travel advisory and acknowledge the associated risks for this trip.</span>
              </label>
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setMode(null)} className="btn-secondary">Cancel</button>
                <button type="submit" className="btn inline-flex items-center gap-1.5 px-3.5 py-2 rounded text-sm font-medium text-white" style={{ background: '#059669', borderColor: '#059669' }}>✓ Acknowledge &amp; approve</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {(mode === 'reject' || mode === 'sendback') && (
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
