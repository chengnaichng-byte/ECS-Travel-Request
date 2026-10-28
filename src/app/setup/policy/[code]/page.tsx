// §6.3 Edit Policy Rule (TR) — the ECS "Edit Policy Rule" form for one policy. Admin edits the policy
// details, rules (Field/Operator/Value) and actions (warning / hard stop / exception approvers); the
// configured-policy engine evaluates the saved policy on the next policy run.
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getPolicyConfig } from '@/modules/pretrip/policyConfigService';
import { savePolicyConfigAction } from '../actions';
import { currentPersona } from '@/shared/session';
import { ROLE } from '@/shared/enums';
import { POLICY_FIELDS } from '@/config/policyFields';
import { PolicyEditor } from '@/components/PolicyEditor';
import { PageTitle } from '@/components/ui';

export const dynamic = 'force-dynamic';

export default async function EditPolicyPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const policy = await getPolicyConfig(code);
  if (!policy) notFound();
  const persona = await currentPersona();
  const isAdmin = persona.roles.includes(ROLE.TravelAdmin) || persona.roles.includes(ROLE.SystemAdmin);

  return (
    <div className="w-full space-y-4">
      <PageTitle id="TR-29" title={`Policy Configurations ▸ ${policy.name}`}
        subtitle="Edit the policy details, rules (Field / Operator / Value) and actions. Line-scope fields are marked (line) and are evaluated per estimate line." />
      <Link href="/setup/policy" className="btn-secondary text-xs">← Back to policy configurations</Link>
      {!isAdmin && <div className="card p-3 text-sm text-amber-800 bg-amber-50 border-amber-200">Read-only — switch to Travel Administrator / System Administrator to edit.</div>}
      <PolicyEditor initial={policy} fields={POLICY_FIELDS} canEdit={isAdmin} action={savePolicyConfigAction} />
    </div>
  );
}
