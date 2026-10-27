// TR-10 Policy Review — passed checks, warnings, exceptions and hard stops (§6.3).
// A hard stop blocks submission; exceptions route to an exception approver.
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { loadRequest } from '@/modules/pretrip/queries';
import { runPolicy, resolveJustifications } from '@/modules/pretrip/actions';
import { EcsIdentity, EcsReference } from '@/shared/ecs/services';
import { currentPersonaId } from '@/shared/session';
import { canEditRequest } from '@/modules/pretrip/guards';
import { travelClasses } from '@/data/travelClass';
import { POLICY_OUTCOME, REQUEST_STATUS } from '@/shared/enums';
import { Card, Stepper, Empty } from '@/components/ui';
import { DuplicateWarning } from '@/components/DuplicateWarning';
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

  // §6.3 justifications that can be resolved inline here (all at once), instead of going back a step.
  const canEdit = canEditRequest(await currentPersonaId(), req) && (req.status === REQUEST_STATUS.Draft || req.status === REQUEST_STATUS.SentBack);
  const className = (cid?: string | null) => travelClasses.find((c) => c.id === cid)?.name ?? cid ?? '';
  const cityName = (code: string) => EcsReference.city(code)?.name ?? code;
  const needClassJustification = checks.some((c) => c.code === 'CLASS_JUSTIFY');
  const aboveCapHotels = req.expenses.filter((e) => e.accommodation && e.accommodation.exceptionOutcome === POLICY_OUTCOME.Exception && !(e.notes ?? '').trim());
  const canResolve = canEdit && (needClassJustification || aboveCapHotels.length > 0);

  return (
    <div>
      <Stepper id={id} active="policy" requestNumber={req.requestNumber} status={req.status} />
      <DuplicateWarning req={req} />
      <div className="flex justify-end mb-3">
        <form action={runPolicy.bind(null, id)}><button className="btn-secondary">Re-run checks</button></form>
      </div>

      {/* §6.3 Resolve the outstanding justifications here, all at once — no need to go back a step. */}
      {canResolve && (
        <Card title="Resolve to submit — justification required" className="mb-4">
          <p className="text-xs text-[var(--ecs-muted)] mb-3">Enter the justification for each item below and save. The checks re-run and these hard stops clear, without leaving this page. Exceptions still route to an approver.</p>
          <form action={resolveJustifications.bind(null, id)} className="space-y-4">
            {needClassJustification && (
              <div>
                <label className="label">Travel-class upgrade — <strong>{className(req.travelClassId)}</strong> is above your <strong>{className(req.entitledClassId) || 'entitlement'}</strong></label>
                <p className="text-xs text-[var(--ecs-muted)] mb-1">A cabin above your entitlement requires a justification; the upgrade then routes to an approver.</p>
                <textarea name="classJustification" defaultValue={req.classJustification ?? ''} rows={2} required className="field" placeholder="e.g. overnight red-eye ahead of a same-day event; medical reason…" />
              </div>
            )}
            {aboveCapHotels.map((e) => (
              <div key={e.id}>
                <label className="label">Accommodation above cap — <strong>{cityName(e.accommodation!.city)}</strong>: SGD {e.accommodation!.quotedNightly}/night exceeds the cap SGD {e.accommodation!.capNightly}/night{e.travellerId ? ` (${EcsIdentity.employee(e.travellerId)?.name})` : ''}</label>
                <p className="text-xs text-[var(--ecs-muted)] mb-1">A rate above the cap requires a justification; it then routes to an approver.</p>
                <textarea name={`hotelNote_${e.id}`} defaultValue={e.notes ?? ''} rows={2} required className="field" placeholder="e.g. conference venue hotel — cheaper options are 45+ min away…" />
              </div>
            ))}
            <button className="btn-primary">Save justifications &amp; re-run checks</button>
          </form>
        </Card>
      )}

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
        <div className="flex gap-2">
          {(req.status === 'Draft' || req.status === 'Sent Back') && <Link href="/dashboard" className="btn-secondary" title="This request is saved as a draft — return to the dashboard and finish later">Save as draft</Link>}
          <Link href={`/requests/${id}/review`} className={hardStop ? 'btn-secondary' : 'btn-primary'}>
            {hardStop ? 'Continue (resolve hard stops first)' : 'Continue to submit →'}
          </Link>
        </div>
      </div>
    </div>
  );
}
