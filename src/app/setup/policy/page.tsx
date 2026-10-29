// §6.3 Policy Configurations (TR) — Setup & Maintenance, mirroring the ECS "Policy configurations"
// list: named, category- and company-scoped, effective-dated, enable-able policies that the
// configured-policy engine evaluates. Admin can enable/disable, add, edit (ECS "Edit Policy Rule"),
// and delete. Seeded from the defaults (which reproduce the discretionary advisory/exception checks).
import Link from 'next/link';
import { listPolicyConfigs } from '@/modules/pretrip/policyConfigService';
import { togglePolicyAction, deletePolicyAction, createPolicyAction } from './actions';
import { currentPersona } from '@/shared/session';
import { ROLE, DOCUMENT_TYPE_LABEL, DOCUMENT_TYPES } from '@/shared/enums';
import { POLICY_CATEGORIES, POLICY_COMPANY_CODES } from '@/config/policyConfigs';
import { PageTitle, Card } from '@/components/ui';

export const dynamic = 'force-dynamic';

const fmtDate = (d: Date) => d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });

export default async function PolicyConfigPage() {
  const persona = await currentPersona();
  const isAdmin = persona.roles.includes(ROLE.TravelAdmin) || persona.roles.includes(ROLE.SystemAdmin);
  const rows = await listPolicyConfigs();

  return (
    <div className="w-full space-y-5">
      <PageTitle id="TR-29" title="Policy Configurations (Travel Request)"
        subtitle="ECS-structured TR policy configuration: named, category- and company-scoped, effective-dated Policies → Rules (Field / Operator / Value) → Actions (Show warning / Hard stop / Add exception approvers). Edits take effect on the next policy run." />

      {!isAdmin && <div className="card p-3 text-sm text-amber-800 bg-amber-50 border-amber-200">Switch persona to <strong>David Kumar — Travel Administrator</strong> (or System Administrator) to maintain policies. Read-only for other roles.</div>}

      <Card title="Policy configurations">
        <table className="w-full text-sm">
          <thead><tr><th className="th">Policy name</th><th className="th">Document</th><th className="th">Policy category</th><th className="th">Company</th><th className="th">Effective from</th><th className="th">Effective to</th><th className="th text-center">Status</th>{isAdmin && <th className="th text-right">Action</th>}</tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="hover:bg-[var(--ecs-panel-2)]">
                <td className="td font-medium"><Link className="underline" href={`/setup/policy/${r.code}`}>{r.name}</Link></td>
                <td className="td">{DOCUMENT_TYPE_LABEL[r.documentType] ?? r.documentType}</td>
                <td className="td">{r.category}</td>
                <td className="td">{r.companyCode}</td>
                <td className="td">{fmtDate(r.effectiveFrom)}</td>
                <td className="td">{fmtDate(r.effectiveTo)}</td>
                <td className="td text-center">{r.enabled ? <span className="pill-pass">Active</span> : <span className="pill-stop">Inactive</span>}</td>
                {isAdmin && (
                  <td className="td text-right whitespace-nowrap">
                    <Link className="btn-ghost text-xs" href={`/setup/policy/${r.code}`}>Edit</Link>
                    <form action={togglePolicyAction.bind(null, r.id, !r.enabled)} className="inline"><button className="btn-ghost text-xs">{r.enabled ? 'Disable' : 'Enable'}</button></form>
                    <form action={deletePolicyAction.bind(null, r.id)} className="inline"><button className="btn-ghost text-xs text-red-700">Delete</button></form>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {isAdmin && (
        <Card title="Add a policy">
          <form action={createPolicyAction} className="flex flex-wrap items-end gap-3">
            <div><label className="label">Policy name</label><input name="name" className="field w-72" placeholder="e.g. NTU_Accommodation" required /></div>
            <div><label className="label">Document</label><select name="documentType" className="field w-44" defaultValue="TRAVEL_REQUEST">{DOCUMENT_TYPES.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}</select></div>
            <div><label className="label">Category</label><select name="category" className="field w-48" defaultValue="Others">{POLICY_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}</select></div>
            <div><label className="label">Company</label><select name="companyCode" className="field w-28" defaultValue="NTU">{POLICY_COMPANY_CODES.map((c) => <option key={c} value={c}>{c}</option>)}</select></div>
            <button className="btn-primary">Create &amp; edit</button>
          </form>
          <p className="text-xs text-[var(--ecs-muted)] mt-2">A new policy starts disabled with one example rule — edit its rules and actions, then enable it.</p>
        </Card>
      )}
    </div>
  );
}
