// §13.19 Travel Policy Group master (travel eligibility) — Setup & Maintenance. The reusable ECS
// master that defines, per policy group, the entitled travel class by flight-duration band, and
// whether the group ATTRACTS M6. Entitlement is read-only here (it is the reference definition); the
// M6 flag is runtime-editable, because M6 is an ENTITLEMENT differential (Economy → the entitled
// class, funded from an M6 account) — not a traveller-requested upgrade.
import { listPolicyGroups } from '@/modules/pretrip/policyGroups';
import { togglePolicyGroupM6Action } from './actions';
import { currentPersona } from '@/shared/session';
import { ROLE } from '@/shared/enums';
import { travelClasses } from '@/data/travelClass';
import { PageTitle, Card } from '@/components/ui';

export const dynamic = 'force-dynamic';

const className = (id: string) => travelClasses.find((c) => c.id === id)?.name ?? id;
const tierText = (tiers: { minHours: number; classId: string }[]) =>
  tiers.length
    ? [...tiers].sort((a, b) => a.minHours - b.minHours).map((t) => `${className(t.classId)} ≥ ${t.minHours}h`).join(' · ')
    : 'Economy — all durations';

export default async function PolicyGroupsPage() {
  const persona = await currentPersona();
  const isAdmin = persona.roles.includes(ROLE.TravelAdmin) || persona.roles.includes(ROLE.SystemAdmin);
  const groups = await listPolicyGroups();
  const m6Count = groups.filter((g) => g.m6).length;

  return (
    <div className="w-full space-y-5">
      <PageTitle id="TR-28" title="Travel policy groups"
        subtitle="§13.19 — the ECS travel eligibility master. Each policy group sets the entitled travel class by flight-duration band (read-only reference) and whether it attracts M6. M6 is an entitlement differential — the Economy → entitled-class portion, funded automatically from an M6 account when the group is flagged. A class ABOVE entitlement is a separate policy exception, not M6." />

      {!isAdmin && <div className="card p-3 text-sm text-amber-800 bg-amber-50 border-amber-200">Switch persona to <strong>David Kumar — Travel Administrator</strong> (or System Administrator) to change the M6 flag. It is read-only for other roles.</div>}

      <Card title={`Policy groups (${groups.length}) — ${m6Count} attract${m6Count === 1 ? 's' : ''} M6`}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr>
              <th className="th">Group</th>
              <th className="th">Description</th>
              <th className="th">Entitled class by duration</th>
              <th className="th text-center">Attracts M6</th>
              {isAdmin && <th className="th text-right">Action</th>}
            </tr></thead>
            <tbody>
              {groups.map((g) => (
                <tr key={g.code} className="hover:bg-[var(--ecs-panel-2)]">
                  <td className="td font-medium whitespace-nowrap">{g.code}</td>
                  <td className="td text-[var(--ecs-muted)]">{g.description}</td>
                  <td className="td text-xs text-[var(--ecs-muted)]">{tierText(g.tiers)}</td>
                  <td className="td text-center">{g.m6
                    ? <span className="pill-info">M6</span>
                    : <span className="text-[var(--ecs-muted)]">—</span>}</td>
                  {isAdmin && (
                    <td className="td text-right">
                      <form action={togglePolicyGroupM6Action.bind(null, g.code, !g.m6)} className="inline">
                        <button className="btn-ghost text-xs">{g.m6 ? 'Remove M6' : 'Set M6'}</button>
                      </form>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-[var(--ecs-muted)] mt-3">When a group attracts M6 and its entitlement is above Economy, each airfare flown at the entitlement splits into an <b>Economy base</b> (on the normal cost object) and an <b>M6 differential</b> (Economy → the entitled class), charged to an M6 account for the governing business area — automatically, with no justification. The split amount is derived from the <a className="underline" href="/setup/upgrade-rates">class uplift rates</a>; the account comes from <a className="underline" href="/setup/upgrade-accounts">M6 Accounts</a>.</p>
      </Card>
    </div>
  );
}
