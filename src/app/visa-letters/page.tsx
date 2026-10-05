// §4.13 Visa Letter Notifications — the daily batch queue. Lists approved requests that
// flagged a visa letter, their notification status, and the generated notification; the
// batch (simulating the daily scheduled job) notifies the org-unit-mapped office.
import Link from 'next/link';
import { prisma } from '@/shared/db';
import { EcsReference, EcsIdentity } from '@/shared/ecs/services';
import { travellerName } from '@/modules/pretrip/traveller';
import { visaLetterRecipientFor } from '@/config/visaLetter';
import { runVisaLetterBatch } from '@/modules/pretrip/actions';
import { REQUEST_STATUS } from '@/shared/enums';
import { PageTitle, Card, Empty } from '@/components/ui';

export const dynamic = 'force-dynamic';
const d = (x: Date | null) => (x ? x.toISOString().slice(0, 10) : '—');

export default async function VisaLettersPage() {
  const reqs = await prisma.travelRequest.findMany({
    where: { visaLetterRequired: true },
    orderBy: { updatedAt: 'desc' },
    include: { messages: { where: { kind: 'VISA_LETTER' }, orderBy: { createdAt: 'desc' } } },
  });
  const pending = reqs.filter((r) => r.status === REQUEST_STATUS.Approved && !r.visaLetterNotifiedAt).length;

  return (
    <div className="w-full space-y-5">
      <PageTitle id="§4.13" title="Visa Letter Notifications"
        subtitle="Approved requests that flagged a visa letter. The daily batch notifies the immigration office mapped to the traveller's organisational unit, with the approved travel details." />

      <div className="card px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
        <div className="text-sm">
          <span className="text-[var(--ecs-muted)]">Awaiting notification:</span> <strong className={pending ? 'text-[var(--ecs-red)]' : ''}>{pending}</strong>
          {pending === 0 && <span className="text-[var(--ecs-muted)]"> — all caught up</span>}
        </div>
        <form action={runVisaLetterBatch}>
          <button className="btn-primary" disabled={pending === 0}>Run daily visa-letter batch</button>
        </form>
      </div>

      <Card title="Visa Letter Queue">
        {reqs.length === 0 ? <Empty>No requests have flagged a visa letter.</Empty> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr>
                <th className="th">Request</th><th className="th">Traveller</th><th className="th">Destination</th>
                <th className="th">Dates</th><th className="th">Recipient office</th><th className="th">Status</th>
              </tr></thead>
              <tbody>
                {reqs.map((r) => {
                  const rec = visaLetterRecipientFor(r.departmentId);
                  const approved = r.status === REQUEST_STATUS.Approved;
                  return (
                    <tr key={r.id} className="hover:bg-[var(--ecs-panel-2)]">
                      <td className="td"><Link href={`/requests/${r.id}`} className="font-mono text-[var(--ecs-navy)] hover:underline">{r.requestNumber}</Link></td>
                      <td className="td">{travellerName(r)}</td>
                      <td className="td">{EcsReference.city(r.destCity ?? '')?.name ?? '—'}, {EcsReference.country(r.destCountry ?? '')?.name ?? ''}</td>
                      <td className="td">{d(r.startDate)} → {d(r.endDate)}</td>
                      <td className="td">{rec.office}</td>
                      <td className="td">
                        {r.visaLetterNotifiedAt
                          ? <span className="pill-pass">Sent {d(r.visaLetterNotifiedAt)}</span>
                          : approved ? <span className="pill-exc">Pending</span> : <span className="pill-info">Awaiting approval</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {reqs.some((r) => r.messages.length > 0) && (
        <Card title="Generated Notifications (§4.13 content)">
          <div className="space-y-4">
            {reqs.flatMap((r) => r.messages.map((m) => (
              <div key={m.id}>
                <div className="text-xs text-[var(--ecs-muted)] mb-1">{r.requestNumber} · {EcsIdentity.department(r.departmentId ?? '')?.name ?? ''}</div>
                <pre className="text-xs bg-[var(--ecs-panel-2)] p-3 rounded overflow-x-auto border border-[var(--ecs-border)]">{m.payload}</pre>
              </div>
            )))}
          </div>
        </Card>
      )}
    </div>
  );
}
