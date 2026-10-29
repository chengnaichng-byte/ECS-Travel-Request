// §4.13 Visa Letter Notifications — the daily batch queue. Lists the travellers who requested a visa
// letter (filterable), their notification status, and the generated notification. The batch notifies
// HR (the HR officer configured in Pre-Trip Module Settings), NOT the immigration office.
import Link from 'next/link';
import { prisma } from '@/shared/db';
import { EcsReference, EcsIdentity } from '@/shared/ecs/services';
import { travellerName } from '@/modules/pretrip/traveller';
import { visaLetterRecipient } from '@/config/visaLetter';
import { getSettings } from '@/modules/pretrip/settings';
import { runVisaLetterBatch } from '@/modules/pretrip/actions';
import { REQUEST_STATUS } from '@/shared/enums';
import { PageTitle, Card, Empty } from '@/components/ui';

export const dynamic = 'force-dynamic';
const d = (x: Date | null) => (x ? x.toISOString().slice(0, 10) : '—');

type Row = Awaited<ReturnType<typeof loadRows>>[number];
async function loadRows() {
  return prisma.travelRequest.findMany({
    where: { visaLetterRequired: true },
    orderBy: { updatedAt: 'desc' },
    include: { messages: { where: { kind: 'VISA_LETTER' }, orderBy: { createdAt: 'desc' } } },
  });
}
const statusOf = (r: Row): 'Sent' | 'Pending' | 'Awaiting approval' =>
  r.visaLetterNotifiedAt ? 'Sent' : r.status === REQUEST_STATUS.Approved ? 'Pending' : 'Awaiting approval';

export default async function VisaLettersPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string }> }) {
  const sp = await searchParams;
  const q = (sp.q ?? '').trim().toLowerCase();
  const statusF = sp.status ?? '';
  const settings = await getSettings();
  const rec = visaLetterRecipient(settings);

  const all = await loadRows();
  const destText = (r: Row) => `${EcsReference.city(r.destCity ?? '')?.name ?? ''} ${EcsReference.country(r.destCountry ?? '')?.name ?? ''}`;
  const reqs = all.filter((r) => {
    if (statusF && statusOf(r) !== statusF) return false;
    if (q && !`${r.requestNumber} ${travellerName(r)} ${destText(r)}`.toLowerCase().includes(q)) return false;
    return true;
  });
  const pending = all.filter((r) => statusOf(r) === 'Pending').length;
  const active = q || statusF;

  return (
    <div className="w-full space-y-5">
      <PageTitle id="§4.13" title="Visa Letter Notifications"
        subtitle="Travellers who requested a visa letter on an approved trip. The daily batch notifies HR with the approved travel details; HR then issues / processes the visa letter." />

      <div className="card px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
        <div className="text-sm space-y-0.5">
          <div><span className="text-[var(--ecs-muted)]">Notify HR:</span> <strong className="text-[var(--ecs-navy)]">{rec.office}</strong> <span className="font-mono text-xs text-[var(--ecs-muted)]">{rec.email}</span> <Link href="/settings" className="text-xs underline text-[var(--ecs-navy)] ml-1">change</Link></div>
          <div><span className="text-[var(--ecs-muted)]">Awaiting notification:</span> <strong className={pending ? 'text-[var(--ecs-red)]' : ''}>{pending}</strong>{pending === 0 && <span className="text-[var(--ecs-muted)]"> — all caught up</span>}</div>
        </div>
        <form action={runVisaLetterBatch}>
          <button className="btn-primary" disabled={pending === 0}>Run daily visa-letter batch</button>
        </form>
      </div>

      <Card title="Filter">
        <form method="GET" className="flex flex-wrap items-end gap-3">
          <div className="grow min-w-56">
            <label className="label">Search</label>
            <input name="q" defaultValue={sp.q ?? ''} placeholder="traveller · request no. · destination" className="field w-full" />
          </div>
          <div>
            <label className="label">Status</label>
            <select name="status" defaultValue={statusF} className="field w-48">
              <option value="">All</option>
              <option value="Pending">Pending</option>
              <option value="Sent">Sent</option>
              <option value="Awaiting approval">Awaiting approval</option>
            </select>
          </div>
          <button className="btn-primary">Apply</button>
          {active ? <Link href="/visa-letters" className="btn-ghost">Clear</Link> : null}
        </form>
      </Card>

      <Card title={`Visa Letter Requests (${reqs.length}${active ? ` of ${all.length}` : ''})`}>
        {all.length === 0 ? <Empty>No travellers have requested a visa letter.</Empty> : reqs.length === 0 ? <Empty>No requests match the filter.</Empty> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr>
                <th className="th">Request</th><th className="th">Traveller</th><th className="th">Department</th><th className="th">Destination</th>
                <th className="th">Dates</th><th className="th">Status</th><th className="th">Notified</th>
              </tr></thead>
              <tbody>
                {reqs.map((r) => {
                  const st = statusOf(r);
                  return (
                    <tr key={r.id} className="hover:bg-[var(--ecs-panel-2)]">
                      <td className="td"><Link href={`/requests/${r.id}`} className="font-mono text-[var(--ecs-navy)] hover:underline">{r.requestNumber}</Link></td>
                      <td className="td">{travellerName(r)}</td>
                      <td className="td">{EcsIdentity.department(r.departmentId ?? '')?.name ?? '—'}</td>
                      <td className="td">{EcsReference.city(r.destCity ?? '')?.name ?? '—'}, {EcsReference.country(r.destCountry ?? '')?.name ?? ''}</td>
                      <td className="td whitespace-nowrap">{d(r.startDate)} → {d(r.endDate)}</td>
                      <td className="td">{st === 'Sent' ? <span className="pill-pass">Sent</span> : st === 'Pending' ? <span className="pill-exc">Pending</span> : <span className="pill-info">Awaiting approval</span>}</td>
                      <td className="td">{d(r.visaLetterNotifiedAt)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {reqs.some((r) => r.messages.length > 0) && (
        <Card title="Generated Notifications to HR (§4.13 content)">
          <div className="space-y-4">
            {reqs.flatMap((r) => r.messages.map((m) => (
              <div key={m.id}>
                <div className="text-xs text-[var(--ecs-muted)] mb-1">{r.requestNumber} · {travellerName(r)}</div>
                <pre className="text-xs bg-[var(--ecs-panel-2)] p-3 rounded overflow-x-auto border border-[var(--ecs-border)]">{m.payload}</pre>
              </div>
            )))}
          </div>
        </Card>
      )}
    </div>
  );
}
