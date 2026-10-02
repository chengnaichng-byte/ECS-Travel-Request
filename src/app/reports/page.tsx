// §42 Reporting — operational, financial and compliance views over the travel-request
// population. Read-only aggregation of the same transactional data; no new storage.
import { listRequests } from '@/modules/pretrip/queries';
import { getSettings } from '@/modules/pretrip/settings';
import { computeSummary, fmtSgd } from '@/modules/pretrip/pricing';
import { EcsIdentity, EcsCharging } from '@/shared/ecs/services';
import { REQUEST_STATUS, BOOKING_STATUS, POLICY_OUTCOME } from '@/shared/enums';
import { PageTitle, Card } from '@/components/ui';

export const dynamic = 'force-dynamic';

function Bars({ rows }: { rows: { label: string; value: number; sub?: string }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="space-y-1.5">
      {rows.map((r) => (
        <div key={r.label} className="flex items-center gap-2 text-sm">
          <div className="w-52 shrink-0 truncate">{r.label}</div>
          <div className="flex-1 bg-[var(--ecs-panel-2)] rounded h-5 relative overflow-hidden border border-[var(--ecs-border)]">
            <div className="h-full bg-[var(--ecs-navy)]/80" style={{ width: `${(r.value / max) * 100}%`, background: 'var(--ecs-navy)', opacity: 0.8 }} />
          </div>
          <div className="w-28 text-right tabular-nums">{r.sub ?? r.value}</div>
        </div>
      ))}
    </div>
  );
}

export default async function ReportsPage() {
  const [requests, settings] = await Promise.all([listRequests(), getSettings()]);
  const live = requests.filter((r) => ![REQUEST_STATUS.Rejected, REQUEST_STATUS.Withdrawn, REQUEST_STATUS.Cancelled, REQUEST_STATUS.Draft].includes(r.status as never));
  const ntu = (r: (typeof requests)[number]) => computeSummary(r.expenses as never, settings.approvalAmountBasis).ntuFunded;

  // --- Operational: counts by approval + booking status ---
  const byStatus = new Map<string, number>();
  for (const r of requests) byStatus.set(r.status, (byStatus.get(r.status) ?? 0) + 1);
  const byBooking = new Map<string, number>();
  for (const r of live) byBooking.set(r.bookingStatus, (byBooking.get(r.bookingStatus) ?? 0) + 1);

  // --- Financial: NTU-funded spend committed by business area / charging code / dept ---
  const byBA = new Map<string, number>();
  const byCC = new Map<string, number>();
  const byDept = new Map<string, number>();
  for (const r of live) {
    const amt = ntu(r);
    const allocs = r.allocations.length ? r.allocations : [{ chargingCode: 'UNALLOCATED', businessArea: '—', percent: 100 }];
    for (const a of allocs) {
      const share = amt * (a.percent / 100);
      byBA.set(a.businessArea ?? '—', (byBA.get(a.businessArea ?? '—') ?? 0) + share);
      byCC.set(a.chargingCode, (byCC.get(a.chargingCode) ?? 0) + share);
      const dept = EcsCharging.code(a.chargingCode)?.departmentId ?? r.departmentId ?? '—';
      byDept.set(dept, (byDept.get(dept) ?? 0) + share);
    }
  }
  const totalCommitted = live.reduce((s, r) => s + ntu(r), 0);

  // --- Compliance: exceptions by type, cross-BA, offline, duplicates ---
  const exceptionByLabel = new Map<string, number>();
  let crossBa = 0, offline = 0, duplicates = 0, selfBooked = 0, deviations = 0;
  for (const r of live) {
    for (const c of r.policyChecks) {
      if (c.outcome === POLICY_OUTCOME.Exception) exceptionByLabel.set(c.label, (exceptionByLabel.get(c.label) ?? 0) + 1);
      if (c.code === 'DUPLICATE') duplicates++;
      if (c.code === 'OFFLINE') offline++;
    }
    const bas = new Set(r.allocations.map((a) => a.businessArea).filter(Boolean));
    if (bas.size > 1) crossBa++;
    if (r.bookingStatus === BOOKING_STATUS.SelfBooked) selfBooked++;
  }

  const sortRows = (m: Map<string, number>, money = false) =>
    [...m.entries()].sort((a, b) => b[1] - a[1]).map(([label, value]) => ({ label, value, sub: money ? fmtSgd(value) : String(value) }));
  const deptName = (m: Map<string, number>) =>
    [...m.entries()].sort((a, b) => b[1] - a[1]).map(([id, value]) => ({ label: EcsIdentity.department(id)?.name ?? id, value, sub: fmtSgd(value) }));

  return (
    <div className="w-full space-y-5">
      <PageTitle id="§42 · read-only" title="Travel Reporting"
        subtitle="Operational, financial and compliance views over the request population. Aggregated live from the same data the operational screens use." />

      <Card title="Operational — requests by approval status">
        <Bars rows={sortRows(byStatus)} />
      </Card>

      <div className="grid md:grid-cols-2 gap-5 items-start">
        <Card title="Operational — live bookings by status"><Bars rows={sortRows(byBooking)} /></Card>
        <Card title={`Financial — committed NTU-funded spend (${fmtSgd(totalCommitted)})`}>
          <div className="text-xs text-[var(--ecs-muted)] mb-1">By business area</div>
          <Bars rows={sortRows(byBA, true)} />
          <div className="text-xs text-[var(--ecs-muted)] mb-1 mt-3">By department</div>
          <Bars rows={deptName(byDept)} />
        </Card>
      </div>

      <Card title="Financial — committed spend by charging code">
        <Bars rows={sortRows(byCC, true)} />
      </Card>

      <div className="grid md:grid-cols-2 gap-5 items-start">
        <Card title="Compliance — policy exceptions by type">
          {exceptionByLabel.size === 0 ? <p className="text-sm text-[var(--ecs-muted)] italic">No exceptions in the live population.</p> : <Bars rows={sortRows(exceptionByLabel)} />}
        </Card>
        <Card title="Compliance — flags">
          <table className="w-full text-sm">
            <tbody>
              {[['Cross-business-area requests', crossBa], ['Offline bookings', offline], ['Overlapping-trip warnings', duplicates], ['Self-booked trips', selfBooked], ['Booking deviations', deviations]].map(([k, v]) => (
                <tr key={k as string} className="border-b border-[var(--ecs-border)] last:border-0"><td className="py-1.5">{k}</td><td className="py-1.5 text-right font-medium">{v}</td></tr>
              ))}
            </tbody>
          </table>
          <p className="text-xs text-[var(--ecs-muted)] mt-2">Compliance counts are over live (non-draft, non-terminated) requests.</p>
        </Card>
      </div>
    </div>
  );
}
