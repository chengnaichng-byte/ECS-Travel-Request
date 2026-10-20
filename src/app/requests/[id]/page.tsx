// Request page — the Approval Summary landing view (reached from the RO/DOA approval dashboard).
// The shared chrome (header, status + decision bar, workflow, banners) is in RequestChrome; the
// full detail cards live on /requests/[id]/details. A draft keeps the detail cards inline since
// the traveller is still reviewing before submission.
import { notFound } from 'next/navigation';
import { loadRequest } from '@/modules/pretrip/queries';
import { getSettings } from '@/modules/pretrip/settings';
import { currentPersonaId } from '@/shared/session';
import { computeSummary } from '@/modules/pretrip/pricing';
import { REQUEST_STATUS } from '@/shared/enums';
import { RequestChrome } from '@/components/RequestChrome';
import { ApprovalSummaryCard } from '@/components/ReviewSections';
import { RequestFullDetails } from '@/components/RequestFullDetails';

export const dynamic = 'force-dynamic';

export default async function RequestDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const req = await loadRequest(id);
  if (!req) notFound();
  const settings = await getSettings();
  const persona = await currentPersonaId();
  const summary = computeSummary(req.expenses, settings.approvalAmountBasis);
  const isDraft = req.status === REQUEST_STATUS.Draft || req.status === REQUEST_STATUS.SentBack;
  // The Approval Summary is the APPROVER's decision view. Only someone assigned to a step in this
  // request's route sees it; the traveller / requestor (and other non-approvers) see the full
  // details — they cannot approve their own request, so they are never shown the approval summary.
  const isApprover = req.approvalSteps.some((s) => s.approverId === persona);

  return (
    <div className="w-full space-y-5">
      <RequestChrome req={req} id={id} persona={persona} settings={settings} />

      {isDraft || !isApprover
        ? <RequestFullDetails req={req} summary={summary} settings={settings} />
        : <ApprovalSummaryCard req={req} summary={summary} bookingDeadlineDays={settings.bookingDeadlineDays} detailsHref={`/requests/${id}/details`} />}
    </div>
  );
}
