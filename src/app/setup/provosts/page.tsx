// §8 / DD-25 Provost List — Setup & Maintenance. The per-school provosts who may authorise a
// guest (non-employee) travel-class upgrade. Admin can add a provost (school + approver) and
// activate / deactivate entries; the active rows for a host school are offered on the guest
// airfare form and the selected provost is routed ahead of the host DOA.
import { listProvosts } from '@/modules/pretrip/provost';
import { createProvostAction, toggleProvostAction } from './actions';
import { currentPersona } from '@/shared/session';
import { EcsIdentity } from '@/shared/ecs/services';
import { ROLE } from '@/shared/enums';
import { departments } from '@/data/organisation';
import { employees } from '@/data/employees';
import { PageTitle, Card } from '@/components/ui';

export const dynamic = 'force-dynamic';

export default async function ProvostsPage() {
  const persona = await currentPersona();
  const isAdmin = persona.roles.includes(ROLE.TravelAdmin) || persona.roles.includes(ROLE.SystemAdmin);
  const rows = await listProvosts();
  // Candidate approvers — senior, non-traveller staff (deans / directors / provost).
  const candidates = employees.filter((e) => !e.isTraveller && e.travelPolicyGroup === 'SENIOR');

  const bySchool = departments.map((d) => ({ dept: d, items: rows.filter((r) => r.schoolId === d.id) }));

  return (
    <div className="w-full space-y-5">
      <PageTitle id="TR-25" title="Provost List — guest travel-class upgrades"
        subtitle="§8 / DD-25 — the per-school provosts who authorise a guest booked above Economy. Active entries for the host school are offered on the guest airfare form; the selected provost approves the upgrade ahead of the host DOA." />

      {!isAdmin && <div className="card p-3 text-sm text-amber-800 bg-amber-50 border-amber-200">Switch persona to <strong>David Kumar — Travel Administrator</strong> (or System Administrator) to maintain the list. It is read-only for other roles.</div>}

      {bySchool.map(({ dept, items }) => (
        <Card key={dept.id} title={`${dept.name} (${dept.id})`}>
          {items.length === 0 ? (
            <p className="text-sm text-[var(--ecs-muted)]">No provost configured for this school yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead><tr><th className="th">Provost / authority</th><th className="th">Title</th><th className="th text-center">Status</th>{isAdmin && <th className="th text-right">Action</th>}</tr></thead>
              <tbody>
                {items.map((p) => (
                  <tr key={p.id} className="hover:bg-[var(--ecs-panel-2)]">
                    <td className="td font-medium">{p.name}</td>
                    <td className="td text-xs text-[var(--ecs-muted)]">{p.title}</td>
                    <td className="td text-center">{p.active ? <span className="pill-pass">Active</span> : <span className="pill-stop">Inactive</span>}</td>
                    {isAdmin && (
                      <td className="td text-right">
                        <form action={toggleProvostAction.bind(null, p.id, !p.active)}>
                          <button className="btn-ghost text-xs">{p.active ? 'Deactivate' : 'Reactivate'}</button>
                        </form>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      ))}

      {isAdmin && (
        <Card title="Add a provost">
          <form action={createProvostAction} className="flex flex-wrap items-end gap-3">
            <div>
              <label className="label">School</label>
              <select name="schoolId" className="field w-72" defaultValue={departments[0]?.id}>
                {departments.map((d) => <option key={d.id} value={d.id}>{d.name} ({d.id})</option>)}
              </select>
            </div>
            <div>
              <label className="label">Provost / authorising officer</label>
              <select name="approverId" className="field w-72" defaultValue={candidates[0]?.id}>
                {candidates.map((e) => <option key={e.id} value={e.id}>{e.name} · {e.title} ({EcsIdentity.department(e.departmentId)?.name ?? e.departmentId})</option>)}
              </select>
            </div>
            <button className="btn-primary">Add provost</button>
          </form>
          <p className="text-xs text-[var(--ecs-muted)] mt-2">Adding an approver already present for a school reactivates it. Provost governance / source is an open item (O-6).</p>
        </Card>
      )}
    </div>
  );
}
