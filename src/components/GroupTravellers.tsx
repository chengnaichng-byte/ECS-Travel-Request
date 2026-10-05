// §13.14 Group travellers panel (simplified): named travellers each with their derived
// cost share. All group travellers follow ONE shared itinerary, date range and travel class
// — there are no per-traveller deviations (sub-itineraries / class overrides), and no
// inclusion-confirmation gate (confirmation is handled offline). Add/remove a traveller is a
// material amendment once the request is approved.
import { computeTravellerShares } from '@/modules/pretrip/group';
import { fmtSgd } from '@/modules/pretrip/pricing';
import { EcsIdentity } from '@/shared/ecs/services';
import { employees } from '@/data/employees';
import { addGroupTraveller, removeGroupTraveller } from '@/modules/pretrip/actions';
import { isFreeEditState, isAmendableState } from '@/modules/pretrip/amend';
import { Card } from './ui';
import type { FullRequest } from '@/modules/pretrip/queries';

export function GroupTravellers({ req }: { req: FullRequest }) {
  const shares = computeTravellerShares(req);
  const isDraft = isFreeEditState(req.status);
  const canEdit = isDraft || isAmendableState(req.status);   // add/remove allowed here
  const amendOnEdit = canEdit && !isDraft;                   // editing triggers reapproval (§13.14)
  const candidates = employees.filter((e) => e.isTraveller && !req.travellers.some((t) => t.employeeId === e.id));

  return (
    <Card title={`Group Travellers (${req.travellers.length})`}>
      <p className="text-xs text-[var(--ecs-muted)] mb-3">All travellers share one itinerary, date range and travel class; the cost is apportioned to each traveller&apos;s share. Traveller inclusion is confirmed offline (no in-system confirmation step).</p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr>
            <th className="th">Traveller</th><th className="th">Department</th>
            <th className="th text-right">Individual</th><th className="th text-right">Shared</th>
            <th className="th text-right">Share</th><th className="th"></th>
          </tr></thead>
          <tbody>
            {shares.map((s) => {
              const row = req.travellers.find((t) => t.employeeId === s.employeeId)!;
              return (
                <tr key={s.employeeId} className="hover:bg-[var(--ecs-panel-2)]">
                  <td className="td font-medium">{s.name}{row.isRequestor && <span className="pill-navy ml-1">Requestor</span>}</td>
                  <td className="td text-xs text-[var(--ecs-muted)]">{s.department}</td>
                  <td className="td text-right">{fmtSgd(s.individualSgd)}</td>
                  <td className="td text-right">{fmtSgd(s.sharedSgd)}</td>
                  <td className="td text-right whitespace-nowrap">{fmtSgd(s.totalSgd)} <span className="text-xs text-[var(--ecs-muted)]">({s.pct.toFixed(0)}%)</span></td>
                  <td className="td text-right">
                    {canEdit && req.travellers.length > 2 && (
                      <form action={removeGroupTraveller.bind(null, req.id, row.id)}><button className="btn-ghost text-xs">Remove</button></form>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="font-semibold text-[var(--ecs-navy)]">
              <td className="td" colSpan={4}>Total ({req.travellers.length} travellers)</td>
              <td className="td text-right">{fmtSgd(shares.reduce((a, s) => a + s.totalSgd, 0))}</td>
              <td className="td"></td>
            </tr>
          </tfoot>
        </table>
      </div>

      {amendOnEdit && (
        <p className="mt-3 text-xs text-amber-700">Adding or removing a traveller now is a <strong>material amendment</strong> — it releases/adds the share, re-derives the approval route and restarts reapproval (§13.14).</p>
      )}

      {canEdit && candidates.length > 0 && (
        <form action={addGroupTraveller.bind(null, req.id)} className="mt-4 flex items-end gap-2">
          <div>
            <label className="label">Add traveller</label>
            <select name="employeeId" className="field">
              {candidates.map((e) => <option key={e.id} value={e.id}>{e.name} — {EcsIdentity.department(e.departmentId)?.name}</option>)}
            </select>
          </div>
          <button className="btn-secondary">Add</button>
        </form>
      )}
    </Card>
  );
}
