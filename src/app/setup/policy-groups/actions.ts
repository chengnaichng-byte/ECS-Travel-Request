'use server';
// §13.19 Travel Policy Group master maintenance — toggle a group's "attracts M6" flag. Admin-only.
import { revalidatePath } from 'next/cache';
import { currentPersona } from '@/shared/session';
import { ROLE } from '@/shared/enums';
import { setPolicyGroupM6 } from '@/modules/pretrip/policyGroups';

export async function togglePolicyGroupM6Action(code: string, m6: boolean) {
  const persona = await currentPersona();
  if (!(persona.roles.includes(ROLE.TravelAdmin) || persona.roles.includes(ROLE.SystemAdmin))) return;
  await setPolicyGroupM6(code, m6);
  revalidatePath('/setup/policy-groups');
}
