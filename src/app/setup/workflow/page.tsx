// §6.2 Workflow Configuration (TR) — Setup & Maintenance. Mirrors the ECS "Workflow configurations"
// screen: a named, effective-dated, enable-able Workflow Scenario whose Approval Tiers (amount range)
// carry ordered Approving Levels (level + resolver + optional approver), each gated by a TR condition.
// Phase 1 is READ-ONLY with a Simulator; routing is behaviour-identical to the previous hand-coded
// route (the scenario compiles to the same decision-tree engine the server routes with).
import { listScenarios, getScenario } from '@/modules/pretrip/workflowConfig';
import { workflowBands } from '@/data/workflow';
import { exprText, FACTS, type Ctx } from '@/modules/pretrip/workflowRules';
import { WorkflowSimulator } from '@/components/WorkflowSimulator';
import { PageTitle, Card } from '@/components/ui';

export const dynamic = 'force-dynamic';

const ROLE_LABEL: Record<string, string> = {
  ADDITIONAL_APPROVER: 'Additional Approver', RO: 'Reporting Officer', FUNDING_OWNER: 'Funding Owner',
  EXCEPTION: 'Exception Approver', PROVOST: 'Provost', DOA: 'DOA', RESEARCH_DOA: 'Research DOA',
};
const fmtDate = (d: Date) => d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });

// A sensible default request for the simulator — a standard individual trip.
const SIM_DEFAULTS: Ctx = {
  approvalAmount: 3000, isGroup: false, researchRoute: false, travellerIsPI: false, isGuest: false,
  hasPolicyException: false, crossBaCount: 1, crossChargeFundingOwnerPresent: false,
  additionalApproverPresent: false, guestUpgradeProvostPresent: false, isEmergency: false,
  roRequirement: 'INDIVIDUAL_ONLY', exceptionApproverRequired: true, researchPiSelfApproval: true,
  selfApprovalLimitSgd: 5000, crossBaThresholdSgd: 500,
};

export default async function WorkflowConfigPage() {
  const scenarios = await listScenarios();
  const scenario = await getScenario('TR_STANDARD');

  return (
    <div className="w-full space-y-5">
      <PageTitle id="TR-28 · read-only (Phase 1)" title="Workflow Configuration (Travel Request)"
        subtitle="ECS-structured approval-workflow configuration: a named, effective-dated Workflow Scenario → Approval Tiers (amount range) → ordered Approving Levels (level · resolver · optional approver), each gated by a condition. Routing is behaviour-identical to today; editing arrives in a later phase." />

      <Card title="Workflow configurations">
        <table className="w-full text-sm">
          <thead><tr><th className="th">Scenario name</th><th className="th">Effective from</th><th className="th">Effective to</th><th className="th text-center">Status</th></tr></thead>
          <tbody>
            {scenarios.map((s) => (
              <tr key={s.id} className="hover:bg-[var(--ecs-panel-2)]">
                <td className="td font-medium">{s.name}</td>
                <td className="td">{fmtDate(s.effectiveFrom)}</td>
                <td className="td">{fmtDate(s.effectiveTo)}</td>
                <td className="td text-center">{s.enabled ? <span className="pill-pass">Enabled</span> : <span className="pill-stop">Disabled</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {scenario && scenario.tiers.map((tier) => (
        <Card key={tier.seq} title={`${scenario.name} — ${tier.label}`}>
          <p className="text-xs text-[var(--ecs-muted)] mb-3">
            Rule: total approval amount from <strong>SGD {tier.amountFrom.toLocaleString('en-SG')}</strong> to <strong>{tier.amountTo == null ? 'no upper bound' : `SGD ${tier.amountTo.toLocaleString('en-SG')}`}</strong>
            {tier.condition ? <> · when {exprText(tier.condition)}</> : null}.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr>
                <th className="th">#</th><th className="th">Approving Level</th><th className="th">Resolver</th><th className="th">Applies when (condition)</th>
              </tr></thead>
              <tbody>
                {tier.levels.map((l) => (
                  <tr key={l.seq} className="hover:bg-[var(--ecs-panel-2)] align-top">
                    <td className="td">{l.seq}</td>
                    <td className="td font-medium whitespace-nowrap">{ROLE_LABEL[l.level] ?? l.level}</td>
                    <td className="td">{l.resolverLabel} <span className="pill-info text-[10px] ml-1">{l.resolver}{l.ref ? ` · ${l.ref}` : ''}</span>{l.approverId && <span className="pill-warn text-[10px] ml-1">pinned: {l.approverId}</span>}</td>
                    <td className="td text-xs text-[var(--ecs-muted)]">{l.condition ? exprText(l.condition) : 'Always'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ))}

      <Card title="DOA amount bands (BAND_DOA resolver reference)">
        <p className="text-xs text-[var(--ecs-muted)] mb-2">The DOA approving level resolves to the highest-charging department&apos;s DOA line at the tier picked by the approval amount.</p>
        <table className="w-full text-sm">
          <thead><tr><th className="th">Band</th><th className="th text-right">From (SGD)</th><th className="th text-right">To (SGD)</th><th className="th">DOA tier</th></tr></thead>
          <tbody>
            {workflowBands.map((b) => (
              <tr key={b.id} className="hover:bg-[var(--ecs-panel-2)]">
                <td className="td">{b.id}</td>
                <td className="td text-right">{b.minSgd.toLocaleString('en-SG')}</td>
                <td className="td text-right">{b.maxSgd == null ? '∞' : b.maxSgd.toLocaleString('en-SG')}</td>
                <td className="td">DOA-{b.doaTierIndex + 1}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {scenario && (
        <Card title="Simulator — what would approve this request?">
          <WorkflowSimulator scenario={scenario} facts={FACTS} defaults={SIM_DEFAULTS} />
        </Card>
      )}
    </div>
  );
}
