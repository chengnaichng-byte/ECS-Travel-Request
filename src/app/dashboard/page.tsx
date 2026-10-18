// TR-01 Travel Request Dashboard: the viewer's own drafts, pending actions, upcoming travel,
// approved-unbooked and completed-unclaimed trips. A Travel/System Administrator sees every
// request. The list has live filters (search · type · status); Type shows as S (Standard) / E
// (Emergency: book first, raise later).
import Link from 'next/link';
import { listRequests } from '@/modules/pretrip/queries';
import { EcsReference, EcsIdentity } from '@/shared/ecs/services';
import { currentPersonaId } from '@/shared/session';
import { travellerName } from '@/modules/pretrip/traveller';
import { computeSummary, fmtSgd } from '@/modules/pretrip/pricing';
import { getSettings } from '@/modules/pretrip/settings';
import { PageTitle, Card, Empty } from '@/components/ui';
import { DashboardRequests, type DashRow } from '@/components/DashboardRequests';
import { seedDemoScenarios } from '@/modules/pretrip/demo';
import { REQUEST_STATUS, BOOKING_STATUS } from '@/shared/enums';

export const dynamic = 'force-dynamic';
function fmtDate(d: Date | null) { return d ? d.toISOString().slice(0, 10) : '—'; }

export default async function Dashboard() {
  const [requests, settings, persona] = await Promise.all([listRequests(), getSettings(), currentPersonaId()]);
  const isAdmin = EcsIdentity.hasRole(persona, 'TRAVEL_ADMIN') || EcsIdentity.hasRole(persona, 'SYSTEM_ADMIN');

  // Scope: a traveller/requestor sees only their own requests; an administrator sees all.
  const scoped = isAdmin ? requests : requests.filter((r) =>
    r.requestorId === persona || r.travellerId === persona || r.travellers.some((t) => t.employeeId === persona));

  const rows: DashRow[] = scoped.map((r) => {
    const summary = computeSummary(r.expenses as never, settings.approvalAmountBasis);
    return {
      id: r.id, requestNumber: r.requestNumber, type: r.isEmergency ? 'E' : 'S',
      traveller: travellerName(r),
      purpose: EcsReference.travelPurpose(r.purposeId ?? '')?.name ?? '—',
      dest: EcsReference.city(r.destCity ?? '')?.name ?? '—',
      dates: `${fmtDate(r.startDate)} → ${fmtDate(r.endDate)}`,
      ntu: fmtSgd(summary.ntuFunded),
      isGroup: r.isGroup, isGuest: r.travellerType === 'GUEST',
      exceptions: r.policyChecks.filter((c) => c.outcome === 'EXCEPTION').length,
      status: r.status, bookingStatus: r.bookingStatus,
    };
  });

  const drafts = scoped.filter((r) => r.status === REQUEST_STATUS.Draft || r.status === REQUEST_STATUS.SentBack);
  const pending = scoped.filter((r) => r.status.startsWith('Pending'));
  const approvedUnbooked = scoped.filter((r) => r.status === REQUEST_STATUS.Approved && r.bookingStatus === BOOKING_STATUS.NotSent);
  const completedUnclaimed = scoped.filter((r) => r.status === REQUEST_STATUS.Approved && r.bookingStatus !== BOOKING_STATUS.NotSent);

  const buckets = [
    { label: 'Drafts & sent back', value: drafts.length },
    { label: 'Pending approval', value: pending.length },
    { label: 'Approved — unbooked', value: approvedUnbooked.length },
    { label: 'Completed — unclaimed', value: completedUnclaimed.length },
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
            <Link href="/requests/new" className="btn-primary">＋ Create Travel Request</Link>
          </>
        } />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        {buckets.map((b) => (
          <div key={b.label} className="card p-4">
            <div className="text-3xl font-semibold text-[var(--ecs-navy-2)]">{b.value}</div>
            <div className="text-xs text-[var(--ecs-muted)] mt-1">{b.label}</div>
          </div>
        ))}
      </div>

      <Card title={`${isAdmin ? 'All Travel Requests' : 'My Travel Requests'} (${rows.length})`}>
        {rows.length === 0 ? (
          <Empty>No travel requests{isAdmin ? ' yet. Create one to start the demonstration.' : ' for you yet. Create one to get started.'}</Empty>
        ) : (
          <DashboardRequests rows={rows} />
        )}
      </Card>
    </div>
  );
}
