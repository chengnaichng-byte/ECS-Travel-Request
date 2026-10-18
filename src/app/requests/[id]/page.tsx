// Request detail = the single review + approve screen (OpenAI design). Variant-aware
// across individual / multi-leg / group. The approver decision (Approve / Send Back /
// Reject) is inline in the status bar; interactive group management (confirmations,
// per-traveller class & sub-itineraries) is in the GroupTravellers workbench below.
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { loadRequest } from '@/modules/pretrip/queries';
import { getSettings } from '@/modules/pretrip/settings';
import { currentPersonaId } from '@/shared/session';
import { EcsIdentity } from '@/shared/ecs/services';
import { isGuestRequest } from '@/modules/pretrip/traveller';
import { isHighRisk } from '@/modules/pretrip/risk';
import { HighRiskAdvisory } from '@/components/HighRiskAdvisory';
import { computeSummary } from '@/modules/pretrip/pricing';
import { REQUEST_STATUS, POLICY_OUTCOME } from '@/shared/enums';
import { Stepper } from '@/components/ui';
import { StatusPill } from '@/components/StatusPill';
import { DecisionBar } from '@/components/DecisionBar';
import { MoreActions } from '@/components/MoreActions';
import { WorkflowChevrons } from '@/components/WorkflowChevrons';
import { ApprovalSummaryCard } from '@/components/ReviewSections';
import { RequestFullDetails } from '@/components/RequestFullDetails';
import { withdrawRequest, reopenDraft, handoffToTmc, markSelfBooked } from '@/modules/pretrip/actions';
import { createClaimFromRequest } from '@/modules/te/actions';

export const dynamic = 'force-dynamic';
const fmtDate = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : '—');

const ROLE_LABEL: Record<string, string> = { RO: 'Reporting Officer', ADDITIONAL_APPROVER: 'Additional Approver', DOA: 'DOA Approver', RESEARCH_DOA: 'Research DOA', EXCEPTION: 'Exception Approver', PROVOST: 'Provost', FUNDING_OWNER: 'Funding Owner' };

export default async function RequestDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const req = await loadRequest(id);
  if (!req) notFound();
  const settings = await getSettings();
  const persona = await currentPersonaId();
  const summary = computeSummary(req.expenses, settings.approvalAmountBasis);

  const isDraft = req.status === REQUEST_STATUS.Draft || req.status === REQUEST_STATUS.SentBack;
  const isAmendment = req.status === REQUEST_STATUS.AmendmentInProgress;
  const isPending = req.status.startsWith('Pending') || isAmendment;
  const isInitialPending = req.status.startsWith('Pending');
  const isApproved = req.status === REQUEST_STATUS.Approved || req.status === REQUEST_STATUS.Closed;
  const canCancel = [REQUEST_STATUS.Approved, REQUEST_STATUS.AmendmentInProgress, REQUEST_STATUS.Expired].includes(req.status as never);
  // §13.x / DD-23 an emergency (non-retrospective) request may book before DOA ratification.
  const emergencyBookFirst = req.isEmergency && !req.isRetrospective && !!req.emergencyAuthoriserId && isPending;

  const pendingStep = req.approvalSteps.find((s) => s.status === 'Pending');
  const canAct = !!pendingStep && (pendingStep.approverId === persona || EcsIdentity.hasRole(persona, 'TRAVEL_ADMIN'));
  const exceptions = req.policyChecks.filter((c) => c.outcome === POLICY_OUTCOME.Exception);

  return (
    <div className="w-full space-y-5">
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
              {req.bookingStatus === 'Not Sent' && <form action={handoffToTmc.bind(null, id)}><button className="btn-secondary">Send to TMC</button></form>}
              {isApproved && req.bookingStatus === 'Not Sent' && settings.selfBookingEnabled && <form action={markSelfBooked.bind(null, id)}><button className="btn-secondary">Self-booked</button></form>}
              <form action={createClaimFromRequest.bind(null, id)}><button className="btn-primary">Create TE claim →</button></form>
            </>
          )}
          {emergencyBookFirst && (
            <>
              <Link href={`/requests/${id}/booking`} className="btn-secondary">Booking →</Link>
              {req.bookingStatus === 'Not Sent' && <form action={handoffToTmc.bind(null, id)}><button className="btn-secondary">Send to TMC (book-first)</button></form>}
            </>
          )}
          <MoreActions id={id} canRecall={isInitialPending || isDraft} canCancel={canCancel} />
        </div>
      </div>

      {/* Workflow — second section, just beneath the approval status. */}
      <WorkflowChevrons req={req} />

      {req.status === REQUEST_STATUS.Rejected && <div className="card p-4 bg-red-50 border-red-200 text-sm text-red-800">This request was rejected. A new request is required (it may be copied below).</div>}
      {isAmendment && <div className="card p-4 bg-amber-50 border-amber-200 text-sm text-amber-800">Under <strong>material-amendment reapproval</strong> (§13.14): the route has been re-derived and restarted; the Travel Authorisation is retained and a new approved version is created on reapproval.</div>}

      {req.isEmergency && (
        <div className="card p-4 bg-amber-50 border-amber-300 text-sm text-amber-900">
          <strong>{req.isRetrospective ? 'Retrospective request' : 'Emergency — book-first'} (DD-23)</strong> — authorised by <strong>{EcsIdentity.employee(req.emergencyAuthoriserId ?? '')?.name ?? '—'}</strong>.{' '}
          {req.isRetrospective
            ? 'Raised after the trip was booked / taken; the route is compressed to a single DOA ratification after the fact.'
            : 'The route is compressed to a single DOA ratification; the booking may be sent to the TMC before that ratification.'}{' '}
          {isApproved ? <span className="font-semibold">DOA-ratified ✓</span> : <span className="font-semibold">DOA ratification {req.status.startsWith('Pending') ? 'pending' : '—'}.</span>}
          {req.emergencyJustification && <div className="mt-1 text-xs italic">“{req.emergencyJustification}”</div>}
        </div>
      )}

      {isDraft && <Stepper id={id} active="traveller" />}

      <HighRiskAdvisory req={req} />

      {/* Non-draft: the Approval Summary is the landing view; the full detail cards live on a
          separate page (reached via "View Full Details" / the tile chevrons). A draft keeps the
          full detail cards inline since the traveller is still reviewing before submission. */}
      {isDraft
        ? <RequestFullDetails req={req} summary={summary} settings={settings} />
        : <ApprovalSummaryCard req={req} summary={summary} bookingDeadlineDays={settings.bookingDeadlineDays} detailsHref={`/requests/${id}/details`} />}
    </div>
  );
}
