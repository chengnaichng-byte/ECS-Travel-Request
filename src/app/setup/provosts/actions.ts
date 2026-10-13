'use server';
// §8 / DD-25 Provost list maintenance (Setup & Maintenance). Admin-gated add / deactivate /
// reactivate of the per-school provosts offered for a guest travel-class upgrade.
import { revalidatePath } from 'next/cache';
import { currentPersona } from '@/shared/session';
import { ROLE } from '@/shared/enums';
import { addProvost, setProvostActive } from '@/modules/pretrip/provost';

async function isAdmin(): Promise<boolean> {
  const p = await currentPersona();
  return p.roles.includes(ROLE.TravelAdmin) || p.roles.includes(ROLE.SystemAdmin);
}

export async function createProvostAction(fd: FormData) {
  if (!(await isAdmin())) return;
  const schoolId = String(fd.get('schoolId') ?? '');
  const approverId = String(fd.get('approverId') ?? '');
  await addProvost(schoolId, approverId);
  revalidatePath('/setup/provosts');
}

export async function toggleProvostAction(id: string, active: boolean) {
  if (!(await isAdmin())) return;
  await setProvostActive(id, active);
  revalidatePath('/setup/provosts');
}
