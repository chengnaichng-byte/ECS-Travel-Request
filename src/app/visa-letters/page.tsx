// §4.13 Visa Letter Notifications — the travellers who requested a visa letter. An AUTOMATIC daily
// timer (02:00, not manually triggered) notifies HR — the configured HR officer — of every approved
// visa-letter request not yet notified. A multi-city trip across several countries is listed once PER
// country (one visa letter per country). The page shows TODAY's list by default and offers the Excel
// attachment that accompanies the HR email.
import Link from 'next/link';
import { prisma } from '@/shared/db';
import { visaLetterRecipient } from '@/config/visaLetter';
import { getSettings } from '@/modules/pretrip/settings';
import { runVisaLetterTimerIfDue } from '@/modules/pretrip/actions';
import { buildVisaLetterRecords } from '@/modules/pretrip/visaLetterNotice';
import { REQUEST_STATUS } from '@/shared/enums';
import { PageTitle, Card, Empty } from '@/components/ui';

export const dynamic = 'force-dynamic';
const d = (x: Date | null) => (x ? x.toISOString().slice(0, 10) : '—');
const dt = (x: Date | null) => (x ? x.toISOString().slice(0, 16).replace('T', ' ') : '—');
const todayStr = () => new Date().toISOString().slice(0, 10);

async function loadRows() {
  return prisma.travelRequest.findMany({
    where: { visaLetterRequired: true },
    orderBy: { updatedAt: 'desc' },
    include: {
      allocations: true,
      legs: true,
      versions: { where: { reason: 'SUBMISSION' }, orderBy: { createdAt: 'asc' }, take: 1 },
      messages: { where: { kind: 'VISA_LETTER' }, orderBy: { createdAt: 'desc' } },
    },
  });
}
type Row = Awaited<ReturnType<typeof loadRows>>[number];
const notifiedToday = (r: Row) => !!r.visaLetterNotifiedAt && d(r.visaLetterNotifiedAt) === todayStr();

export default async function VisaLettersPage({ searchParams }: { searchParams: Promise<{ q?: string; view?: string }> }) {
  const timer = await runVisaLetterTimerIfDue();
  const sp = await searchParams;
  const q = (sp.q ?? '').trim().toLowerCase();
  const view = sp.view === 'all' ? 'all' : 'today';
  const settings = await getSettings();
  const rec = visaLetterRecipient(settings);

  const all = await loadRows();
  // One entry per (request, country) — a multi-country trip is repeated per country.
  const items = all.flatMap((req) => buildVisaLetterRecords(req).map((r) => ({ req, r })));
  const rows = items.filter(({ req, r }) => {
    if (view === 'today' && !(notifiedToday(req) || !req.visaLetterNotifiedAt)) return false;
    if (q && !`${r.preTripRequestBookingId} ${r.employeeName} ${r.destinationCity}`.toLowerCase().includes(q)) return false;
    return true;
  });
  const pending = all.filter((r) => r.status === REQUEST_STATUS.Approved && !r.visaLetterNotifiedAt).length;
  const active = !!q;

  return (
    <div className="w-full space-y-5">
      <PageTitle id="§4.13" title="Visa Letter Notifications"
        subtitle="Travellers who requested a visa letter on an approved trip. An automatic daily timer notifies HR with the approved travel details; a multi-city trip across several countries is listed once per country (one visa letter each). HR then issues / processes the visa letter." />

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

      <Card title={`${view === 'today' ? "Today's visa-letter list" : 'Visa Letter Requests'} (${rows.length})`}>
        {items.length === 0 ? <Empty>No travellers have requested a visa letter.</Empty> : rows.length === 0 ? <Empty>{view === 'today' ? 'Nothing for today — switch to All dates to see earlier notifications.' : 'No requests match the filter.'}</Empty> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr>
                <th className="th">Request</th><th className="th">Traveller</th><th className="th">WBS / Cost Centre</th>
                <th className="th">Destination City</th><th className="th">Trip dates</th><th className="th">Submitted</th><th className="th">Notified HR</th>
              </tr></thead>
              <tbody>
                {rows.map(({ req, r }, i) => (
                  <tr key={`${req.id}-${i}`} className="hover:bg-[var(--ecs-panel-2)]">
                    <td className="td"><Link href={`/requests/${req.id}`} className="font-mono text-[var(--ecs-navy)] hover:underline">{r.preTripRequestBookingId}</Link></td>
                    <td className="td">{r.employeeName}</td>
                    <td className="td text-xs">{r.wbsCostCentre}</td>
                    <td className="td">{r.destinationCity}</td>
                    <td className="td whitespace-nowrap">{r.tripDates}</td>
                    <td className="td whitespace-nowrap">{r.travelerSubmitDate}</td>
                    <td className="td">{req.visaLetterNotifiedAt ? <span className="pill-pass">{d(req.visaLetterNotifiedAt)}</span> : <span className="text-[var(--ecs-muted)]">not yet</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {rows.some(({ req }) => req.messages.length > 0) && (
        <Card title="Generated Notifications to HR (§4.13 content)">
          <div className="space-y-4">
            {[...new Map(rows.map(({ req }) => [req.id, req])).values()].flatMap((req) => req.messages.map((m) => {
              let city = ''; try { city = JSON.parse(m.payload).destinationCity ?? ''; } catch { /* ignore */ }
              return (
                <div key={m.id}>
                  <div className="text-xs text-[var(--ecs-muted)] mb-1">{req.requestNumber}{city ? ` · ${city}` : ''}</div>
                  <pre className="text-xs bg-[var(--ecs-panel-2)] p-3 rounded overflow-x-auto border border-[var(--ecs-border)]">{m.payload}</pre>
                </div>
              );
            }))}
          </div>
        </Card>
      )}
    </div>
  );
}
