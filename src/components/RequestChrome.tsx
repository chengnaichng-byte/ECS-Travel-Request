// Shared top chrome for a Travel Request — the request header, the status + decision bar
// (Approve / Send Back / Withdraw / booking / Create claim), the workflow chevrons and the
// status banners. Rendered on BOTH the Approval Summary page and the Full Details page so an
// approver can act from either view.
import Link from 'next/link';
import { EcsIdentity } from '@/shared/ecs/services';
import { isGuestRequest } from '@/modules/pretrip/traveller';
import { isHighRisk } from '@/modules/pretrip/risk';
import { HighRiskAdvisory } from '@/components/HighRiskAdvisory';
import { REQUEST_STATUS, POLICY_OUTCOME } from '@/shared/enums';
import { Stepper } from '@/components/ui';
import { StatusPill } from '@/components/StatusPill';
import { DecisionBar } from '@/components/DecisionBar';
import { MoreActions } from '@/components/MoreActions';
import { WorkflowChevrons } from '@/components/WorkflowChevrons';
import { withdrawRequest, reopenDraft, handoffToTmc, markSelfBooked } from '@/modules/pretrip/actions';
import { createClaimFromRequest } from '@/modules/te/actions';
import type { FullRequest } from '@/modules/pretrip/queries';

const fmtDate = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : '—');
const ROLE_LABEL: Record<string, string> = { RO: 'Reporting Officer', ADDITIONAL_APPROVER: 'Additional Approver', DOA: 'DOA Approver', RESEARCH_DOA: 'Research DOA', EXCEPTION: 'Exception Approver', PROVOST: 'Provost' };

export function RequestChrome({ req, id, persona, settings }: {
  req: FullRequest; id: string; persona: string; settings: { selfBookingEnabled: boolean };
}) {
  const isDraft = req.status === REQUEST_STATUS.Draft || req.status === REQUEST_STATUS.SentBack;
  const isAmendment = req.status === REQUEST_STATUS.AmendmentInProgress;
  const isPending = req.status.startsWith('Pending') || isAmendment;
  const isInitialPending = req.status.startsWith('Pending');
  const isApproved = req.status === REQUEST_STATUS.Approved || req.status === REQUEST_STATUS.Closed;
  const canCancel = [REQUEST_STATUS.Approved, REQUEST_STATUS.AmendmentInProgress, REQUEST_STATUS.Expired].includes(req.status as never);
  const emergencyBookFirst = req.isEmergency && !!req.emergencyAuthoriserId && isPending;

  const pendingStep = req.approvalSteps.find((s) => s.status === 'Pending');
  // Separation of duties: only the step's ASSIGNED approver may approve / send back — no admin
  // bypass. An admin who is also the assigned approver still qualifies via the id match.
  const canAct = !!pendingStep && pendingStep.approverId === persona;
  // Withdraw / Recall are the SUBMITTER's actions — never the approver's. An approver dissents by
  // Send Back, they do not retract someone else's request. Gate to the requestor/traveller (or Travel Admin).
  const canWithdraw = persona === req.requestorId || persona === req.travellerId || EcsIdentity.hasRole(persona, 'TRAVEL_ADMIN');
  const exceptions = req.policyChecks.filter((c) => c.outcome === POLICY_OUTCOME.Exception);

  return (
    <>
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h1 className="text-xl font-semibold text-[var(--ecs-navy)] flex items-center gap-2">
          {req.isGroup ? `${req.groupType === 'STUDENT' ? 'Student ' : req.groupType === 'STAFF' ? 'Staff ' : ''}Group Travel Request` : isGuestRequest(req) ? 'Guest Travel Request' : 'Travel Request'}
          {req.isGroup && <span className="pill-navy">{req.groupType === 'STUDENT' ? 'STUDENT GROUP' : req.groupType === 'STAFF' ? 'STAFF GROUP' : 'GROUP'}</span>}
          {isGuestRequest(req) && <span className="pill-info">GUEST</span>}
          <span className="font-mono text-[var(--ecs-text)]">{req.requestNumber}</span>
        </h1>
        <div className="text-xs text-[var(--ecs-muted)] flex gap-5">
          <div><div className="uppercase tracking-wide">Submitted by</div><div className="text-[var(--ecs-text)]">{EcsIdentity.employee(req.requestorId)?.name}{req.isGroup ? ' (Coordinator)' : ''}</div></div>
          <div><div className="uppercase tracking-wide">Last updated</div><div className="text-[var(--ecs-text)]">{fmtDate(req.updatedAt)}</div></div>
        </div>
      </div>

      {/* Status + decision bar. The action buttons sit on the LEFT of the status information
          (same row), so the decision is the first thing in the bar; the status pills follow to
          its right and wrap below only when the row is too narrow. */}
      <div className="card px-4 py-3 flex items-center gap-x-6 gap-y-3 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          {isDraft && <Link href={`/requests/${id}/trip`} className="btn-primary">Continue editing →</Link>}
          {isDraft && req.status === REQUEST_STATUS.SentBack && <form action={reopenDraft.bind(null, id)}><button className="btn-secondary">Reopen as draft</button></form>}
          {canWithdraw && (isDraft || isInitialPending) && <form action={withdrawRequest.bind(null, id)}><button className="btn-secondary">Withdraw</button></form>}
          {isPending && canAct && <DecisionBar id={id} roleLabel={ROLE_LABEL[pendingStep!.roleType] ?? pendingStep!.roleType} amendment={isAmendment} highRisk={isHighRisk(req)} />}
          {isPending && !canAct && pendingStep && <span className="text-xs text-[var(--ecs-muted)]">Awaiting {ROLE_LABEL[pendingStep.roleType] ?? pendingStep.roleType}: {EcsIdentity.employee(pendingStep.approverId ?? '')?.name ?? '—'}</span>}
          {isApproved && (
            <>
              <Link href={`/requests/${id}/booking`} className="btn-secondary">Booking →</Link>
              {req.bookingStatus === 'Not Sent' && <form action={handoffToTmc.bind(null, id)}><button className="btn-secondary" title="Fallback — the TMC hand-off is sent automatically on final approval">Send to TMC (manual)</button></form>}
              {isApproved && req.bookingStatus === 'Not Sent' && settings.selfBookingEnabled && <form action={markSelfBooked.bind(null, id)}><button className="btn-secondary">Self-booked</button></form>}
              <form action={createClaimFromRequest.bind(null, id)}><button className="btn-primary">Create TE claim →</button></form>
            </>
          )}
          {emergencyBookFirst && (
            <>
              <Link href={`/requests/${id}/booking`} className="btn-secondary">Booking →</Link>
              {req.bookingStatus === 'Not Sent' && <form action={handoffToTmc.bind(null, id)}><button className="btn-secondary" title="Fallback — emergency book-first hand-off is sent automatically on submit">Send to TMC (book-first, manual)</button></form>}
            </>
          )}
          <MoreActions id={id} canRecall={canWithdraw && (isInitialPending || isDraft)} canCancel={canCancel} />
        </div>
        <div className="flex items-center gap-5 flex-wrap">
          <div className="flex items-center gap-2 text-sm"><span className="text-[var(--ecs-muted)]">Approval Status</span> <StatusPill status={req.status} /></div>
          <div className="flex items-center gap-2 text-sm"><span className="text-[var(--ecs-muted)]">Booking Status</span> <span className="pill-info">{req.bookingStatus}</span></div>
          {exceptions.length > 0 && (
            <div className="flex items-center gap-2 text-sm text-[#9a3412]"><span>⚠</span> {req.isGroup ? `${new Set(exceptions.filter((e) => e.travellerId).map((e) => e.travellerId)).size || exceptions.length} Travellers with Exception` : `${exceptions.length} Policy Exception${exceptions.length > 1 ? 's' : ''}`}</div>
          )}
        </div>
      </div>

      {/* Workflow — just beneath the approval status. */}
      <WorkflowChevrons req={req} />

      {req.status === REQUEST_STATUS.Rejected && <div className="card p-4 bg-red-50 border-red-200 text-sm text-red-800">This request was rejected. A new request is required (it may be copied below).</div>}
      {isAmendment && <div className="card p-4 bg-amber-50 border-amber-200 text-sm text-amber-800">Under <strong>material-amendment reapproval</strong> (§13.14): the route has been re-derived and restarted; the Travel Authorisation is retained and a new approved version is created on reapproval.</div>}

      {req.isEmergency && (
        <div className="card p-4 bg-amber-50 border-amber-300 text-sm text-amber-900">
          <div className="flex items-center gap-2 flex-wrap">
            <strong>Emergency — book first, raise later (DD-23)</strong>
            {req.emergencyOutsideWindow && <span className="pill-warn">Outside standard window</span>}
          </div>
          <div className="mt-1">
            {req.emergencyAuthoriserId && <>Authorised by <strong>{EcsIdentity.employee(req.emergencyAuthoriserId)?.name ?? '—'}</strong>. </>}The trip is handed to the TMC <strong>concurrently on submit</strong> and may be booked ahead of approval.{' '}
            The <strong>full approval workflow still applies</strong> and is ratified <strong>retrospectively</strong> — the emergency changes the timing of the booking hand-off, not who approves.
          </div>
          {/* Structured status strip — booking hand-off state, the authorising DOA, and the ratification state. */}
          <div className="mt-3 pt-2 border-t border-amber-300 flex flex-wrap items-center gap-x-6 gap-y-1.5 text-xs">
            <div className="flex items-center gap-1.5"><span className="text-amber-900/70">Booking Status:</span><span className="inline-block px-2 py-0.5 rounded-full bg-amber-100 border border-amber-300 font-medium">{req.bookingStatus}</span></div>
            {req.emergencyAuthoriserId && <div><span className="text-amber-900/70">Authorised By: </span><span className="font-semibold">{EcsIdentity.employee(req.emergencyAuthoriserId)?.name ?? '—'}</span></div>}
            <div><span className="text-amber-900/70">Final Approval: </span><span className="font-semibold">{isApproved ? 'Ratified ✓' : 'DOA ratification pending'}</span></div>
          </div>
        </div>
      )}

      {isDraft && <Stepper id={id} active="traveller" />}

      <HighRiskAdvisory req={req} />
    </>
  );
}
