// TMC transition — "Select travel booking" dual-path picker (lighter demo build). A claim originates
// one of two ways through the transition window: the NEW path (an approved Pre-Trip TR → the claim is
// created from the TA, which brings in its PNRs) or the LEGACY path (a pre-go-live TMC PNR with no TR,
// picked from the dropdown). The legacy dropdown hides any PNR already consumed by a claim — the
// unified claimed-PNR ledger — so it can't be claimed twice; deleting that claim releases it.
import Link from 'next/link';
import { prisma } from '@/shared/db';
import { listLegacyBookings } from '@/modules/te/pnrLedger';
import { createClaimFromLegacyPnr } from '@/modules/te/actions';
import { fmtSgd } from '@/modules/te/prepopulate';
import { Card, Empty } from '@/components/ui';

export const dynamic = 'force-dynamic';
const d = (x: Date | null) => (x ? x.toISOString().slice(0, 10) : '—');

export default async function TransitionPickerPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const [available, all, approvedToClaim] = await Promise.all([
    listLegacyBookings({ availableOnly: true }),
    listLegacyBookings(),
    prisma.travelRequest.findMany({
      where: { status: 'Approved', claims: { none: {} } },
      select: { id: true, requestNumber: true, authorisationNo: true, destCity: true, startDate: true },
      orderBy: { requestNumber: 'desc' }, take: 6,
    }),
  ]);
  const consumedCount = all.length - available.length;

  return (
    <div className="w-full space-y-5">
      <div className="border-b border-[var(--ecs-border)] pb-3">
        <h1 className="text-xl font-bold text-[var(--ecs-navy)]">Select travel booking <span className="font-normal text-[var(--ecs-muted)]">· TMC transition</span></h1>
        <p className="text-sm text-[var(--ecs-muted)] mt-1">Two claim paths run concurrently through the transition. A trip with an approved Pre-Trip request is claimed from its Travel Authorisation; a pre-go-live booking under the existing TMC is claimed from its PNR.</p>
      </div>

      {error && (
        <div className="card p-3 text-sm bg-amber-50 border-amber-200 text-amber-900">
          {error === 'consumed' ? 'That PNR has already been claimed — it was released from the picker. Pick another.' : 'That PNR could not be found.'}
        </div>
      )}

      <Card title="New path — approved Pre-Trip request (TA-anchored)">
        <p className="text-xs text-[var(--ecs-muted)] mb-3">The claim is created from the approved request; its TMC bookings (PNRs) are brought in under the Travel Authorisation automatically — no PNR picking.</p>
        {approvedToClaim.length === 0 ? <Empty>No approved requests waiting to be claimed.</Empty> : (
          <ul className="divide-y divide-[var(--ecs-border)] text-sm">
            {approvedToClaim.map((r) => (
              <li key={r.id} className="flex items-center gap-3 py-2">
                <span className="font-mono">{r.requestNumber}</span>
                <span className="text-[var(--ecs-muted)]">{r.authorisationNo ?? '—'} · {r.destCity ?? '—'} · {d(r.startDate)}</span>
                <Link href={`/requests/${r.id}/details`} className="btn-ghost text-xs ml-auto">Open request →</Link>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Legacy path — pre-go-live TMC booking (no Pre-Trip TR)">
        <p className="text-xs text-[var(--ecs-muted)] mb-3">
          Pick the PNR to claim. Each is tagged with its TMC source. A PNR already consumed by a claim is hidden from this list (the unified claimed-PNR ledger) so it can&apos;t be claimed twice — deleting that claim releases it.
          {consumedCount > 0 && <span className="ml-1 text-[var(--ecs-muted)]">({consumedCount} already claimed — hidden.)</span>}
        </p>
        {available.length === 0 ? <Empty>No unclaimed legacy PNRs.</Empty> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr>
                <th className="th">PNR</th><th className="th">Traveller</th><th className="th">Route</th>
                <th className="th">Booked</th><th className="th">TMC source</th><th className="th text-right">Amount</th><th className="th"></th>
              </tr></thead>
              <tbody>
                {available.map((b) => (
                  <tr key={b.id} className="hover:bg-[var(--ecs-panel-2)]">
                    <td className="td font-mono">{b.pnr}</td>
                    <td className="td">{b.travellerName}</td>
                    <td className="td">{b.route ?? '—'}</td>
                    <td className="td whitespace-nowrap">{d(b.bookedOn)}</td>
                    <td className="td"><span className="inline-block rounded px-1.5 py-0.5 text-xs bg-[var(--ecs-panel-2)] text-[var(--ecs-muted)]">{b.tmcSource}</span></td>
                    <td className="td text-right">{fmtSgd(b.amountSgd)}</td>
                    <td className="td text-right">
                      <form action={createClaimFromLegacyPnr.bind(null, b.pnr)}>
                        <button className="btn-secondary text-xs">Claim this PNR</button>
                      </form>
                    </td>
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
