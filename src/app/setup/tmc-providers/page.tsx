// §7.5 Multi-TMC provider registry — Setup & Maintenance. The runtime-editable master of the Travel
// Management Companies a travel request can route to. Add / deactivate / reactivate / remove a
// provider; routing, the Trip booking-arrangement picker and the Configuration Viewer read this live
// list. Seeded once from src/data/tmcProviders.ts.
import { listTmcProviderRows } from '@/modules/pretrip/tmcConfig';
import { createTmcProviderAction, toggleTmcProviderAction, deleteTmcProviderAction } from './actions';
import { currentPersona } from '@/shared/session';
import { ROLE, BOOKING_METHOD, BOOKING_METHOD_LABEL } from '@/shared/enums';
import { PageTitle, Card } from '@/components/ui';

export const dynamic = 'force-dynamic';

const TMC_METHODS = [BOOKING_METHOD.TMCOnline, BOOKING_METHOD.AgentAssisted, BOOKING_METHOD.Offline];
const methodLabels = (csv: string) => csv.split(',').map((m) => m.trim()).filter(Boolean).map((m) => BOOKING_METHOD_LABEL[m] ?? m).join(', ') || '—';
const roleOf = (r: { isDefault: boolean; highRiskOnly: boolean }) => r.isDefault ? 'Default' : r.highRiskOnly ? 'High-risk desk' : 'Regional';

export default async function TmcProvidersPage() {
  const persona = await currentPersona();
  const isAdmin = persona.roles.includes(ROLE.TravelAdmin) || persona.roles.includes(ROLE.SystemAdmin);
  const rows = await listTmcProviderRows();

  return (
    <div className="w-full space-y-5">
      <PageTitle id="TR-27" title="TMC providers (multi-TMC registry)"
        subtitle="§7.5 — the Travel Management Companies a request can route to. A request routes to ONE provider: an explicit preference wins, else the high-risk specialist desk, else a regional provider covering the destination, else the default. Routing, the Trip booking-arrangement picker and the Configuration Viewer read this list." />

      {!isAdmin && <div className="card p-3 text-sm text-amber-800 bg-amber-50 border-amber-200">Switch persona to <strong>David Kumar — Travel Administrator</strong> (or System Administrator) to maintain the list. It is read-only for other roles.</div>}

      <Card title={`TMC providers (${rows.length})`}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr>
              <th className="th">Code</th><th className="th">Name</th><th className="th">Scope</th><th className="th">Booking methods</th><th className="th">Role</th><th className="th">Transport</th><th className="th text-center">Status</th>{isAdmin && <th className="th text-right">Action</th>}
            </tr></thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td className="td italic text-[var(--ecs-muted)]" colSpan={isAdmin ? 8 : 7}>No TMC providers configured.</td></tr>
              ) : rows.map((p) => (
                <tr key={p.id} className="hover:bg-[var(--ecs-panel-2)]">
                  <td className="td font-mono whitespace-nowrap">{p.code}</td>
                  <td className="td">{p.name}</td>
                  <td className="td">{p.scope === 'ALL' ? <span className="pill-info">Global</span> : <span className="font-mono text-xs">{p.scope}</span>}</td>
                  <td className="td text-xs">{methodLabels(p.bookingMethods)}</td>
                  <td className="td whitespace-nowrap">{roleOf(p)}</td>
                  <td className="td text-xs text-[var(--ecs-muted)] font-mono">{p.transport || '—'}</td>
                  <td className="td text-center">{p.active ? <span className="pill-pass">Active</span> : <span className="pill-stop">Inactive</span>}</td>
                  {isAdmin && (
                    <td className="td text-right whitespace-nowrap">
                      <form action={toggleTmcProviderAction.bind(null, p.id, !p.active)} className="inline">
                        <button className="btn-ghost text-xs">{p.active ? 'Deactivate' : 'Reactivate'}</button>
                      </form>
                      <form action={deleteTmcProviderAction.bind(null, p.id)} className="inline">
                        <button className="btn-ghost text-xs text-[var(--ecs-red)]">Remove</button>
                      </form>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-[var(--ecs-muted)] mt-2">A single travel request is routed to exactly one provider (no split booking across TMCs). The provider-specific wire mapping lives in the adapter layer; the <span className="font-mono">adapterKey</span> selects it.</p>
      </Card>

      {isAdmin && (
        <Card title="Add a TMC provider">
          <form action={createTmcProviderAction} className="grid md:grid-cols-2 gap-4">
            <div>
              <label className="label">Code (booking-arrangement key)</label>
              <input name="code" className="field" placeholder="TMC-ABC" required />
              <p className="text-xs text-[var(--ecs-muted)] mt-1">Stored uppercase and prefixed with <span className="font-mono">TMC-</span> if you omit it.</p>
            </div>
            <div>
              <label className="label">Provider name</label>
              <input name="name" className="field" placeholder="ABC Travel (Europe)" required />
            </div>
            <div>
              <label className="label">Adapter key</label>
              <input name="adapterKey" className="field" placeholder="fcm" defaultValue="fcm" />
              <p className="text-xs text-[var(--ecs-muted)] mt-1">Selects the provider wire adapter; falls back to the default adapter if unknown.</p>
            </div>
            <div>
              <label className="label">Scope (served destinations)</label>
              <input name="scope" className="field" placeholder="ALL  or  SG,JP,KR" defaultValue="ALL" />
              <p className="text-xs text-[var(--ecs-muted)] mt-1"><span className="font-mono">ALL</span> for global, or comma-separated ISO country codes.</p>
            </div>
            <div className="md:col-span-2">
              <label className="label">Booking methods fulfilled</label>
              <div className="flex flex-wrap gap-4 mt-1">
                {TMC_METHODS.map((m) => (
                  <label key={m} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" name={`m_${m}`} defaultChecked className="w-4 h-4" />{BOOKING_METHOD_LABEL[m]}
                  </label>
                ))}
              </div>
            </div>
            <div>
              <label className="label">Transport / endpoint</label>
              <input name="transport" className="field" placeholder="https://api.abc.example/v1 (OAuth2)" />
            </div>
            <div>
              <label className="label">PNR prefix</label>
              <input name="pnrPrefix" className="field w-32" placeholder="ABC" />
            </div>
            <div className="md:col-span-2 flex flex-wrap gap-6">
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="isDefault" className="w-4 h-4" />Default (catch-all) provider</label>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="highRiskOnly" className="w-4 h-4" />High-risk specialist desk</label>
            </div>
            <div className="md:col-span-2">
              <button className="btn-primary">Add provider</button>
              <span className="text-xs text-[var(--ecs-muted)] ml-3">Marking a provider Default clears the flag on the others (at most one default).</span>
            </div>
          </form>
        </Card>
      )}
    </div>
  );
}
