// §41/§4 Finance Oversight — a read-only dashboard for the Finance role: the booking
// pipeline, committed spend, cross-charge requests and outstanding policy exceptions.
// Reads the same transactional data as the operational screens; it changes nothing.
import Link from 'next/link';
import { listRequests } from '@/modules/pretrip/queries';
import { getSettings } from '@/modules/pretrip/settings';
import { computeSummary, fmtSgd } from '@/modules/pretrip/pricing';
import { EcsReference, EcsCharging } from '@/shared/ecs/services';
import { travellerName } from '@/modules/pretrip/traveller';
import { REQUEST_STATUS, BOOKING_STATUS, POLICY_OUTCOME } from '@/shared/enums';
import { PageTitle, Card, Empty } from '@/components/ui';
import { StatusPill } from '@/components/StatusPill';

export const dynamic = 'force-dynamic';

export default async function FinancePage() {
  const [requests, settings] = await Promise.all([listRequests(), getSettings()]);
  const live = requests.filter((r) => ![REQUEST_STATUS.Rejected, REQUEST_STATUS.Withdrawn, REQUEST_STATUS.Cancelled, REQUEST_STATUS.Draft].includes(r.status as never));

  const ntu = (r: (typeof requests)[number]) => computeSummary(r.expenses as never, settings.approvalAmountBasis).ntuFunded;

  // Booking pipeline — counts by booking status across live requests.
  const pipelineOrder = [BOOKING_STATUS.NotSent, BOOKING_STATUS.SentToTMC, BOOKING_STATUS.ReceivedByTMC, BOOKING_STATUS.InProgress, BOOKING_STATUS.TravellerActionRequired, BOOKING_STATUS.Booked, BOOKING_STATUS.TravelCompleted, BOOKING_STATUS.SelfBooked, BOOKING_STATUS.Failed];
  const pipeline = pipelineOrder.map((s) => ({ status: s, count: live.filter((r) => r.bookingStatus === s).length })).filter((p) => p.count > 0);

  // Commitments — approved NTU-funded spend not yet booked vs already booked.
  const approved = live.filter((r) => r.status === REQUEST_STATUS.Approved || r.status === REQUEST_STATUS.Closed);
  const committedUnbooked = approved.filter((r) => r.bookingStatus === BOOKING_STATUS.NotSent || r.bookingStatus === BOOKING_STATUS.SentToTMC);
  const booked = live.filter((r) => r.bookingStatus === BOOKING_STATUS.Booked || r.bookingStatus === BOOKING_STATUS.TravelCompleted);
  const sum = (rs: typeof requests) => rs.reduce((s, r) => s + ntu(r), 0);
  const pendingApproval = live.filter((r) => r.status.startsWith('Pending'));

  // Cross-charge — any request spanning >1 business area or using the cross-charge pool.
  const crossCharge = live.filter((r) => {
    const bas = new Set(r.allocations.map((a) => a.businessArea).filter(Boolean));
    return bas.size > 1 || r.allocations.some((a) => EcsCharging.code(a.chargingCode)?.crossCharge);
  });

  // Exceptions — live requests carrying a policy exception.
  const exceptions = live.filter((r) => r.policyChecks.some((c) => c.outcome === POLICY_OUTCOME.Exception));

  const Stat = ({ label, value, sub }: { label: string; value: string; sub?: string }) => (
    <div className="card p-4">
      <div className="text-xs uppercase tracking-wide text-[var(--ecs-muted)]">{label}</div>
      <div className="text-2xl font-semibold text-[var(--ecs-navy)] mt-1">{value}</div>
      {sub && <div className="text-xs text-[var(--ecs-muted)] mt-0.5">{sub}</div>}
    </div>
  );

  return (
    <div className="w-full space-y-5">
      <PageTitle id="§41 · read-only" title="Finance Oversight"
        subtitle="Committed travel spend, the TMC booking pipeline, cross-charge arrangements and outstanding policy exceptions. Read-only — Finance monitors; it does not approve or edit." />

      <div className="grid md:grid-cols-4 gap-4">
        <Stat label="Pending approval" value={String(pendingApproval.length)} sub={fmtSgd(sum(pendingApproval)) + ' NTU-funded'} />
        <Stat label="Approved, awaiting booking" value={String(committedUnbooked.length)} sub={fmtSgd(sum(committedUnbooked)) + ' committed'} />
        <Stat label="Booked / completed" value={String(booked.length)} sub={fmtSgd(sum(booked)) + ' committed'} />
        <Stat label="Open exceptions" value={String(exceptions.length)} />
      </div>

      <div className="grid md:grid-cols-2 gap-5 items-start">
        <Card title="TMC Booking Pipeline">
          {pipeline.length === 0 ? <Empty>No live bookings.</Empty> : (
            <table className="w-full text-sm">
              <tbody>
                {pipeline.map((p) => (
                  <tr key={p.status} className="border-b border-[var(--ecs-border)] last:border-0">
                    <td className="py-1.5"><span className="pill-info">{p.status}</span></td>
                    <td className="py-1.5 text-right font-medium">{p.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        <Card title="Cross-Charge Requests (§18)">
          {crossCharge.length === 0 ? <Empty>No cross-charge requests.</Empty> : (
            <ul className="space-y-2 text-sm">
              {crossCharge.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-2">
                  <Link href={`/requests/${r.id}`} className="font-mono text-[var(--ecs-navy)] hover:underline">{r.requestNumber}</Link>
                  <span className="text-[var(--ecs-muted)] text-xs">{[...new Set(r.allocations.map((a) => a.businessArea).filter(Boolean))].join(' · ')}</span>
                  <span>{fmtSgd(ntu(r))}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card title="Committed Spend (approved & live)">
        {approved.length + pendingApproval.length === 0 ? <Empty>No committed spend.</Empty> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr>
                <th className="th">Request</th><th className="th">Traveller</th><th className="th">Destination</th>
                <th className="th">Approval</th><th className="th">Booking</th><th className="th text-right">NTU-funded</th>
              </tr></thead>
              <tbody>
                {[...pendingApproval, ...approved].map((r) => (
                  <tr key={r.id} className="hover:bg-[var(--ecs-panel-2)]">
                    <td className="td"><Link href={`/requests/${r.id}`} className="font-mono text-[var(--ecs-navy)] hover:underline">{r.requestNumber}</Link></td>
                    <td className="td">{travellerName(r)}</td>
                    <td className="td">{EcsReference.city(r.destCity ?? '')?.name ?? '—'}</td>
                    <td className="td"><StatusPill status={r.status} /></td>
                    <td className="td"><span className="pill-info">{r.bookingStatus}</span></td>
                    <td className="td text-right">{fmtSgd(ntu(r))}</td>
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
