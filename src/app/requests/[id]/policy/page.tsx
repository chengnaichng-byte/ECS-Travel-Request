// TR-10 Policy Review — passed checks, warnings, exceptions and hard stops (§6.3).
// A hard stop blocks submission; exceptions route to an exception approver.
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { loadRequest } from '@/modules/pretrip/queries';
import { runPolicy } from '@/modules/pretrip/actions';
import { EcsIdentity } from '@/shared/ecs/services';
import { POLICY_OUTCOME } from '@/shared/enums';
import { Card, Stepper, Empty } from '@/components/ui';
import { OutcomePill } from '@/components/StatusPill';

export const dynamic = 'force-dynamic';

const GROUPS = [
  { outcome: POLICY_OUTCOME.HardStop, title: 'Hard stops — submission blocked', note: 'Must be resolved before the request can be submitted (AC06).' },
  { outcome: POLICY_OUTCOME.Exception, title: 'Exceptions — routed for approval', note: 'Submission is allowed; an exception approver is inserted before the DOA (§6.2).' },
  { outcome: POLICY_OUTCOME.Warning, title: 'Warnings — informational', note: 'Submission is allowed with information.' },
  { outcome: POLICY_OUTCOME.Pass, title: 'Passed checks', note: '' },
];

export default async function PolicyStep({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const req = await loadRequest(id);
  if (!req) notFound();
  const checks = req.policyChecks;
  const hardStop = checks.some((c) => c.outcome === POLICY_OUTCOME.HardStop);

  return (
    <div>
      <Stepper id={id} active="policy" />
      <div className="flex justify-end mb-3">
        <form action={runPolicy.bind(null, id)}><button className="btn-secondary">Re-run checks</button></form>
      </div>

      {checks.length === 0 && <Card title="Policy Review"><Empty>No checks yet. Save charging or click “Re-run checks”.</Empty></Card>}

      <div className="space-y-4">
        {GROUPS.map((g) => {
          const items = checks.filter((c) => c.outcome === g.outcome);
          if (items.length === 0) return null;
          return (
            <Card key={g.outcome} title={g.title}>
              {g.note && <p className="text-xs text-[var(--ecs-muted)] mb-2">{g.note}</p>}
              <ul className="space-y-2">
                {items.map((c) => (
                  <li key={c.id} className="flex items-start gap-3 text-sm">
                    <OutcomePill outcome={c.outcome} />
                    <div>
                      <div className="font-medium">{c.label}{c.travellerId && <span className="text-[var(--ecs-muted)]"> · {EcsIdentity.employee(c.travellerId)?.name}</span>}</div>
                      <div className="text-xs text-[var(--ecs-muted)]">{c.detail}</div>
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          );
        })}
      </div>

      <div className="flex justify-between mt-5">
        <Link href={`/requests/${id}/charging`} className="btn-secondary">← Back</Link>
        <Link href={`/requests/${id}/review`} className={hardStop ? 'btn-secondary' : 'btn-primary'}>
          {hardStop ? 'Continue (resolve hard stops first)' : 'Continue to submit →'}
        </Link>
      </div>
    </div>
  );
}
