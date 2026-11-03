// §4.4 Purpose Cost Items — Setup & Maintenance. The per-travel-purpose cost-item profile that drives
// the purpose-driven auto-population on Estimates (staff). Each purpose lists its "possible cost
// items"; a declarable item's standard cost pre-fills its line. Accommodation and ODA are
// policy-computed (standard cost ignored); airfare keeps its own form. Admin-editable.
import { prisma } from '@/shared/db';
import { currentPersona } from '@/shared/session';
import { ROLE } from '@/shared/enums';
import { travelPurposes } from '@/data/travelPurposes';
import { expenseTypes } from '@/data/expenseTypes';
import { PageTitle, Card } from '@/components/ui';
import { setPurposeItemCost, removePurposeItem, addPurposeItem } from './actions';

export const dynamic = 'force-dynamic';

const COMPUTED = new Set(['ET-ACC', 'ET-ODA']); // policy-computed — standard cost ignored
const OWN_FLOW = new Set(['ET-AIR']);            // airfare has its own form — not engine-prefilled
const etName = (id: string) => expenseTypes.find((t) => t.id === id)?.name ?? id;
const fmt = (n: number | null) => (n == null ? '—' : `$${n.toLocaleString('en-SG')}`);

export default async function PurposeItemsPage() {
  const persona = await currentPersona();
  const isAdmin = persona.roles.includes(ROLE.TravelAdmin) || persona.roles.includes(ROLE.SystemAdmin);
  const rows = await prisma.purposeCostItem.findMany({ orderBy: [{ purposeId: 'asc' }, { sortOrder: 'asc' }] });
  const byPurpose = new Map<string, typeof rows>();
  for (const r of rows) { const a = byPurpose.get(r.purposeId) ?? []; a.push(r); byPurpose.set(r.purposeId, a); }
  // Show every active purpose (those without a profile render an empty one, ready to add items).
  const purposes = travelPurposes.filter((p) => p.active);

  return (
    <div className="w-full space-y-5">
      <PageTitle id="TR-29" title="Purpose cost items"
        subtitle="§4.4 — per travel purpose, the cost items that auto-populate the Estimates step for staff. Accommodation and ODA are policy-computed; the declarable items (incidentals) pre-create a line defaulted to the standard cost below. Guests and students always get airfare and accommodation only. Behaviour is governed by the “Purpose-driven cost items” module setting." />

      {!isAdmin && <div className="card p-3 text-sm text-amber-800 bg-amber-50 border-amber-200">Switch persona to <strong>David Kumar — Travel Administrator</strong> (or System Administrator) to edit. Read-only for other roles.</div>}

      {purposes.map((p) => {
        const items = byPurpose.get(p.id) ?? [];
        const used = new Set(items.map((i) => i.expenseTypeId));
        const addable = expenseTypes.filter((t) => t.preTripApplicable && !used.has(t.id));
        return (
          <Card key={p.id} title={`${p.name} (${items.length} item${items.length === 1 ? '' : 's'})`}>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr>
                  <th className="th">Cost item</th>
                  <th className="th">Treatment</th>
                  <th className="th">Standard cost (SGD)</th>
                  {isAdmin && <th className="th text-right">Action</th>}
                </tr></thead>
                <tbody>
                  {items.length === 0 && <tr><td className="td text-[var(--ecs-muted)]" colSpan={isAdmin ? 4 : 3}>No cost items configured for this purpose.</td></tr>}
                  {items.map((it) => {
                    const computed = COMPUTED.has(it.expenseTypeId);
                    const ownFlow = OWN_FLOW.has(it.expenseTypeId);
                    const treatment = computed ? 'Policy-computed' : ownFlow ? 'Airfare form' : 'Declarable — pre-filled';
                    const costEditable = isAdmin && !computed && !ownFlow;
                    return (
                      <tr key={it.id} className="hover:bg-[var(--ecs-panel-2)]">
                        <td className="td font-medium whitespace-nowrap">{etName(it.expenseTypeId)} <span className="text-[var(--ecs-muted)] font-normal text-xs">({it.expenseTypeId})</span></td>
                        <td className="td"><span className={computed ? 'pill-info' : ownFlow ? 'pill-navy' : 'pill-pass'}>{treatment}</span></td>
                        <td className="td">
                          {costEditable ? (
                            <form action={setPurposeItemCost.bind(null, it.id)} className="flex items-center gap-2">
                              <span className="text-[var(--ecs-muted)]">$</span>
                              <input name="standardCostSgd" type="number" min="0" step="1" defaultValue={it.standardCostSgd ?? ''} placeholder="0" className="field w-28" />
                              <button className="btn-ghost text-xs">Save</button>
                            </form>
                          ) : (
                            <span className="text-[var(--ecs-muted)]">{computed || ownFlow ? 'n/a' : fmt(it.standardCostSgd)}</span>
                          )}
                        </td>
                        {isAdmin && (
                          <td className="td text-right">
                            <form action={removePurposeItem.bind(null, it.id)} className="inline"><button className="btn-ghost text-xs text-[var(--ecs-red)]">Remove</button></form>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {isAdmin && addable.length > 0 && (
              <form action={addPurposeItem.bind(null, p.id)} className="flex flex-wrap items-end gap-2 mt-3 pt-3 border-t border-[var(--ecs-border)]">
                <div>
                  <label className="label">Add cost item</label>
                  <select name="expenseTypeId" className="field w-72 max-w-full" defaultValue="">
                    <option value="" disabled>Select an expense type…</option>
                    {addable.map((t) => <option key={t.id} value={t.id}>{t.name}{t.isMajorCost ? '' : ' (incidental)'}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">Standard cost (SGD)</label>
                  <input name="standardCostSgd" type="number" min="0" step="1" placeholder="0 (optional)" className="field w-40" />
                </div>
                <button className="btn-secondary text-sm">＋ Add</button>
              </form>
            )}
          </Card>
        );
      })}
    </div>
  );
}
