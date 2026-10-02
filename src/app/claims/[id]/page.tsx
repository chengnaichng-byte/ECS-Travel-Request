// TR-16 Create TE (pre-populated per §13.8) + TR-17 Estimate-to-Actual comparison.
// Locked fields are copied and non-editable; Editable default to approved values;
// Reference values are shown for comparison (AC15). Self-booked trips show the
// booked column as N/A (§13.17).
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@/shared/db';
import { loadRequest } from '@/modules/pretrip/queries';
import { getSettings } from '@/modules/pretrip/settings';
import { prepopulateClaim, fmtSgd } from '@/modules/te/prepopulate';
import { getContractSettings, prepopContract } from '@/modules/pretrip/integration';
import { updateClaimActuals, submitClaim } from '@/modules/te/actions';
import { TE_TREATMENT } from '@/shared/enums';
import { PageTitle, Card, Empty } from '@/components/ui';
import { TreatmentPill } from '@/components/StatusPill';

export const dynamic = 'force-dynamic';

export default async function ClaimPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const claim = await prisma.travelExpenseClaim.findUnique({ where: { id }, include: { lines: true } });
  if (!claim || !claim.requestId) notFound();
  const req = await loadRequest(claim.requestId);
  if (!req) notFound();
  const settings = await getSettings();
  const prep = prepopulateClaim(req, claim.claimantId, settings.airfareTreatment, prepopContract(await getContractSettings()));

  const totals = claim.lines.reduce(
    (acc, l) => ({ approved: acc.approved + l.approvedSgd, booked: acc.booked + (l.bookedSgd ?? 0), actual: acc.actual + l.actualSgd, variance: acc.variance + l.varianceSgd }),
    { approved: 0, booked: 0, actual: 0, variance: 0 },
  );
  const anyBooked = claim.lines.some((l) => l.bookedSgd != null);

  return (
    <div className="w-full space-y-5">
      <PageTitle id="TR-16 · TR-17" title={`Travel Expense Claim ${claim.claimNumber}`}
        subtitle={`Pre-populated from ${req.requestNumber} / ${req.authorisationNo ?? '—'}. ${prep.note}`}
        actions={<Link href={`/requests/${req.id}`} className="btn-secondary">View Travel Request →</Link>} />

      <Card title="Claim Header (pre-populated §13.8)">
        <dl className="grid md:grid-cols-3 gap-4">
          {prep.header.map((f) => (
            <div key={f.label}>
              <dt className="text-xs font-semibold text-[var(--ecs-muted)] uppercase tracking-wide flex items-center gap-2">{f.label} <TreatmentPill treatment={f.treatment} /></dt>
              <dd className="text-sm mt-0.5">{f.value}</dd>
            </div>
          ))}
        </dl>
      </Card>

      <Card title="Estimate-to-Actual (TR-17)">
        {claim.lines.length === 0 ? <Empty>No claimable lines.</Empty> : (
          <form action={updateClaimActuals.bind(null, id)}>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr>
                  <th className="th">Expense line</th><th className="th">Treatment</th>
                  <th className="th text-right">Approved est.</th><th className="th text-right">Booked</th>
                  <th className="th text-right">Actual claim</th><th className="th text-right">Variance</th><th className="th">Receipt</th>
                </tr></thead>
                <tbody>
                  {claim.lines.map((l) => {
                    const editable = l.treatment === TE_TREATMENT.Editable;
                    return (
                      <tr key={l.id} className="hover:bg-[var(--ecs-panel-2)]">
                        <td className="td font-medium">{prep.lines.find((p) => p.category === l.category)?.label ?? l.category}</td>
                        <td className="td"><TreatmentPill treatment={l.treatment} /></td>
                        <td className="td text-right">{fmtSgd(l.approvedSgd)}</td>
                        <td className="td text-right">{l.bookedSgd != null ? fmtSgd(l.bookedSgd) : <span className="text-[var(--ecs-muted)] text-xs">N/A</span>}</td>
                        <td className="td text-right">
                          {editable ? (
                            <input name={`actual_${l.id}`} type="number" step="any" defaultValue={l.actualSgd} className="field text-right w-28 ml-auto" />
                          ) : (
                            <span className="text-[var(--ecs-muted)]">{fmtSgd(l.actualSgd)}</span>
                          )}
                        </td>
                        <td className={`td text-right ${l.varianceSgd > 0 ? 'text-red-700' : l.varianceSgd < 0 ? 'text-emerald-700' : ''}`}>{l.varianceSgd === 0 ? '—' : fmtSgd(l.varianceSgd)}</td>
                        <td className="td text-center">{editable ? <input type="checkbox" name={`receipt_${l.id}`} defaultChecked={l.receiptOk} /> : '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="font-semibold text-[var(--ecs-navy-2)]">
                    <td className="td" colSpan={2}>Totals</td>
                    <td className="td text-right">{fmtSgd(totals.approved)}</td>
                    <td className="td text-right">{anyBooked ? fmtSgd(totals.booked) : '—'}</td>
                    <td className="td text-right">{fmtSgd(totals.actual)}</td>
                    <td className="td text-right">{fmtSgd(totals.variance)}</td>
                    <td className="td"></td>
                  </tr>
                </tfoot>
              </table>
            </div>
            <div className="flex justify-end mt-3">
              <button className="btn-secondary">Save actuals & recompute variance</button>
            </div>
          </form>
        )}
      </Card>

      <div className="flex items-center justify-between">
        <p className="text-xs text-[var(--ecs-muted)] max-w-xl">
          Approved values remain traceable; edits are recorded as actual values / variances rather than overwriting the approved request (§8.3). One approved request may link to multiple claims; cumulative claimed amounts compare against the approved estimate (AC17).
        </p>
        {claim.status === 'Draft' ? (
          <form action={submitClaim.bind(null, id)}><button className="btn-primary">Submit claim</button></form>
        ) : (
          <span className="pill-pass">Claim submitted</span>
        )}
      </div>
    </div>
  );
}
