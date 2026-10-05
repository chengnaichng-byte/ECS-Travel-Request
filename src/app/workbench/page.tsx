// TR-18 Travel Administration Workbench (§4, §8.3). Surfaces the exceptions a Travel
// Administrator manages: approved-unbooked, booking issues/deviations, group
// confirmations awaiting override, amendments in progress, completed-unclaimed and
// expiring authorisations — each with the relevant action.
import Link from 'next/link';
import { prisma } from '@/shared/db';
import { fullInclude, type FullRequest } from '@/modules/pretrip/queries';
import { getSettings } from '@/modules/pretrip/settings';
import { currentPersona } from '@/shared/session';
import { EcsIdentity, EcsReference } from '@/shared/ecs/services';
import { computeSummary, fmtSgd } from '@/modules/pretrip/pricing';
import { REQUEST_STATUS, BOOKING_STATUS, ROLE } from '@/shared/enums';
import { PageTitle, Card, Empty } from '@/components/ui';
import { StatusPill } from '@/components/StatusPill';
import { handoffToTmc, markSelfBooked } from '@/modules/pretrip/actions';
import { closeAsNoClaim, reinstateExpired, runExpirySweep } from '@/modules/pretrip/admin';

export const dynamic = 'force-dynamic';
const fmtDate = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : '—');

function Row({ r, children }: { r: FullRequest; children?: React.ReactNode }) {
  return (
    <tr className="hover:bg-[var(--ecs-panel-2)]">
      <td className="td font-medium whitespace-nowrap"><Link href={`/requests/${r.id}`} className="text-[var(--ecs-navy)] hover:underline">{r.requestNumber}</Link>{r.isGroup && <span className="pill-navy ml-1">Group</span>}</td>
      <td className="td">{EcsIdentity.employee(r.travellerId)?.name}{r.isGroup ? ` +${r.travellers.length - 1}` : ''}</td>
      <td className="td">{EcsReference.city(r.destCity ?? '')?.name ?? '—'}</td>
      <td className="td whitespace-nowrap text-xs">{fmtDate(r.startDate)} → {fmtDate(r.endDate)}</td>
      <td className="td"><StatusPill status={r.status} /></td>
      <td className="td text-right">{children}</td>
    </tr>
  );
}

function Bucket({ title, note, count, children }: { title: string; note: string; count: number; children: React.ReactNode }) {
  return (
    <Card title={`${title} (${count})`}>
      <p className="text-xs text-[var(--ecs-muted)] mb-2">{note}</p>
      {count === 0 ? <Empty>Nothing here.</Empty> : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr><th className="th">Request</th><th className="th">Traveller(s)</th><th className="th">Destination</th><th className="th">Dates</th><th className="th">Status</th><th className="th text-right">Action</th></tr></thead>
            <tbody>{children}</tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

export default async function Workbench() {
  const persona = await currentPersona();
  const settings = await getSettings();
  const isAdmin = persona.roles.includes(ROLE.TravelAdmin) || persona.roles.includes(ROLE.SystemAdmin);
  const all = (await prisma.travelRequest.findMany({ include: fullInclude, orderBy: { updatedAt: 'desc' } })) as FullRequest[];
  const now = new Date();

  const approvedUnbooked = all.filter((r) => r.status === REQUEST_STATUS.Approved && r.bookingStatus === BOOKING_STATUS.NotSent);
  const bookingIssues = all.filter((r) => r.bookingStatus === BOOKING_STATUS.Failed || r.deviations.some((d) => d.material));
  const amendments = all.filter((r) => r.status === REQUEST_STATUS.AmendmentInProgress);
  const completedUnclaimed = all.filter((r) => (r.status === REQUEST_STATUS.Approved || r.status === REQUEST_STATUS.Closed) && r.bookingStatus !== BOOKING_STATUS.NotSent && r.endDate && r.endDate < now && r.teLinks.length === 0);
  const expiring = all.filter((r) => r.status === REQUEST_STATUS.Approved && r.bookingStatus === BOOKING_STATUS.NotSent && r.authorisationExpiry && (r.authorisationExpiry.getTime() - now.getTime()) / 86400000 < 30);
  const expired = all.filter((r) => r.status === REQUEST_STATUS.Expired);

  const tiles = [
    ['Approved — unbooked', approvedUnbooked.length],
    ['Booking issues', bookingIssues.length],
    ['Amendments', amendments.length],
    ['Completed — unclaimed', completedUnclaimed.length],
    ['Expiring / expired', expiring.length + expired.length],
  ] as const;

  return (
    <div className="w-full space-y-5">
      <PageTitle id="TR-18" title="Travel Administration Workbench"
        subtitle="Errors, unmatched bookings, cancellations, completed-unclaimed trips and administrator overrides (§8.3)."
        actions={isAdmin ? <form action={runExpirySweep}><button className="btn-secondary">Run expiry sweep</button></form> : undefined} />

      {!isAdmin && <div className="card p-3 text-sm text-amber-800 bg-amber-50 border-amber-200">Switch persona to <strong>David Kumar — Travel Administrator</strong> to use the override actions.</div>}

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        {tiles.map(([l, v]) => (
          <div key={l} className="card p-4"><div className="text-3xl font-semibold text-[var(--ecs-navy)]">{v}</div><div className="text-xs text-[var(--ecs-muted)] mt-1">{l}</div></div>
        ))}
      </div>

      <Bucket title="Approved — unbooked" count={approvedUnbooked.length} note="Approved requests not yet handed to the TMC. Send to the TMC or record as self-booked.">
        {approvedUnbooked.map((r) => (
          <Row key={r.id} r={r}>
            <div className="inline-flex gap-1 justify-end">
              <form action={handoffToTmc.bind(null, r.id)}><button className="btn-secondary text-xs">Send to TMC</button></form>
              {settings.selfBookingEnabled && <form action={markSelfBooked.bind(null, r.id)}><button className="btn-ghost text-xs">Self-booked</button></form>}
            </div>
          </Row>
        ))}
      </Bucket>

      <Bucket title="Booking issues & deviations" count={bookingIssues.length} note="Failed bookings and material approval-to-booking deviations (§6.4, AC10) needing follow-up.">
        {bookingIssues.map((r) => (
          <Row key={r.id} r={r}>
            <Link href={`/requests/${r.id}/booking`} className="btn-secondary text-xs">Reconcile →</Link>
          </Row>
        ))}
      </Bucket>

      <Bucket title="Amendments in progress" count={amendments.length} note="Requests under material-amendment reapproval (§13.14).">
        {amendments.map((r) => (<Row key={r.id} r={r}><Link href={`/requests/${r.id}`} className="btn-secondary text-xs">Review →</Link></Row>))}
      </Bucket>

      <Bucket title="Completed — unclaimed" count={completedUnclaimed.length} note="Trips whose official return has passed with no linked TE claim. Remind the traveller or close as no-claim.">
        {completedUnclaimed.map((r) => (
          <Row key={r.id} r={r}>
            <div className="inline-flex gap-1 justify-end">
              <Link href={`/requests/${r.id}`} className="btn-ghost text-xs">Open</Link>
              <form action={closeAsNoClaim.bind(null, r.id)}><button className="btn-secondary text-xs" disabled={!isAdmin}>Close (no claim)</button></form>
            </div>
          </Row>
        ))}
      </Bucket>

      <Bucket title="Expiring & expired authorisations" count={expiring.length + expired.length} note="Approved-unbooked requests near or past their validity. Reinstate expired authorisations for reapproval (§13.3).">
        {[...expiring, ...expired].map((r) => (
          <Row key={r.id} r={r}>
            {r.status === REQUEST_STATUS.Expired
              ? <form action={reinstateExpired.bind(null, r.id)}><button className="btn-secondary text-xs" disabled={!isAdmin}>Reinstate</button></form>
              : <span className="text-xs text-[var(--ecs-muted)]">Expires {fmtDate(r.authorisationExpiry)}</span>}
          </Row>
        ))}
      </Bucket>
    </div>
  );
}
