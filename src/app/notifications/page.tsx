// §37 Notifications centre — the in-app feed and the mock email outbox, both derived
// from the real audit-event stream. Each item deep-links to its request.
import Link from 'next/link';
import { listNotifications } from '@/modules/pretrip/notifications';
import { PageTitle, Card, Empty } from '@/components/ui';

export const dynamic = 'force-dynamic';
const fmt = (d: Date) => d.toISOString().slice(0, 16).replace('T', ' ');

const KIND_PILL: Record<string, string> = {
  SUBMIT: 'pill-info', APPROVE: 'pill-pass', REJECT: 'pill-exc', SENDBACK: 'pill-exc',
  STATUS: 'pill-navy', INTEGRATION: 'pill-info', TE_LINK: 'pill-navy',
};

export default async function NotificationsPage() {
  const items = await listNotifications(40);
  const emails = items.filter((i) => i.email);

  return (
    <div className="w-full space-y-5">
      <PageTitle id="§37" title="Notifications"
        subtitle="In-app alerts and the mock email outbox, derived from the request audit trail. In production these fan out to the relevant recipients with deep links; here they are generated from the same events." />

      <div className="grid lg:grid-cols-2 gap-5 items-start">
        <Card title={`In-app feed (${items.length})`}>
          {items.length === 0 ? <Empty>No notifications yet — submit or approve a request to generate activity.</Empty> : (
            <ul className="divide-y divide-[var(--ecs-border)]">
              {items.map((n) => (
                <li key={n.id} className="py-2.5 flex items-start gap-3">
                  <span className={`${KIND_PILL[n.kind] ?? 'pill-info'} shrink-0`}>{n.kind}</span>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-[var(--ecs-navy)]">{n.title}</div>
                    <div className="text-xs text-[var(--ecs-muted)]">{n.detail}</div>
                    <div className="text-xs mt-0.5">
                      <Link href={`/requests/${n.requestId}`} className="font-mono text-[var(--ecs-navy)] hover:underline">{n.requestNumber}</Link>
                      <span className="text-[var(--ecs-muted)]"> · to {n.recipient} · {fmt(n.at)}</span>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title={`Mock email outbox (${emails.length})`}>
          {emails.length === 0 ? <Empty>No emails generated.</Empty> : (
            <ul className="divide-y divide-[var(--ecs-border)]">
              {emails.map((n) => (
                <li key={n.id} className="py-2.5">
                  <div className="text-sm font-medium">{n.email!.subject}</div>
                  <div className="text-xs text-[var(--ecs-muted)]">To: {n.email!.to} · {fmt(n.at)}</div>
                  <div className="text-xs mt-0.5 text-[var(--ecs-muted)]">Re: <Link href={`/requests/${n.requestId}`} className="font-mono text-[var(--ecs-navy)] hover:underline">{n.requestNumber}</Link></div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
