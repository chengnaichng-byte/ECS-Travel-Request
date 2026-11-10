// TR-01 Travel Request Dashboard: the viewer's own drafts, pending actions, upcoming travel,
// approved-unbooked and completed-unclaimed trips. A Travel/System Administrator sees every
// request. The list has live filters (search · type · status); Type shows as S (Standard) / E
// (Emergency: book first, raise later).
import Link from 'next/link';
import { listRequests } from '@/modules/pretrip/queries';
import { EcsReference, EcsIdentity, EcsCharging } from '@/shared/ecs/services';
import { currentPersonaId } from '@/shared/session';
import { canCreateTravelRequest } from '@/modules/pretrip/guards';
import { travellerName } from '@/modules/pretrip/traveller';
import { computeSummary, fmtSgd } from '@/modules/pretrip/pricing';
import { getSettings } from '@/modules/pretrip/settings';
import { PageTitle, Card, Empty } from '@/components/ui';
import { DashboardRequests, type DashRow } from '@/components/DashboardRequests';
import { seedDemoScenarios, seedNonTermResearchDemo, demoIndividualDraft, demoGroupDraft, demoGuestDraft, demoEmergencyDraft, demoM6Draft, demoMultiCityDraft, demoGuestUpgradeDraft, demoClassHotelExceptionDraft, demoPersonalDraft, demoDoaReview, demoComplexDoaReview, demoPersonalDoaReview, demoGroupDoaReview } from '@/modules/pretrip/demo';
import { REQUEST_STATUS, BOOKING_STATUS } from '@/shared/enums';

export const dynamic = 'force-dynamic';
function fmtDate(d: Date | null) { return d ? d.toISOString().slice(0, 10) : '—'; }

export default async function Dashboard({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const [requests, settings, persona, { view }] = await Promise.all([listRequests(), getSettings(), currentPersonaId(), searchParams]);
  const isAdmin = EcsIdentity.hasRole(persona, 'TRAVEL_ADMIN') || EcsIdentity.hasRole(persona, 'SYSTEM_ADMIN');
  const canCreate = canCreateTravelRequest(persona);

  // Scope: a traveller/requestor sees only their own requests; an administrator sees all.
  const scopedAll = isAdmin ? requests : requests.filter((r) =>
    r.requestorId === persona || r.travellerId === persona || r.travellers.some((t) => t.employeeId === persona));

  // §13.22 deep-link from the home status band: ?view=<bucket> filters the list to that next-action bucket.
  const today0 = new Date(); today0.setHours(0, 0, 0, 0);
  const VIEWS: Record<string, { label: string; pred: (r: (typeof scopedAll)[number]) => boolean }> = {
    drafts: { label: 'Drafts to finish', pred: (r) => r.status === REQUEST_STATUS.Draft || r.status === REQUEST_STATUS.SentBack },
    pending: { label: 'Awaiting approval', pred: (r) => r.status.startsWith('Pending') },
    unbooked: { label: 'Approved, not booked', pred: (r) => r.status === REQUEST_STATUS.Approved && r.bookingStatus === BOOKING_STATUS.NotSent },
    toclaim: { label: 'Completed, to claim', pred: (r) => r.status === REQUEST_STATUS.Approved && r.bookingStatus !== BOOKING_STATUS.NotSent && !(r.claims && r.claims.length) },
    upcoming: { label: 'Upcoming trips', pred: (r) => r.status === REQUEST_STATUS.Approved && !!r.startDate && r.startDate >= today0 },
  };
  const activeView = view && VIEWS[view] ? VIEWS[view] : null;
  const scoped = activeView ? scopedAll.filter(activeView.pred) : scopedAll;

  const rows: DashRow[] = scoped.map((r) => {
    const summary = computeSummary(r.expenses as never, settings.approvalAmountBasis);
    return {
      id: r.id, requestNumber: r.requestNumber, type: r.isEmergency ? 'E' : 'S',
      kind: r.travellerType === 'GUEST' ? 'GST' : r.isGroup ? 'GRP' : 'IND',
      groupType: r.groupType as 'STAFF' | 'STUDENT' | 'MIXED' | 'GUEST' | null,
      ba: EcsCharging.code(r.allocations[0]?.chargingCode ?? '')?.businessArea ?? '—',
      traveller: r.groupType === 'STUDENT'
        ? `${r.travellers.length} students`
        : travellerName(r) + (r.isGroup ? ` +${r.travellers.length - 1}` : ''),
      requestor: EcsIdentity.employee(r.requestorId)?.name ?? '—',
      purpose: EcsReference.travelPurpose(r.purposeId ?? '')?.name ?? '—',
      dest: EcsReference.city(r.destCity ?? '')?.name ?? '—',
      dates: `${fmtDate(r.startDate)} → ${fmtDate(r.endDate)}`,
      startSort: r.startDate ? r.startDate.toISOString() : null,   // raw value for date sorting
      ntu: fmtSgd(summary.ntuFunded),
      ntuSort: summary.ntuFunded,                                   // raw value for cost sorting
      exceptions: r.policyChecks.filter((c) => c.outcome === 'EXCEPTION').length,
      status: r.status, bookingStatus: r.bookingStatus,
      // Booking provenance — the TA number and PNR(s) once booked, so the request is findable by either.
      ta: r.authorisationNo,
      pnrs: (r.bookings ?? []).map((b) => b.pnr).filter(Boolean).join(' '),
      // §13.8 the linked TE expense claim (latest), so the TR row shows the full lifecycle TR → TE.
      teClaim: r.claims?.[0] ? { number: r.claims[0].claimNumber, status: r.claims[0].status } : null,
    };
  });

  const buckets = [
    { label: 'Drafts & sent back', value: scopedAll.filter(VIEWS.drafts.pred).length },
    { label: 'Pending approval', value: scopedAll.filter(VIEWS.pending.pred).length },
    { label: 'Approved — unbooked', value: scopedAll.filter(VIEWS.unbooked.pred).length },
    { label: 'Completed — unclaimed', value: scopedAll.filter(VIEWS.toclaim.pred).length },
  ];

  return (
    <div className="w-full">
      <PageTitle id="TR-01" title="Travel Request Dashboard"
        subtitle={isAdmin
          ? 'All travel requests (administrator view) — drafts, pending actions, upcoming travel, approved-unbooked and completed-unclaimed trips.'
          : 'Your travel requests — drafts, pending actions, upcoming travel, approved-unbooked and completed-unclaimed trips.'}
        actions={
          <>
            {requests.length === 0 && <form action={seedDemoScenarios}><button className="btn-secondary">Load demonstration scenarios</button></form>}
            {canCreate && <Link href="/requests/new" className="btn-primary">＋ Create Travel Request</Link>}
          </>
        } />

      {/* Demo-scenario launchers — each seeds a fully pre-filled DRAFT (not submitted) and switches the
          acting persona in one click. The DOA review necessarily opens a submitted request to approve. */}
      {requests.length > 0 && (
        <div className="card p-4 mb-5">
          <div className="text-sm font-semibold text-[var(--ecs-navy)] mb-1">Demo scenarios</div>
          <div className="text-xs text-[var(--ecs-muted)] mb-3">One click seeds a pre-filled draft (ready to submit) and switches you to the right persona. The DOA review opens a submitted request to approve.</div>
          <div className="flex flex-wrap gap-2">
            <form action={demoIndividualDraft}><button className="btn-secondary text-xs" title="Seed a pre-filled individual draft and act as the traveller.">▶ Individual TR · as Dr Alice Tan</button></form>
            <form action={demoMultiCityDraft}><button className="btn-secondary text-xs" title="Seed a pre-filled multi-city individual draft (Dr Jason Lee, Economy) routed SIN → Tokyo → Osaka → Seoul → SIN, with a hotel per stop and ODA per country. Act as the traveller.">▶ Multi-city TR · as Dr Jason Lee</button></form>
            <form action={demoGroupDraft}><button className="btn-secondary text-xs" title="Seed a pre-filled group draft and act as the PA.">▶ Group TR · as Priya Nair (PA)</button></form>
            <form action={demoGuestDraft}><button className="btn-secondary text-xs" title="Seed a pre-filled guest draft and act as the host PA.">▶ Guest TR · as Priya Nair (PA)</button></form>
            <form action={demoGuestUpgradeDraft}><button className="btn-secondary text-xs" title="Seed a guest draft (Prof Daniel Weiss, ETH Zürich) booked in Business above the guest's Economy entitlement — the travel-class upgrade routes to the host-school Provost ahead of the DOA (§8/DD-25). Provost and justification pre-filled. Act as the host PA.">▶ Guest class-upgrade TR · as Priya Nair (PA)</button></form>
            <form action={demoClassHotelExceptionDraft}><button className="btn-secondary text-xs" title="Seed an individual draft (Dr Grace Ho) with TWO exceptions — Business class above her Economy entitlement AND an above-cap hotel flagged as the conference hotel (self-justifying, §4.5). Opens at Review showing both. Act as the traveller.">▶ Class + conference-hotel exceptions · as Dr Grace Ho</button></form>
            <form action={demoPersonalDraft}><button className="btn-secondary text-xs" title="Seed an individual draft (Dr Nadia Rahman) with a personal travel extension — three personal nights added to a four-night Tokyo conference. The personal nights/days are excluded from the NTU-funded hotel and ODA. Act as the traveller.">▶ Personal extension TR · as Dr Nadia Rahman</button></form>
            <form action={demoEmergencyDraft}><button className="btn-secondary text-xs" title="Seed a pre-filled, urgent agent-assisted draft (qualifies for the emergency lane on submit) and act as the traveller.">▶ Emergency TR · as Dr Alice Tan</button></form>
            <form action={demoM6Draft}><button className="btn-secondary text-xs" title="Seed a pre-filled Premium Economy long-haul draft (Dr Alice Tan, policy group C20) — the fare splits into an Economy base plus an M6 differential funded from the BA's M6 account. Act as the traveller.">▶ M6 upgrade TR · as Dr Alice Tan</button></form>
            <form action={seedNonTermResearchDemo}><button className="btn-secondary text-xs" title="Seed a non-term research draft (Dr Henry Ong) with the offline-approval attestation and email attached, and open it at Submit — ready to demonstrate the auto-approve branch.">▶ Non-term research TR · as Dr Henry Ong</button></form>
            <form action={demoDoaReview}><button className="btn-secondary text-xs" title="Open a submitted request at Pending DOA, acting as the assigned DOA, ready to review and approve.">▶ DOA review &amp; approval · as DOA</button></form>
            <form action={demoComplexDoaReview}><button className="btn-secondary text-xs" title="Seed a submitted request at Pending DOA that packs the dense cases onto one Approval Summary — TWO exceptions (Business above entitlement + above-cap conference hotel), a six-way cross-charge split (Cost allocation list scrolls), and a booking deadline ~2 days out (strong-red urgency). Act as the assigned DOA.">▶ DOA review · dense case (2 exceptions · 6-way cross-charge · urgent)</button></form>
            <form action={demoPersonalDoaReview}><button className="btn-secondary text-xs" title="Seed a submitted request at Pending DOA with a personal travel extension (Dr Leon Tan, Seoul + 3 personal nights). The personal portion is excluded from the NTU-funded hotel and ODA. Act as the assigned DOA.">▶ DOA review · personal extension · as DOA</button></form>
            <form action={demoGroupDoaReview}><button className="btn-secondary text-xs" title="Seed a submitted GROUP request at Pending DOA — a three-traveller Tokyo conference on a shared TA (per-traveller airfare, ODA and accommodation; 60/40 cross-charge). Act as the assigned DOA.">▶ DOA review · group booking (3 travellers) · as DOA</button></form>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        {buckets.map((b) => (
          <div key={b.label} className="card p-4">
            <div className="text-3xl font-semibold text-[var(--ecs-navy-2)]">{b.value}</div>
            <div className="text-xs text-[var(--ecs-muted)] mt-1">{b.label}</div>
          </div>
        ))}
      </div>

      {activeView && (
        <div className="card p-3 mb-3 flex items-center justify-between gap-3 text-sm bg-[var(--ecs-panel)]">
          <span className="text-[var(--ecs-navy)]">Showing <strong>{activeView.label}</strong> ({rows.length})</span>
          <Link href="/dashboard" className="btn-ghost text-xs">Clear filter</Link>
        </div>
      )}

      <Card title={`${activeView ? activeView.label : isAdmin ? 'All Travel Requests' : 'My Travel Requests'} (${rows.length})`}>
        {rows.length === 0 ? (
          <Empty>
            {isAdmin
              ? 'No travel requests yet. Create one to start the demonstration.'
              : 'No travel requests of your own yet.'}
            {!isAdmin && <> This dashboard shows <strong>your own</strong> trips — if you&apos;re an approver, requests awaiting your decision are on the <Link href="/approvals" className="underline">RO / DOA Dashboard</Link>.</>}
          </Empty>
        ) : (
          <DashboardRequests rows={rows} />
        )}
      </Card>
    </div>
  );
}
