// §4.13 Visa Letter Notifications — the travellers who requested a visa letter. The notification is an
// AUTOMATIC daily timer job (runs at 02:00, not manually triggered): it notifies HR — the HR officer
// configured in Pre-Trip Module Settings — of every approved visa-letter request not yet notified.
// The page shows TODAY's list by default (today's notifications + anything still outstanding).
import Link from 'next/link';
import { prisma } from '@/shared/db';
import { EcsReference, EcsIdentity } from '@/shared/ecs/services';
import { travellerName } from '@/modules/pretrip/traveller';
import { visaLetterRecipient } from '@/config/visaLetter';
import { getSettings } from '@/modules/pretrip/settings';
import { runVisaLetterTimerIfDue } from '@/modules/pretrip/actions';
import { REQUEST_STATUS } from '@/shared/enums';
import { PageTitle, Card, Empty } from '@/components/ui';

export const dynamic = 'force-dynamic';
const d = (x: Date | null) => (x ? x.toISOString().slice(0, 10) : '—');
const dt = (x: Date | null) => (x ? x.toISOString().slice(0, 16).replace('T', ' ') : '—');
const todayStr = () => new Date().toISOString().slice(0, 10);

type Row = Awaited<ReturnType<typeof loadRows>>[number];
async function loadRows() {
  return prisma.travelRequest.findMany({
    where: { visaLetterRequired: true },
    orderBy: { updatedAt: 'desc' },
    include: { messages: { where: { kind: 'VISA_LETTER' }, orderBy: { createdAt: 'desc' } } },
  });
}
const notifiedToday = (r: Row) => !!r.visaLetterNotifiedAt && d(r.visaLetterNotifiedAt) === todayStr();

export default async function VisaLettersPage({ searchParams }: { searchParams: Promise<{ q?: string; view?: string }> }) {
  // §4.13 the automatic daily timer brings the queue up to date when the page is viewed (simulating
  // the scheduled job — it fires at most once per day).
  const timer = await runVisaLetterTimerIfDue();

  const sp = await searchParams;
  const q = (sp.q ?? '').trim().toLowerCase();
  const view = sp.view === 'all' ? 'all' : 'today';
  const settings = await getSettings();
  const rec = visaLetterRecipient(settings);

  const all = await loadRows();
  const destText = (r: Row) => `${EcsReference.city(r.destCity ?? '')?.name ?? ''} ${EcsReference.country(r.destCountry ?? '')?.name ?? ''}`;
  const reqs = all.filter((r) => {
    // Today's list = notified today + anything not yet notified (awaiting the next run).
    if (view === 'today' && !(notifiedToday(r) || !r.visaLetterNotifiedAt)) return false;
    if (q && !`${r.requestNumber} ${travellerName(r)} ${destText(r)}`.toLowerCase().includes(q)) return false;
    return true;
  });
  // The timer's backlog: approved requests HR has not yet been notified of.
  const pending = all.filter((r) => r.status === REQUEST_STATUS.Approved && !r.visaLetterNotifiedAt).length;
  const active = !!q;

  return (
    <div className="w-full space-y-5">
      <PageTitle id="§4.13" title="Visa Letter Notifications"
        subtitle="Travellers who requested a visa letter on an approved trip. An automatic daily timer notifies HR with the approved travel details; HR then issues / processes the visa letter." />

      {/* Automatic daily timer — no manual trigger */}
      <div className="card px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
        <div className="text-sm space-y-0.5">
          <div className="flex items-center gap-2">
            <span className="pill-info">Automatic timer</span>
            <span className="text-[var(--ecs-muted)]">Daily job · runs 02:00 — not manually triggered.</span>
          </div>
          <div><span className="text-[var(--ecs-muted)]">Notify HR:</span> <strong className="text-[var(--ecs-navy)]">{rec.office}</strong> <span className="font-mono text-xs text-[var(--ecs-muted)]">{rec.email}</span> <Link href="/settings" className="text-xs underline text-[var(--ecs-navy)] ml-1">change</Link></div>
          <div className="text-xs text-[var(--ecs-muted)]">
            Last run: <strong className="text-[var(--ecs-text)]">{dt(timer.lastRunAt)}</strong>{timer.ranNow ? ` · just ran — ${timer.sentNow} notification(s) sent to HR` : ''} · Next run: {dt(timer.nextRunAt)}
            {pending > 0 && <span> · <strong className="text-[var(--ecs-red)]">{pending}</strong> awaiting the next run</span>}
          </div>
          <div className="text-xs text-[var(--ecs-muted)]">The daily HR email includes the list below as an Excel attachment.</div>
        </div>
        <a href={`/visa-letters/export?view=${view}${sp.q ? `&q=${encodeURIComponent(sp.q)}` : ''}`} className="btn-secondary whitespace-nowrap">⬇ Download Excel</a>
      </div>

      <Card title="Filter">
        <form method="GET" className="flex flex-wrap items-end gap-3">
          <div>
            <label className="label">Show</label>
            <select name="view" defaultValue={view} className="field w-40">
              <option value="today">Today</option>
              <option value="all">All dates</option>
            </select>
          </div>
          <div className="grow min-w-56">
            <label className="label">Search</label>
            <input name="q" defaultValue={sp.q ?? ''} placeholder="traveller · request no. · destination" className="field w-full" />
          </div>
          <button className="btn-primary">Apply</button>
          {(active || view !== 'today') ? <Link href="/visa-letters" className="btn-ghost">Reset</Link> : null}
        </form>
      </Card>

      <Card title={`${view === 'today' ? "Today's visa-letter list" : 'Visa Letter Requests'} (${reqs.length})`}>
        {all.length === 0 ? <Empty>No travellers have requested a visa letter.</Empty> : reqs.length === 0 ? <Empty>{view === 'today' ? 'Nothing for today — switch to All dates to see earlier notifications.' : 'No requests match the filter.'}</Empty> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr>
                <th className="th">Request</th><th className="th">Traveller</th><th className="th">Department</th><th className="th">Destination</th>
                <th className="th">Dates</th><th className="th">Notified HR</th>
              </tr></thead>
              <tbody>
                {reqs.map((r) => (
                  <tr key={r.id} className="hover:bg-[var(--ecs-panel-2)]">
                    <td className="td"><Link href={`/requests/${r.id}`} className="font-mono text-[var(--ecs-navy)] hover:underline">{r.requestNumber}</Link></td>
                    <td className="td">{travellerName(r)}</td>
                    <td className="td">{EcsIdentity.department(r.departmentId ?? '')?.name ?? '—'}</td>
                    <td className="td">{EcsReference.city(r.destCity ?? '')?.name ?? '—'}, {EcsReference.country(r.destCountry ?? '')?.name ?? ''}</td>
                    <td className="td whitespace-nowrap">{d(r.startDate)} → {d(r.endDate)}</td>
                    <td className="td">{r.visaLetterNotifiedAt ? <span className="pill-pass">{d(r.visaLetterNotifiedAt)}</span> : <span className="text-[var(--ecs-muted)]">not yet</span>}</td>
                  </tr>
                ))}
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
