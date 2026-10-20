// §13.12 / DD-24 RO/DOA Dashboard — the existing approver dashboard, extended with two live
// tabs (Travel Requests · Expense Claims), each with its own pending counter for the acting
// approver. Rows carrying a policy exception are emphasised so they stand out. "Review →" opens
// the one-page approver summary (/requests/[id] for a TR, /claims/[id] for a claim).
import Link from 'next/link';
import { prisma } from '@/shared/db';
import { currentPersonaId } from '@/shared/session';
import { getSettings } from '@/modules/pretrip/settings';
import { EcsIdentity, EcsReference, EcsCharging } from '@/shared/ecs/services';
import { computeSummary, fmtSgd } from '@/modules/pretrip/pricing';
import { fullInclude } from '@/modules/pretrip/queries';
import { isApproverPersona } from '@/modules/pretrip/guards';
import { PageTitle, Card, Empty } from '@/components/ui';
import { StatusPill } from '@/components/StatusPill';
import { REQUEST_STATUS } from '@/shared/enums';

export const dynamic = 'force-dynamic';
function fmtDate(d: Date | null) { return d ? d.toISOString().slice(0, 10) : '—'; }

export default async function Approvals({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { tab } = await searchParams;
  const activeTab = tab === 'claims' ? 'claims' : 'requests';

  const persona = await currentPersonaId();
  const settings = await getSettings();
  // Separation of duties (DD-24): this is the APPROVER's dashboard. Only a persona that holds an
  // approver role (RO / DOA / Research DOA / Exception) has access — a Travel/System Administrator
  // is not an approver and sees no actionable queue here (oversight lives under Travel Admin).
  const isApprover = isApproverPersona(persona);

  // --- Travel Requests pending the acting approver (incl. material-amendment reapprovals). ---
  const pendingReqs = await prisma.travelRequest.findMany({
    where: { OR: [{ status: { startsWith: 'Pending' } }, { status: REQUEST_STATUS.AmendmentInProgress }] },
    include: fullInclude,
    orderBy: { updatedAt: 'desc' },
  });
  const mine = pendingReqs.filter((r) => {
    const step = r.approvalSteps.find((s) => s.status === 'Pending');
    return step && step.approverId === persona;
  });
  const sentBack = await prisma.travelRequest.count({ where: { status: 'Sent Back' } });

  // --- Expense Claims pending the acting approver (Verifier / RO / DOA / Exception step). ---
  const pendingClaims = await prisma.travelExpenseClaim.findMany({
    where: { status: { startsWith: 'Pending' } },
    include: { lines: true, approvalSteps: { orderBy: { seq: 'asc' } }, request: { select: { requestNumber: true, destCity: true } } },
    orderBy: { createdAt: 'desc' },
  });
  const myClaims = pendingClaims.filter((c) => {
    const step = c.approvalSteps.find((s) => s.status === 'Pending');
    return step && step.approverId === persona;
  });

  const tabCls = (active: boolean) => `px-4 py-2 text-sm border-b-2 ${active ? 'font-semibold text-[var(--ecs-navy-2)] border-[var(--ecs-navy)]' : 'text-[var(--ecs-muted)] border-transparent hover:text-[var(--ecs-navy)]'}`;
  const rowCls = (hasExc: boolean) => (hasExc ? 'bg-[#fff8ec] hover:bg-[#ffeedd]' : 'hover:bg-[var(--ecs-panel-2)]');

  // Separation of duties: a non-approver (e.g. Travel Administrator) has no access to the approval
  // dashboard. Admin oversight of requests is on the Travel Request Dashboard / Travel Administration.
  if (!isApprover) {
    return (
      <div className="w-full">
        <PageTitle title="RO / DOA Dashboard"
          subtitle="The approver dashboard for Reporting Officers and DOAs." />
        <Card title="No approval authority">
          <Empty>
            You are acting as <strong>{EcsIdentity.employee(persona)?.name}</strong>, who does not hold an approver role.
            Approving travel requests is a delegated financial authority (RO / DOA) — it is not part of Travel
            Administration. Switch persona to an approver (e.g. Prof Ben Lim · RO, or Prof Carol Wong · DOA) to review approvals;
            to monitor requests, use the <Link href="/dashboard" className="underline">Travel Request Dashboard</Link> or <Link href="/workbench" className="underline">Travel Administration</Link>.
          </Empty>
        </Card>
      </div>
    );
  }

  return (
    <div className="w-full">
      <PageTitle title="RO / DOA Dashboard"
        subtitle="Pre-trip approvals reuse the existing approver dashboard, extended with Travel Requests and Expense Claims tabs (§13.12). Rows with a policy exception are highlighted." />

      {/* Tabs — each with its own pending counter for the acting approver. */}
      <div className="flex items-center gap-1 border-b border-[var(--ecs-border)] mb-4">
        <Link href="/approvals?tab=requests" className={tabCls(activeTab === 'requests')}>
          Travel Requests <span className={`ml-1 ${mine.length ? 'pill-warn' : 'pill-info'}`}>{mine.length}</span>
        </Link>
        <Link href="/approvals?tab=claims" className={tabCls(activeTab === 'claims')}>
          Expense Claims <span className={`ml-1 ${myClaims.length ? 'pill-warn' : 'pill-info'}`}>{myClaims.length}</span>
        </Link>
      </div>

      {activeTab === 'requests' ? (
        <Card title={`Travel Requests pending your approval (${mine.length}) · Sent back (${sentBack})`}>
          {mine.length === 0 ? (
            <Empty>Nothing pending your approval as {EcsIdentity.employee(persona)?.name}. Switch persona to an approver (e.g. Prof Ben Lim / Prof Carol Wong).</Empty>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr>
                  <th className="th">Submitted</th><th className="th">Request</th><th className="th">Business area</th>
                  <th className="th">Traveller(s)</th><th className="th">Requestor</th><th className="th">Purpose</th>
                  <th className="th">Destination</th><th className="th">Dates</th><th className="th text-right">Est. NTU (SGD)</th>
                  <th className="th">Exc.</th><th className="th">Status</th><th className="th"></th>
                </tr></thead>
                <tbody>
                  {mine.map((r) => {
                    const summary = computeSummary(r.expenses as never, settings.approvalAmountBasis);
                    const ba = EcsCharging.code(r.allocations[0]?.chargingCode ?? '')?.businessArea ?? '—';
                    const kind = r.travellerType === 'GUEST' ? 'GST' : r.isGroup ? 'GRP' : 'IND';
                    const kindTitle = kind === 'GRP' ? 'Group booking' : kind === 'GST' ? 'Guest booking' : 'Individual booking';
                    const exc = r.policyChecks.filter((c) => c.outcome === 'EXCEPTION').length;
                    return (
                      <tr key={r.id} className={rowCls(exc > 0)}>
                        <td className="td whitespace-nowrap">{fmtDate(r.versions.at(-1)?.createdAt ?? r.updatedAt)}</td>
                        <td className="td font-medium"><span className="inline-flex items-center gap-1 flex-wrap">{r.requestNumber}{r.isEmergency && <span className="pill-exc" title="Emergency — book first, raise later (DD-23)">E</span>}<span className="pill-navy" title={kindTitle}>{kind}</span></span></td>
                        <td className="td">{ba}</td>
                        <td className="td">{EcsIdentity.employee(r.travellerId)?.name}{r.isGroup ? ` +${r.travellers.length - 1}` : ''}</td>
                        <td className="td">{EcsIdentity.employee(r.requestorId)?.name}</td>
                        <td className="td">{EcsReference.travelPurpose(r.purposeId ?? '')?.name}</td>
                        <td className="td">{EcsReference.city(r.destCity ?? '')?.name}</td>
                        <td className="td whitespace-nowrap">{fmtDate(r.startDate)} → {fmtDate(r.endDate)}</td>
                        <td className="td text-right">{fmtSgd(summary.ntuFunded)}</td>
                        <td className="td text-center">{exc > 0 ? <span className="pill-exc">⚠ {exc}</span> : '—'}</td>
                        <td className="td"><StatusPill status={r.status} /></td>
                        <td className="td"><Link href={`/requests/${r.id}`} className="btn-primary text-xs">Review →</Link></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <p className="text-xs text-[var(--ecs-muted)] mt-3">Rows shaded amber carry a policy exception and require individual review. The bulk Approve action (not shown) excludes requests with exceptions and all group travel requests (§13.12).</p>
            </div>
          )}
        </Card>
      ) : (
        <Card title={`Expense Claims pending your approval (${myClaims.length})`}>
          {myClaims.length === 0 ? (
            <Empty>No expense claims pending your approval as {EcsIdentity.employee(persona)?.name}. Claims route Verifier → (Exception) → (RO) → DOA (§51).</Empty>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr>
                  <th className="th">Updated</th><th className="th">Claim</th><th className="th">Claimant</th>
                  <th className="th">From request</th><th className="th">Destination</th>
                  <th className="th text-right">Claimed (SGD)</th><th className="th">Exc.</th><th className="th">Pending step</th><th className="th">Status</th><th className="th"></th>
                </tr></thead>
                <tbody>
                  {myClaims.map((c) => {
                    const gross = c.lines.reduce((s, l) => s + l.actualSgd, 0);
                    const total = Math.max(gross - c.lessCorpCard - c.lessPersonal, 0);
                    const step = c.approvalSteps.find((s) => s.status === 'Pending');
                    const hasExc = c.approvalSteps.some((s) => s.roleType === 'EXCEPTION');
                    const stepLabel: Record<string, string> = { VERIFIER: 'Verifier', EXCEPTION: 'Exception', RO: 'RO', DOA: 'DOA', RESEARCH_DOA: 'Research DOA' };
                    return (
                      <tr key={c.id} className={rowCls(hasExc)}>
                        <td className="td whitespace-nowrap">{fmtDate(c.createdAt)}</td>
                        <td className="td font-medium">{c.claimNumber}</td>
                        <td className="td">{EcsIdentity.employee(c.claimantId)?.name ?? c.claimantId}</td>
                        <td className="td">{c.request?.requestNumber ?? '—'}</td>
                        <td className="td">{EcsReference.city(c.request?.destCity ?? '')?.name ?? '—'}</td>
                        <td className="td text-right">{fmtSgd(total)}</td>
                        <td className="td text-center">{hasExc ? <span className="pill-exc">⚠</span> : '—'}</td>
                        <td className="td">{step ? (stepLabel[step.roleType] ?? step.roleType) : '—'}</td>
                        <td className="td"><StatusPill status={c.status} /></td>
                        <td className="td"><Link href={`/claims/${c.id}`} className="btn-primary text-xs">Review →</Link></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <p className="text-xs text-[var(--ecs-muted)] mt-3">Rows shaded amber carry a new policy exception on the claim. &ldquo;Review →&rdquo; opens the one-page claim with its approval workflow (§51).</p>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
