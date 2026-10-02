// TR-09 Charging & Allocation — reuse ECS charging (Company Code, Business Area,
// CC/WBS). Submission is blocked unless allocations total 100% (AC06).
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { loadRequest } from '@/modules/pretrip/queries';
import { saveCharging } from '@/modules/pretrip/actions';
import { getSettings } from '@/modules/pretrip/settings';
import { chargingCodes } from '@/data/charging';
import { EcsIdentity } from '@/shared/ecs/services';
import { Card, Stepper } from '@/components/ui';

export const dynamic = 'force-dynamic';

export default async function ChargingStep({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const req = await loadRequest(id);
  if (!req) notFound();
  const settings = await getSettings();
  const amountMode = settings.chargingSplitMode === 'AMOUNT'; // §17
  const existing = req.allocations;
  const total = existing.reduce((s, a) => s + a.percent, 0);
  // §7 pre-fill the first row with the traveller's default charging code on a fresh request.
  const defaultCC = existing.length === 0 ? EcsIdentity.employee(req.travellerId)?.defaultChargingCode ?? '' : '';

  return (
    <div>
      <Stepper id={id} active="charging" />
      <form action={saveCharging.bind(null, id)}>
        <Card title="Charging & Cost Allocation">
          <p className="text-xs text-[var(--ecs-muted)] mb-3">Add one or more CC / WBS allocations. The split must total 100%. Research WBS drives the research approval route; the highest-share department derives the DOA (§13.14).</p>
          <div className="space-y-3">
            {[0, 1, 2, 3, 4].map((i) => {
              const row = existing[i];
              return (
                <div key={i} className="grid grid-cols-[1fr_140px] gap-3 items-end">
                  <div>
                    <label className="label">Charging code {i + 1}</label>
                    <select name={`code_${i}`} defaultValue={row?.chargingCode ?? (i === 0 ? defaultCC : '')} className="field">
                      <option value="">— none —</option>
                      {chargingCodes.map((c) => <option key={c.code} value={c.code} disabled={c.active === false && row?.chargingCode !== c.code}>{c.code} — {c.name} {c.isResearch ? '(research)' : ''}{c.active === false ? ' — CLOSED' : ''}</option>)}
                    </select>
                  </div>
                  {amountMode ? (
                    <div>
                      <label className="label">Amount (SGD)</label>
                      <input name={`amt_${i}`} type="number" step="any" defaultValue={row?.amountSgd != null ? String(row.amountSgd) : ''} className="field" placeholder="SGD" />
                    </div>
                  ) : (
                    <div>
                      <label className="label">Percent</label>
                      <input name={`pct_${i}`} type="number" step="any" defaultValue={row ? String(row.percent) : ''} className="field" placeholder="%" />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <div className="mt-3 text-sm">Current saved total: <span className={total === 100 ? 'text-emerald-700 font-semibold' : 'text-amber-700 font-semibold'}>{total}%</span></div>
        </Card>
        <div className="flex justify-between mt-5">
          <Link href={`/requests/${id}/estimates`} className="btn-secondary">← Back</Link>
          <button type="submit" className="btn-primary">Save & run policy review →</button>
        </div>
      </form>
    </div>
  );
}
