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
const ROLE_LABEL: Record<string, string> = { RO: 'Reporting Officer', ADDITIONAL_APPROVER: 'Additional Approver', DOA: 'DOA Approver', RESEARCH_DOA: 'Research DOA', EXCEPTION: 'Exception Approver', PROVOST: 'Provost', FUNDING_OWNER: 'Funding Owner' };

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
  const canAct = !!pendingStep && (pendingStep.approverId === persona || EcsIdentity.hasRole(persona, 'TRAVEL_ADMIN'));
  const exceptions = req.policyChecks.filter((c) => c.outcome === POLICY_OUTCOME.Exception);

  return (
    <>
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h1 className="text-xl font-semibold text-[var(--ecs-navy)] flex items-center gap-2">
          {req.isGroup ? 'Group Travel Request' : isGuestRequest(req) ? 'Guest Travel Request' : 'Travel Request'}
          {req.isGroup && <span className="pill-navy">GROUP</span>}
          {isGuestRequest(req) && <span className="pill-info">GUEST</span>}
          <span className="font-mono text-[var(--ecs-text)]">{req.requestNumber}</span>
        </h1>
        <div className="text-xs text-[var(--ecs-muted)] flex gap-5">
          <div><div className="uppercase tracking-wide">Submitted by</div><div className="text-[var(--ecs-text)]">{EcsIdentity.employee(req.requestorId)?.name}{req.isGroup ? ' (Coordinator)' : ''}</div></div>
          <div><div className="uppercase tracking-wide">Last updated</div><div className="text-[var(--ecs-text)]">{fmtDate(req.updatedAt)}</div></div>
        </div>
      </div>

      {/* Status + decision bar */}
      <div className="card px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-5 flex-wrap">
          <div className="flex items-center gap-2 text-sm"><span className="text-[var(--ecs-muted)]">Approval Status</span> <StatusPill status={req.status} /></div>
          <div className="flex items-center gap-2 text-sm"><span className="text-[var(--ecs-muted)]">Booking Status</span> <span className="pill-info">{req.bookingStatus}</span></div>
          {exceptions.length > 0 && (
            <div className="flex items-center gap-2 text-sm text-[#9a3412]"><span>⚠</span> {req.isGroup ? `${new Set(exceptions.filter((e) => e.travellerId).map((e) => e.travellerId)).size || exceptions.length} Travellers with Exception` : `${exceptions.length} Policy Exception${exceptions.length > 1 ? 's' : ''}`}</div>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {isDraft && <Link href={`/requests/${id}/trip`} className="btn-primary">Continue editing →</Link>}
          {isDraft && req.status === REQUEST_STATUS.SentBack && <form action={reopenDraft.bind(null, id)}><button className="btn-secondary">Reopen as draft</button></form>}
          {(isDraft || isInitialPending) && <form action={withdrawRequest.bind(null, id)}><button className="btn-secondary">Withdraw</button></form>}
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
          <MoreActions id={id} canRecall={isInitialPending || isDraft} canCancel={canCancel} />
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
            Authorised by <strong>{EcsIdentity.employee(req.emergencyAuthoriserId ?? '')?.name ?? '—'}</strong>; the trip may be booked (or already booked) ahead of approval.{' '}
            The <strong>full approval workflow still applies</strong> and is ratified <strong>retrospectively</strong> — the emergency changes the timing of approval, not who approves.{' '}
            {isApproved ? <span className="font-semibold">Ratified ✓</span> : <span className="font-semibold">Ratification {req.status.startsWith('Pending') ? 'in progress' : '—'}.</span>}
          </div>
          {req.emergencyJustification && <div className="mt-1 text-xs italic">&ldquo;{req.emergencyJustification}&rdquo;</div>}
        </div>
      )}

      {isDraft && <Stepper id={id} active="traveller" />}

      <HighRiskAdvisory req={req} />
    </>
  );
}
