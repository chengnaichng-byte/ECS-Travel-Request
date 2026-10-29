// §6.2 Workflow Configurations (TR) — Setup & Maintenance, mirroring the ECS "Workflow
// configurations" list: named, effective-dated, enable-able approval-workflow scenarios. Admin can
// enable/disable and edit (ECS "Edit workflow rule": Approval tiers + Decision points). Routing reads
// the active scenario, so edits take effect on the next request.
import Link from 'next/link';
import { listScenarios } from '@/modules/pretrip/workflowConfig';
import { toggleWorkflowScenarioAction } from './actions';
import { currentPersona } from '@/shared/session';
import { ROLE, DOCUMENT_TYPE_LABEL } from '@/shared/enums';
import { PageTitle, Card } from '@/components/ui';

export const dynamic = 'force-dynamic';

const fmtDate = (d: Date) => d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });

export default async function WorkflowConfigListPage() {
  const persona = await currentPersona();
  const isAdmin = persona.roles.includes(ROLE.TravelAdmin) || persona.roles.includes(ROLE.SystemAdmin);
  const rows = await listScenarios();

  return (
    <div className="w-full space-y-5">
      <PageTitle id="TR-28" title="Workflow Configurations (Travel Request)"
        subtitle="ECS-structured approval-workflow configuration: a named, effective-dated scenario with Approval Tiers (amount band → approving levels) and Decision Points (conditions → Skip / Add / Replace an approver). Edits take effect on the next request." />

      {!isAdmin && <div className="card p-3 text-sm text-amber-800 bg-amber-50 border-amber-200">Switch persona to <strong>David Kumar — Travel Administrator</strong> (or System Administrator) to edit. Read-only for other roles.</div>}

      <Card title="Workflow configurations">
        <table className="w-full text-sm">
          <thead><tr><th className="th">Scenario name</th><th className="th">Document</th><th className="th">Effective from</th><th className="th">Effective to</th><th className="th text-center">Status</th>{isAdmin && <th className="th text-right">Action</th>}</tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="hover:bg-[var(--ecs-panel-2)]">
                <td className="td font-medium"><Link className="underline" href={`/setup/workflow/${r.code}`}>{r.name}</Link></td>
                <td className="td">{DOCUMENT_TYPE_LABEL[r.documentType] ?? r.documentType}</td>
                <td className="td">{fmtDate(r.effectiveFrom)}</td>
                <td className="td">{fmtDate(r.effectiveTo)}</td>
                <td className="td text-center">{r.enabled ? <span className="pill-pass">Enabled</span> : <span className="pill-stop">Disabled</span>}</td>
                {isAdmin && (
                  <td className="td text-right whitespace-nowrap">
                    <Link className="btn-ghost text-xs" href={`/setup/workflow/${r.code}`}>Edit</Link>
                    <form action={toggleWorkflowScenarioAction.bind(null, r.id, !r.enabled)} className="inline"><button className="btn-ghost text-xs">{r.enabled ? 'Disable' : 'Enable'}</button></form>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
