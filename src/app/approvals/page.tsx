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
import { travellerName } from '@/modules/pretrip/traveller';
import { PageTitle, Card, Empty } from '@/components/ui';
import { StatusPill } from '@/components/StatusPill';
import { SortableTable } from '@/components/SortableTable';

export const dynamic = 'force-dynamic';
function fmtDate(d: Date | null) { return d ? d.toISOString().slice(0, 10) : '—'; }

export default async function Approvals({ searchParams }: { searchParams: Promise<{ tab?: string; status?: string }> }) {
  const { tab, status } = await searchParams;
  const activeTab = tab === 'claims' ? 'claims' : 'requests';
  // Status filter on the Travel Requests tab — default is the actionable queue (pending my
  // approval); the approver can widen it to what they have approved (incl. auto-granted) or to
  // every request they are a named approver on.
  const reqFilter: 'pending' | 'approved' | 'all' = status === 'approved' || status === 'all' ? status : 'pending';

  const persona = await currentPersonaId();
  const settings = await getSettings();
  // Separation of duties (DD-24): this is the APPROVER's dashboard. Only a persona that holds an
  // approver role (RO / DOA / Research DOA / Exception) has access — a Travel/System Administrator
  // is not an approver and sees no actionable queue here (oversight lives under Travel Admin).
  const isApprover = isApproverPersona(persona);

  // --- Travel Requests where the acting persona is a NAMED approver on the route (any step
  // status). Separation of duties: an approver sees the requests they are/were an approver on —
  // never the whole system. The status filter then narrows this scoped set. Drafts have no
  // approval steps, so they are excluded. ---
  const approverReqs = await prisma.travelRequest.findMany({
    where: { approvalSteps: { some: { approverId: persona } } },
    include: fullInclude,
    orderBy: { updatedAt: 'desc' },
  });
  // Sequential routing → exactly one active Pending step; it is mine when that current step is mine.
  const isMyPending = (r: typeof approverReqs[number]) => {
    const step = r.approvalSteps.find((s) => s.status === 'Pending');
    return !!step && step.approverId === persona;
  };
  const myDecidedStep = (r: typeof approverReqs[number]) => r.approvalSteps.find((s) => s.approverId === persona && s.status === 'Approved');
  // A step auto-granted on submission (non-term research auto-grant, or PI self-approval) was never
  // clicked — its comment carries the "self-approved on submission" marker stamped by submitRequest.
  const wasAutoGranted = (r: typeof approverReqs[number]) => {
    const s = myDecidedStep(r);
    return !!s && (s.comments ?? '').includes('self-approved on submission');
  };
  const mine = approverReqs.filter(isMyPending);
  const shown = reqFilter === 'approved' ? approverReqs.filter((r) => !!myDecidedStep(r))
    : reqFilter === 'all' ? approverReqs
    : mine;
  const sentBack = await prisma.travelRequest.count({ where: { status: 'Sent Back' } });
  const reqCardTitle = reqFilter === 'approved' ? `Travel Requests approved by you (${shown.length})`
    : reqFilter === 'all' ? `Travel Requests where you are an approver (${shown.length})`
    : `Travel Requests pending your approval (${shown.length}) · Sent back (${sentBack})`;

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
        <Card title={reqCardTitle}>
          {/* Status filter — default "Pending my approval" keeps the actionable queue; the approver
              can widen to what they approved (incl. auto-granted) or every request they approve. */}
          <div className="flex items-center gap-2 mb-3 text-xs flex-wrap">
            <span className="text-[var(--ecs-muted)]">Show:</span>
            {([['pending', 'Pending my approval'], ['approved', 'Approved by me'], ['all', "All I'm an approver on"]] as const).map(([key, label]) => (
              <Link key={key} href={`/approvals?tab=requests&status=${key}`}
                className={`px-2.5 py-1 rounded border ${reqFilter === key ? 'bg-[var(--ecs-navy)] text-white border-[var(--ecs-navy)]' : 'border-[var(--ecs-border)] text-[var(--ecs-muted)] hover:text-[var(--ecs-navy)]'}`}>
                {label}
              </Link>
            ))}
          </div>
          {shown.length === 0 ? (
            <Empty>{reqFilter === 'approved'
              ? `No requests approved by you (as ${EcsIdentity.employee(persona)?.name}) yet.`
              : reqFilter === 'all'
              ? `No requests where you are a named approver (as ${EcsIdentity.employee(persona)?.name}).`
              : <>Nothing pending your approval as {EcsIdentity.employee(persona)?.name}. Switch persona to an approver (e.g. Prof Ben Lim / Prof Carol Wong).</>}</Empty>
          ) : (
            <div className="overflow-x-auto">
              <SortableTable
                tableClassName="w-full text-sm"
                initialSort={{ key: 'submitted', dir: 'desc' }}
                columns={[
                  { key: 'submitted', label: 'Submitted' },
                  { key: 'request', label: 'Request' },
                  { key: 'ba', label: 'Business area' },
                  { key: 'travellers', label: 'Traveller(s)' },
                  { key: 'requestor', label: 'Requestor' },
                  { key: 'purpose', label: 'Purpose' },
                  { key: 'destination', label: 'Destination' },
                  { key: 'dates', label: 'Dates' },
                  { key: 'ntu', label: 'Est. NTU (SGD)', align: 'right' },
                  { key: 'exc', label: 'Exc.', align: 'center' },
                  { key: 'status', label: 'Status' },
                  { key: 'action', label: '', sortable: false },
                ]}
                rows={shown.map((r) => {
                  const autoGranted = wasAutoGranted(r);
                  const summary = computeSummary(r.expenses as never, settings.approvalAmountBasis);
                  const ba = EcsCharging.code(r.allocations[0]?.chargingCode ?? '')?.businessArea ?? '—';
                  const kind = r.travellerType === 'GUEST' ? 'GST' : r.isGroup ? 'GRP' : 'IND';
                  const kindSub = kind === 'GRP' && r.groupType === 'STUDENT' ? 'Stu' : kind === 'GRP' && r.groupType === 'STAFF' ? 'Staff' : '';
                  const kindTitle = kind === 'GRP' ? `${r.groupType === 'STUDENT' ? 'Student ' : r.groupType === 'STAFF' ? 'Staff ' : ''}group booking` : kind === 'GST' ? 'Guest booking' : 'Individual booking';
                  const exc = r.policyChecks.filter((c) => c.outcome === 'EXCEPTION').length;
                  const submitted = r.versions.at(-1)?.createdAt ?? r.updatedAt;
                  const travellers = r.groupType === 'STUDENT' ? `${r.travellers.length} students` : travellerName(r) + (r.isGroup ? ` +${r.travellers.length - 1}` : '');
                  const requestor = EcsIdentity.employee(r.requestorId)?.name ?? '';
                  const purpose = EcsReference.travelPurpose(r.purposeId ?? '')?.name ?? '';
                  const dest = EcsReference.city(r.destCity ?? '')?.name ?? '';
                  return {
                    key: r.id,
                    className: rowCls(exc > 0),
                    sort: { submitted: submitted ? submitted.toISOString() : null, request: r.requestNumber, ba, travellers, requestor, purpose, destination: dest, dates: r.startDate ? r.startDate.toISOString() : null, ntu: summary.ntuFunded, exc, status: r.status },
                    cells: (<>
                      <td className="td whitespace-nowrap">{fmtDate(submitted)}</td>
                      <td className="td font-medium"><span className="inline-flex items-center gap-1 flex-wrap">{r.requestNumber}{r.isEmergency && <span className="pill-exc" title="Emergency — book first, raise later (DD-23)">E</span>}<span className="pill-navy" title={kindTitle}>{kind}{kindSub ? `·${kindSub}` : ''}</span>{autoGranted && <span className="pill-pass" title="Approved automatically on submission — auto-granted under your authority (never required a click)">Auto-granted</span>}</span></td>
                      <td className="td">{ba}</td>
                      <td className="td">{travellers}</td>
                      <td className="td">{requestor}</td>
                      <td className="td">{purpose}</td>
                      <td className="td">{dest}</td>
                      <td className="td whitespace-nowrap">{fmtDate(r.startDate)} → {fmtDate(r.endDate)}</td>
                      <td className="td text-right">{fmtSgd(summary.ntuFunded)}</td>
                      <td className="td text-center">{exc > 0 ? <span className="pill-exc">⚠ {exc}</span> : '—'}</td>
                      <td className="td"><StatusPill status={r.status} /></td>
                      <td className="td"><Link href={`/requests/${r.id}`} className="btn-primary text-xs">Review →</Link></td>
                    </>),
                  };
                })}
              />
              <p className="text-xs text-[var(--ecs-muted)] mt-3">Rows shaded amber carry a policy exception and require individual review.{reqFilter === 'pending' && ' The bulk Approve action (not shown) excludes requests with exceptions and all group travel requests (§13.12).'}{reqFilter !== 'pending' && ' Rows flagged “Auto-granted” were approved automatically on submission under your authority.'}</p>
            </div>
          )}
        </Card>
      ) : (
        <Card title={`Expense Claims pending your approval (${myClaims.length})`}>
          {myClaims.length === 0 ? (
            <Empty>No expense claims pending your approval as {EcsIdentity.employee(persona)?.name}. Claims route Verifier → (Exception) → (RO) → DOA (§51).</Empty>
          ) : (
            <div className="overflow-x-auto">
              <SortableTable
                tableClassName="w-full text-sm"
                initialSort={{ key: 'updated', dir: 'desc' }}
                columns={[
                  { key: 'updated', label: 'Updated' },
                  { key: 'claim', label: 'Claim' },
                  { key: 'claimant', label: 'Claimant' },
                  { key: 'fromRequest', label: 'From request' },
                  { key: 'destination', label: 'Destination' },
                  { key: 'claimed', label: 'Claimed (SGD)', align: 'right' },
                  { key: 'exc', label: 'Exc.', align: 'center' },
                  { key: 'step', label: 'Pending step' },
                  { key: 'status', label: 'Status' },
                  { key: 'action', label: '', sortable: false },
                ]}
                rows={myClaims.map((c) => {
                  const gross = c.lines.reduce((s, l) => s + l.actualSgd, 0);
                  const total = Math.max(gross - c.lessCorpCard - c.lessPersonal, 0);
                  const step = c.approvalSteps.find((s) => s.status === 'Pending');
                  const hasExc = c.approvalSteps.some((s) => s.roleType === 'EXCEPTION');
                  const stepLabel: Record<string, string> = { VERIFIER: 'Verifier', EXCEPTION: 'Exception', RO: 'RO', DOA: 'DOA', RESEARCH_DOA: 'Research DOA' };
                  const claimant = EcsIdentity.employee(c.claimantId)?.name ?? c.claimantId;
                  const dest = EcsReference.city(c.request?.destCity ?? '')?.name ?? '—';
                  const stepName = step ? (stepLabel[step.roleType] ?? step.roleType) : '—';
                  return {
                    key: c.id,
                    className: rowCls(hasExc),
                    sort: { updated: c.createdAt ? c.createdAt.toISOString() : null, claim: c.claimNumber, claimant, fromRequest: c.request?.requestNumber ?? '', destination: dest, claimed: total, exc: hasExc ? 1 : 0, step: stepName, status: c.status },
                    cells: (<>
                      <td className="td whitespace-nowrap">{fmtDate(c.createdAt)}</td>
                      <td className="td font-medium">{c.claimNumber}</td>
                      <td className="td">{claimant}</td>
                      <td className="td">{c.request?.requestNumber ?? '—'}</td>
                      <td className="td">{dest}</td>
                      <td className="td text-right">{fmtSgd(total)}</td>
                      <td className="td text-center">{hasExc ? <span className="pill-exc">⚠</span> : '—'}</td>
                      <td className="td">{stepName}</td>
                      <td className="td"><StatusPill status={c.status} /></td>
                      <td className="td"><Link href={`/claims/${c.id}`} className="btn-primary text-xs">Review →</Link></td>
                    </>),
                  };
                })}
              />
              <p className="text-xs text-[var(--ecs-muted)] mt-3">Rows shaded amber carry a new policy exception on the claim. &ldquo;Review →&rdquo; opens the one-page claim with its approval workflow (§51).</p>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
