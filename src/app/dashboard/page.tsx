// TR-01 Travel Request Dashboard: drafts, pending actions, upcoming travel,
// approved-unbooked and completed-unclaimed trips.
import Link from 'next/link';
import { listRequests } from '@/modules/pretrip/queries';
import { EcsReference } from '@/shared/ecs/services';
import { travellerName } from '@/modules/pretrip/traveller';
import { computeSummary } from '@/modules/pretrip/pricing';
import { fmtSgd } from '@/modules/pretrip/pricing';
import { getSettings } from '@/modules/pretrip/settings';
import { PageTitle, Card, Empty } from '@/components/ui';
import { StatusPill } from '@/components/StatusPill';
import { seedDemoScenarios } from '@/modules/pretrip/demo';
import { REQUEST_STATUS, BOOKING_STATUS } from '@/shared/enums';

export const dynamic = 'force-dynamic';

function fmtDate(d: Date | null) { return d ? d.toISOString().slice(0, 10) : '—'; }

export default async function Dashboard() {
  const [requests, settings] = await Promise.all([listRequests(), getSettings()]);

  const rows = requests.map((r) => {
    const summary = computeSummary(r.expenses as never, settings.approvalAmountBasis);
    return {
      id: r.id, requestNumber: r.requestNumber, status: r.status, bookingStatus: r.bookingStatus,
      traveller: travellerName(r),
      purpose: EcsReference.travelPurpose(r.purposeId ?? '')?.name ?? '—',
      dest: EcsReference.city(r.destCity ?? '')?.name ?? '—',
      dates: `${fmtDate(r.startDate)} → ${fmtDate(r.endDate)}`,
      ntu: summary.ntuFunded, isGroup: r.isGroup, isGuest: r.travellerType === 'GUEST', exceptions: r.policyChecks.filter((c) => c.outcome === 'EXCEPTION').length,
    };
  });

  const drafts = rows.filter((r) => r.status === REQUEST_STATUS.Draft || r.status === REQUEST_STATUS.SentBack);
  const pending = rows.filter((r) => r.status.startsWith('Pending'));
  const approvedUnbooked = rows.filter((r) => r.status === REQUEST_STATUS.Approved && r.bookingStatus === BOOKING_STATUS.NotSent);
  const upcoming = rows.filter((r) => r.status === REQUEST_STATUS.Approved);
  const completedUnclaimed = rows.filter((r) => r.status === REQUEST_STATUS.Approved && r.bookingStatus !== BOOKING_STATUS.NotSent);

  const buckets = [
    { label: 'Drafts & sent back', value: drafts.length },
    { label: 'Pending approval', value: pending.length },
    { label: 'Approved — unbooked', value: approvedUnbooked.length },
    { label: 'Completed — unclaimed', value: completedUnclaimed.length },
  ];

  return (
    <div className="w-full">
      <PageTitle id="TR-01" title="Travel Request Dashboard"
        subtitle="Drafts, pending actions, upcoming travel, approved-unbooked and completed-unclaimed trips."
        actions={
          <>
            {rows.length === 0 && <form action={seedDemoScenarios}><button className="btn-secondary">Load demonstration scenarios</button></form>}
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

      <Card title={`All Travel Requests (${rows.length})`}>
        {rows.length === 0 ? (
          <Empty>No travel requests yet. Create one to start the demonstration.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr>
                  <th className="th">Request</th><th className="th">Traveller</th><th className="th">Purpose</th>
                  <th className="th">Destination</th><th className="th">Travel dates</th>
                  <th className="th text-right">Est. NTU cost</th><th className="th">Exc.</th>
                  <th className="th">Status</th><th className="th">Booking</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="hover:bg-[var(--ecs-panel-2)]">
                    <td className="td font-medium">
                      <Link href={`/requests/${r.id}`} className="text-[var(--ecs-navy-2)] hover:underline">{r.requestNumber}</Link>
                      {r.isGroup && <span className="pill-navy ml-1">Group</span>}
                    </td>
                    <td className="td">{r.traveller}{r.isGuest && <span className="pill-info ml-1">Guest</span>}</td>
                    <td className="td">{r.purpose}</td>
                    <td className="td">{r.dest}</td>
                    <td className="td whitespace-nowrap">{r.dates}</td>
                    <td className="td text-right whitespace-nowrap">{fmtSgd(r.ntu)}</td>
                    <td className="td text-center">{r.exceptions > 0 ? <span className="pill-exc">{r.exceptions}</span> : '—'}</td>
                    <td className="td"><StatusPill status={r.status} /></td>
                    <td className="td text-xs text-[var(--ecs-muted)]">{r.bookingStatus}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
