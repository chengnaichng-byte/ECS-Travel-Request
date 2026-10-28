// #14 Upgrade Uplift Rates — Setup & Maintenance. The runtime-editable class-step uplift % schedule
// (Model B). The NTU-funded travel-class upgrade differential is DERIVED from the chosen fare:
// entitlement = chosen fare / (1 + uplift %), so delta = chosen − entitlement. Different steps carry
// different uplifts (e.g. Economy→Premium vs Premium→Business). A step with no active rate blocks the
// airfare add until a rate is configured.
import { listUpliftRates } from '@/modules/pretrip/upgradeConfig';
import { saveUpliftRateAction, toggleUpliftRateAction } from './actions';
import { currentPersona } from '@/shared/session';
import { ROLE } from '@/shared/enums';
import { travelClasses } from '@/data/travelClass';
import { PageTitle, Card } from '@/components/ui';

export const dynamic = 'force-dynamic';

const className = (id: string) => travelClasses.find((c) => c.id === id)?.name ?? id;

export default async function UpgradeRatesPage() {
  const persona = await currentPersona();
  const isAdmin = persona.roles.includes(ROLE.TravelAdmin) || persona.roles.includes(ROLE.SystemAdmin);
  const rows = await listUpliftRates();
  // every valid upward class step (to a higher rank), with its configured rate (if any)
  const steps = travelClasses.flatMap((from) => travelClasses.filter((to) => to.rank > from.rank).map((to) => ({ from, to, rate: rows.find((r) => r.fromClassId === from.id && r.toClassId === to.id) })));

  return (
    <div className="w-full space-y-5">
      <PageTitle id="TR-27" title="Upgrade uplift rates"
        subtitle="#14 (Model B) — the uplift % per class step used to derive a travel-class upgrade differential: entitlement = chosen fare ÷ (1 + uplift %), so the differential = chosen − entitlement. Different steps carry different uplifts." />

      {!isAdmin && <div className="card p-3 text-sm text-amber-800 bg-amber-50 border-amber-200">Switch persona to <strong>David Kumar — Travel Administrator</strong> (or System Administrator) to maintain the schedule. It is read-only for other roles.</div>}

      <Card title="Class-step uplift schedule">
        <table className="w-full text-sm">
          <thead><tr><th className="th">Class step</th><th className="th text-right">Uplift %</th><th className="th">Example (chosen SGD 3,000)</th><th className="th text-center">Status</th>{isAdmin && <th className="th text-right">Action</th>}</tr></thead>
          <tbody>
            {steps.map(({ from, to, rate }) => {
              const ent = rate ? Math.round(3000 / (1 + rate.pct)) : null;
              return (
                <tr key={`${from.id}-${to.id}`} className="hover:bg-[var(--ecs-panel-2)]">
                  <td className="td font-medium whitespace-nowrap">{from.name} → {to.name}</td>
                  <td className="td text-right tabular-nums">{rate ? `${Math.round(rate.pct * 100)}%` : <span className="text-amber-700">not set</span>}</td>
                  <td className="td text-xs text-[var(--ecs-muted)]">{ent != null ? `entitlement SGD ${ent.toLocaleString('en-SG')}, differential SGD ${(3000 - ent).toLocaleString('en-SG')}` : '—'}</td>
                  <td className="td text-center">{rate ? (rate.active ? <span className="pill-pass">Active</span> : <span className="pill-stop">Inactive</span>) : <span className="pill-stop">Not set</span>}</td>
                  {isAdmin && (
                    <td className="td text-right">
                      {rate && (
                        <form action={toggleUpliftRateAction.bind(null, rate.id, !rate.active)} className="inline">
                          <button className="btn-ghost text-xs">{rate.active ? 'Deactivate' : 'Reactivate'}</button>
                        </form>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>

      {isAdmin && (
        <Card title="Add / update a rate">
          <form action={saveUpliftRateAction} className="flex flex-wrap items-end gap-3">
            <div>
              <label className="label">From class (entitlement)</label>
              <select name="fromClassId" className="field w-48" defaultValue="TC-ECO">
                {travelClasses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="label">To class (chosen)</label>
              <select name="toClassId" className="field w-48" defaultValue="TC-BIZ">
                {travelClasses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Uplift % over entitlement</label>
              <input name="pctPercent" type="number" step="any" min="0" className="field w-32" placeholder="e.g. 50" required />
            </div>
            <button className="btn-primary">Save rate</button>
          </form>
          <p className="text-xs text-[var(--ecs-muted)] mt-2">The uplift is a percentage over the entitlement fare — {className('TC-ECO')} → {className('TC-PEY')} at 50% means Premium Economy = Economy × 1.5, so entitlement = chosen ÷ 1.5. Re-using a class step updates its rate (and reactivates it).</p>
        </Card>
      )}
    </div>
  );
}
