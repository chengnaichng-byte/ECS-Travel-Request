// #14 Upgrade Differential (M6) accounts — Setup & Maintenance. The runtime-editable master of the
// M6 accounts, grouped by Business Area, that an NTU-funded travel-class upgrade differential charges.
// Multiple accounts may exist per BA; the traveller selects which on the Charging step (a BA with one
// account auto-selects). One account per BA may be flagged the default.
import { listUpgradeAccounts } from '@/modules/pretrip/upgradeConfig';
import { createUpgradeAccountAction, toggleUpgradeAccountAction } from './actions';
import { currentPersona } from '@/shared/session';
import { ROLE } from '@/shared/enums';
import { businessAreas } from '@/data/charging';
import { PageTitle, Card } from '@/components/ui';

export const dynamic = 'force-dynamic';

export default async function UpgradeAccountsPage() {
  const persona = await currentPersona();
  const isAdmin = persona.roles.includes(ROLE.TravelAdmin) || persona.roles.includes(ROLE.SystemAdmin);
  const rows = await listUpgradeAccounts();
  const byBA = businessAreas.map((b) => ({ ba: b, items: rows.filter((r) => r.businessArea === b.code) }));

  return (
    <div className="w-full space-y-5">
      <PageTitle id="TR-26" title="Upgrade Differential (M6) accounts"
        subtitle="#14 — the M6 accounts an NTU-funded travel-class upgrade differential charges, grouped by Business Area. The traveller selects which on the Charging step; a BA with a single account auto-selects, and the derived differential posts to it." />

      {!isAdmin && <div className="card p-3 text-sm text-amber-800 bg-amber-50 border-amber-200">Switch persona to <strong>David Kumar — Travel Administrator</strong> (or System Administrator) to maintain the list. It is read-only for other roles.</div>}

      {byBA.map(({ ba, items }) => (
        <Card key={ba.code} title={`${ba.name} (${ba.code})`}>
          {items.length === 0 ? (
            <p className="text-sm text-[var(--ecs-muted)]">No M6 account configured for this business area yet — an NTU-funded upgrade here would hard-stop until one is added.</p>
          ) : (
            <table className="w-full text-sm">
              <thead><tr><th className="th">Account</th><th className="th">Name</th><th className="th">Company</th><th className="th text-center">Default</th><th className="th text-center">Status</th>{isAdmin && <th className="th text-right">Action</th>}</tr></thead>
              <tbody>
                {items.map((a) => (
                  <tr key={a.id} className="hover:bg-[var(--ecs-panel-2)]">
                    <td className="td font-medium whitespace-nowrap">{a.code}</td>
                    <td className="td">{a.name}</td>
                    <td className="td">{a.companyCode}</td>
                    <td className="td text-center">{a.isDefault ? <span className="pill-info">Default</span> : '—'}</td>
                    <td className="td text-center">{a.active ? <span className="pill-pass">Active</span> : <span className="pill-stop">Inactive</span>}</td>
                    {isAdmin && (
                      <td className="td text-right">
                        <form action={toggleUpgradeAccountAction.bind(null, a.id, !a.active)}>
                          <button className="btn-ghost text-xs">{a.active ? 'Deactivate' : 'Reactivate'}</button>
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
        <Card title="Add / update an M6 account">
          <form action={createUpgradeAccountAction} className="flex flex-wrap items-end gap-3">
            <div>
              <label className="label">Business Area</label>
              <select name="businessArea" className="field w-56" defaultValue={businessAreas[0]?.code}>
                {businessAreas.map((b) => <option key={b.code} value={b.code}>{b.name} ({b.code})</option>)}
              </select>
            </div>
            <div>
              <label className="label">Account code</label>
              <input name="code" className="field w-40" placeholder="e.g. M6-CS" required />
            </div>
            <div>
              <label className="label">Account name</label>
              <input name="name" className="field w-72" placeholder="NTU-Funded Upgrade Differential" required />
            </div>
            <div>
              <label className="label">Company</label>
              <input name="companyCode" className="field w-24" defaultValue="1000" />
            </div>
            <label className="flex items-center gap-2 text-sm pb-2"><input type="checkbox" name="isDefault" className="w-4 h-4" /> Default for this BA</label>
            <button className="btn-primary">Save account</button>
          </form>
          <p className="text-xs text-[var(--ecs-muted)] mt-2">Re-using an existing code updates it (and reactivates it). Flagging a default clears the flag on the other accounts in that business area.</p>
        </Card>
      )}
    </div>
  );
}
