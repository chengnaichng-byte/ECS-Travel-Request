// Full Details page — the detail cards for a Travel Request. Reached directly from the Travel
// Request Dashboard (viewers), or via "View Full Details" from the Approval Summary (approvers).
// It shows the same chrome (header, status + decision bar, workflow) so an approver can act here
// too, plus a Back-to-summary button.
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { loadRequest } from '@/modules/pretrip/queries';
import { getSettings } from '@/modules/pretrip/settings';
import { currentPersonaId } from '@/shared/session';
import { computeSummary } from '@/modules/pretrip/pricing';
import { RequestChrome } from '@/components/RequestChrome';
import { RequestFullDetails } from '@/components/RequestFullDetails';

export const dynamic = 'force-dynamic';

export default async function RequestDetailsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const req = await loadRequest(id);
  if (!req) notFound();
  const settings = await getSettings();
  const persona = await currentPersonaId();
  const summary = computeSummary(req.expenses, settings.approvalAmountBasis);
  // "Back to summary" only makes sense for an APPROVER — the Approval Summary is their view.
  // A traveller / non-approver cannot see the approval summary of their own request, so it is hidden.
  const isApprover = req.approvalSteps.some((s) => s.approverId === persona);

  return (
    <div className="w-full space-y-5">
      <RequestChrome req={req} id={id} persona={persona} settings={settings} />

      <div className="flex items-center justify-between gap-3 border-t border-[var(--ecs-border)] pt-4">
        <h2 className="text-sm font-semibold text-[var(--ecs-muted)] uppercase tracking-wide">Full Details</h2>
        {isApprover && <Link href={`/requests/${id}`} className="btn-secondary">← Back to summary</Link>}
      </div>

      <RequestFullDetails req={req} summary={summary} settings={settings} />

      {isApprover && <div className="pt-2"><Link href={`/requests/${id}`} className="btn-secondary">← Back to summary</Link></div>}
    </div>
  );
}
