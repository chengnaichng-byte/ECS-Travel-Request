// Full Details page — the detail cards for a Travel Request, moved off the summary page.
// Reached from the Approval Summary ("View Full Details" / tile chevrons); has a Back button.
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { loadRequest } from '@/modules/pretrip/queries';
import { getSettings } from '@/modules/pretrip/settings';
import { computeSummary } from '@/modules/pretrip/pricing';
import { isGuestRequest } from '@/modules/pretrip/traveller';
import { RequestFullDetails } from '@/components/RequestFullDetails';

export const dynamic = 'force-dynamic';

export default async function RequestDetailsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const req = await loadRequest(id);
  if (!req) notFound();
  const settings = await getSettings();
  const summary = computeSummary(req.expenses, settings.approvalAmountBasis);

  return (
    <div className="w-full space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <Link href={`/requests/${id}`} className="btn-secondary">← Back to summary</Link>
        <h1 className="text-lg font-semibold text-[var(--ecs-navy)] flex items-center gap-2">
          Full Details
          <span className="font-mono text-[var(--ecs-text)]">{req.requestNumber}</span>
          {req.isGroup && <span className="pill-navy">GROUP</span>}
          {isGuestRequest(req) && <span className="pill-info">GUEST</span>}
        </h1>
      </div>

      <RequestFullDetails req={req} summary={summary} settings={settings} />

      <div className="pt-2"><Link href={`/requests/${id}`} className="btn-secondary">← Back to summary</Link></div>
    </div>
  );
}
