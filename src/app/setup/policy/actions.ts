'use server';
// §6.3 Policy Configuration maintenance (Setup & Maintenance). Admin-gated create / edit (ECS "Edit
// Policy Rule") / enable-disable / delete of the ECS-structured TR policies that the configured-policy
// engine evaluates.
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { currentPersona } from '@/shared/session';
import { ROLE, DOCUMENT_TYPE } from '@/shared/enums';
import { savePolicyConfig, setPolicyConfigEnabled, deletePolicyConfig } from '@/modules/pretrip/policyConfigService';
import type { PolicyConfig } from '@/config/policyConfigs';

async function isAdmin(): Promise<boolean> {
  const p = await currentPersona();
  return p.roles.includes(ROLE.TravelAdmin) || p.roles.includes(ROLE.SystemAdmin);
}

export async function savePolicyConfigAction(json: string) {
  if (!(await isAdmin())) return;
  let p: PolicyConfig;
  try { p = JSON.parse(json); } catch { return; }
  if (!p?.code) return;
  await savePolicyConfig(p);
  revalidatePath('/setup/policy');
  revalidatePath(`/setup/policy/${p.code}`);
}

export async function togglePolicyAction(id: string, enabled: boolean) {
  if (!(await isAdmin())) return;
  await setPolicyConfigEnabled(id, enabled);
  revalidatePath('/setup/policy');
}

export async function deletePolicyAction(id: string) {
  if (!(await isAdmin())) return;
  await deletePolicyConfig(id);
  revalidatePath('/setup/policy');
}

export async function createPolicyAction(fd: FormData) {
  if (!(await isAdmin())) return;
  const name = String(fd.get('name') ?? '').trim();
  const documentType = String(fd.get('documentType') ?? DOCUMENT_TYPE.TravelRequest);
  const category = String(fd.get('category') ?? 'Others');
  const companyCode = String(fd.get('companyCode') ?? 'NTU');
  if (!name) return;
  const code = `POL_${Date.now().toString(36).toUpperCase()}`;
  await savePolicyConfig({
    code, name, documentType, category, companyCode,
    effectiveFrom: new Date().toISOString().slice(0, 10), effectiveTo: '2031-03-31', enabled: false,
    rules: [{ seq: 1, code: `${code}_R1`, description: 'New rule', conditions: [{ fact: 'approvalAmountSgd', op: 'gt', value: 0 }], actions: [{ type: 'WARNING', message: '' }] }],
  });
  redirect(`/setup/policy/${code}`);
}
