// §6.2 Edit workflow rule (TR) — the ECS "Edit workflow rule" form for one scenario: Workflow details,
// Approval tiers and Decision points, all editable. A Simulator below shows the route the engine would
// resolve for a given set of request facts, using the same engine routing runs with.
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getScenario } from '@/modules/pretrip/workflowConfig';
import { saveWorkflowScenarioAction } from '../actions';
import { currentPersona } from '@/shared/session';
import { ROLE } from '@/shared/enums';
import { FACTS, type Ctx } from '@/modules/pretrip/workflowRules';
import { workflowBands } from '@/data/workflow';
import { WorkflowEditor } from '@/components/WorkflowEditor';
import { WorkflowSimulator } from '@/components/WorkflowSimulator';
import { PageTitle, Card } from '@/components/ui';

export const dynamic = 'force-dynamic';

const SIM_DEFAULTS: Ctx = {
  approvalAmount: 3000, isGroup: false, researchRoute: false, travellerIsPI: false, isGuest: false,
  hasPolicyException: false,
  additionalApproverPresent: false, guestUpgradeProvostPresent: false, isEmergency: false,
  roRequirement: 'INDIVIDUAL_ONLY', exceptionApproverRequired: true, researchPiSelfApproval: true,
  selfApprovalLimitSgd: 5000,
};

export default async function EditWorkflowPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const scenario = await getScenario(code);
  if (!scenario) notFound();
  const persona = await currentPersona();
  const isAdmin = persona.roles.includes(ROLE.TravelAdmin) || persona.roles.includes(ROLE.SystemAdmin);

  return (
    <div className="w-full space-y-4">
      <PageTitle id="TR-28" title={`Workflow configurations ▸ ${scenario.name}`}
        subtitle="Edit the approval tiers (amount band → approving levels) and decision points (conditions → Skip / Add / Replace an approver). The DOA resolves to the highest-charging department's DOA by amount band." />
      <Link href="/setup/workflow" className="btn-secondary text-xs">← Back to workflow configurations</Link>
      {!isAdmin && <div className="card p-3 text-sm text-amber-800 bg-amber-50 border-amber-200">Read-only — switch to Travel Administrator / System Administrator to edit.</div>}

      <WorkflowEditor initial={scenario} facts={FACTS} canEdit={isAdmin} action={saveWorkflowScenarioAction} />

      <Card title="DOA amount bands (BAND_DOA resolver reference)">
        <p className="text-xs text-[var(--ecs-muted)] mb-2">The DOA approving level resolves to the highest-charging department&apos;s DOA line at the tier picked by the approval amount.</p>
        <table className="w-full text-sm">
          <thead><tr><th className="th">Band</th><th className="th text-right">From (SGD)</th><th className="th text-right">To (SGD)</th><th className="th">DOA tier</th></tr></thead>
          <tbody>{workflowBands.map((b) => (<tr key={b.id} className="hover:bg-[var(--ecs-panel-2)]"><td className="td">{b.id}</td><td className="td text-right">{b.minSgd.toLocaleString('en-SG')}</td><td className="td text-right">{b.maxSgd == null ? '∞' : b.maxSgd.toLocaleString('en-SG')}</td><td className="td">DOA-{b.doaTierIndex + 1}</td></tr>))}</tbody>
        </table>
      </Card>

      <Card title="Simulator — what would approve this request?">
        <WorkflowSimulator scenario={scenario} facts={FACTS} defaults={SIM_DEFAULTS} />
      </Card>
    </div>
  );
}
