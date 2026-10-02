// §13.12 RO/DOA Dashboard — reuses the existing approver dashboard, extended with
// Expense Claims (existing) and Travel Requests tabs, each with its own pending
// counter. Here we render the Travel Requests tab for the acting approver.
import Link from 'next/link';
import { prisma } from '@/shared/db';
import { currentPersonaId } from '@/shared/session';
import { getSettings } from '@/modules/pretrip/settings';
import { EcsIdentity, EcsReference, EcsCharging } from '@/shared/ecs/services';
import { computeSummary, fmtSgd } from '@/modules/pretrip/pricing';
import { fullInclude } from '@/modules/pretrip/queries';
import { PageTitle, Card, Empty } from '@/components/ui';
import { StatusPill } from '@/components/StatusPill';
import { REQUEST_STATUS } from '@/shared/enums';

export const dynamic = 'force-dynamic';
function fmtDate(d: Date | null) { return d ? d.toISOString().slice(0, 10) : '—'; }

export default async function Approvals() {
  const persona = await currentPersonaId();
  const settings = await getSettings();
  // Pending approvals include material-amendment reapprovals (§13.14).
  const pending = await prisma.travelRequest.findMany({
    where: { OR: [{ status: { startsWith: 'Pending' } }, { status: REQUEST_STATUS.AmendmentInProgress }] },
    include: fullInclude,
    orderBy: { updatedAt: 'desc' },
  });

  // Requests where the acting persona is the current pending approver.
  const mine = pending.filter((r) => {
    const step = r.approvalSteps.find((s) => s.status === 'Pending');
    return step && (step.approverId === persona || EcsIdentity.hasRole(persona, 'TRAVEL_ADMIN'));
  });
  const sentBack = await prisma.travelRequest.count({ where: { status: 'Sent Back' } });

  return (
    <div className="w-full">
      <PageTitle title="RO / DOA Dashboard"
        subtitle="Pre-trip approvals reuse the existing approver dashboard, extended with Expense Claims and Travel Requests tabs (§13.12)." />

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-[var(--ecs-border)] mb-4">
        <span className="px-4 py-2 text-sm text-[var(--ecs-muted)] border-b-2 border-transparent">Expense Claims <span className="pill-info ml-1">existing</span></span>
        <span className="px-4 py-2 text-sm font-semibold text-[var(--ecs-navy-2)] border-b-2 border-[var(--ecs-navy)]">
          Travel Requests <span className="pill-warn ml-1">{mine.length}</span>
        </span>
      </div>

      <Card title={`Pending your approval (${mine.length}) · Sent back (${sentBack})`}>
        {mine.length === 0 ? (
          <Empty>Nothing pending your approval as {EcsIdentity.employee(persona)?.name}. Switch persona to an approver (e.g. Prof Ben Lim / Prof Carol Wong).</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr>
                <th className="th">Submitted</th><th className="th">Business area</th><th className="th">Request</th>
                <th className="th">Purpose</th><th className="th">Traveller(s)</th><th className="th">Requestor</th>
                <th className="th">Destination</th><th className="th">Dates</th><th className="th text-right">Est. NTU (SGD)</th>
                <th className="th">Exc.</th><th className="th">Status</th><th className="th"></th>
              </tr></thead>
              <tbody>
                {mine.map((r) => {
                  const summary = computeSummary(r.expenses as never, settings.approvalAmountBasis);
                  const ba = EcsCharging.code(r.allocations[0]?.chargingCode ?? '')?.businessArea ?? '—';
                  const exc = r.policyChecks.filter((c) => c.outcome === 'EXCEPTION').length;
                  return (
                    <tr key={r.id} className="hover:bg-[var(--ecs-panel-2)]">
                      <td className="td whitespace-nowrap">{fmtDate(r.versions.at(-1)?.createdAt ?? r.updatedAt)}</td>
                      <td className="td">{ba}</td>
                      <td className="td font-medium">{r.requestNumber}</td>
                      <td className="td">{EcsReference.travelPurpose(r.purposeId ?? '')?.name}</td>
                      <td className="td">{EcsIdentity.employee(r.travellerId)?.name}{r.isGroup ? ` +${r.travellers.length - 1}` : ''}</td>
                      <td className="td">{EcsIdentity.employee(r.requestorId)?.name}</td>
                      <td className="td">{EcsReference.city(r.destCity ?? '')?.name}</td>
                      <td className="td whitespace-nowrap">{fmtDate(r.startDate)} → {fmtDate(r.endDate)}</td>
                      <td className="td text-right">{fmtSgd(summary.ntuFunded)}</td>
                      <td className="td text-center">{exc > 0 ? <span className="pill-exc">{exc}</span> : '—'}</td>
                      <td className="td"><StatusPill status={r.status} /></td>
                      <td className="td"><Link href={`/requests/${r.id}`} className="btn-primary text-xs">Review →</Link></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="text-xs text-[var(--ecs-muted)] mt-3">The bulk Approve action (not shown) excludes requests carrying policy exceptions and all group travel requests, which require individual review (§13.12).</p>
          </div>
        )}
      </Card>
    </div>
  );
}
