'use server';
// #14 Upgrade Differential (M6) account maintenance (Setup & Maintenance). Admin-gated add /
// deactivate / reactivate of the M6 accounts, grouped by Business Area, that an NTU-funded
// travel-class upgrade differential charges.
import { revalidatePath } from 'next/cache';
import { currentPersona } from '@/shared/session';
import { ROLE } from '@/shared/enums';
import { addUpgradeAccount, setUpgradeAccountActive } from '@/modules/pretrip/upgradeConfig';

async function isAdmin(): Promise<boolean> {
  const p = await currentPersona();
  return p.roles.includes(ROLE.TravelAdmin) || p.roles.includes(ROLE.SystemAdmin);
}

export async function createUpgradeAccountAction(fd: FormData) {
  if (!(await isAdmin())) return;
  const code = String(fd.get('code') ?? '').trim();
  const name = String(fd.get('name') ?? '').trim();
  const businessArea = String(fd.get('businessArea') ?? '');
  const companyCode = String(fd.get('companyCode') ?? '1000');
  const isDefault = fd.get('isDefault') === 'on';
  await addUpgradeAccount(code, name, businessArea, companyCode, isDefault);
  revalidatePath('/setup/upgrade-accounts');
}

export async function toggleUpgradeAccountAction(id: string, active: boolean) {
  if (!(await isAdmin())) return;
  await setUpgradeAccountActive(id, active);
  revalidatePath('/setup/upgrade-accounts');
}
