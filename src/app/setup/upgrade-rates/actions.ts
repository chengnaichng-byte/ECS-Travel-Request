'use server';
// #14 Upgrade uplift-rate maintenance (Setup & Maintenance). Admin-gated add/update and
// activate/deactivate of the class-step uplift % schedule (Model B) used to derive the entitlement
// fare (entitlement = chosen fare / (1 + pct)) and the upgrade differential.
import { revalidatePath } from 'next/cache';
import { currentPersona } from '@/shared/session';
import { ROLE } from '@/shared/enums';
import { upsertUpliftRate, setUpliftRateActive } from '@/modules/pretrip/upgradeConfig';

async function isAdmin(): Promise<boolean> {
  const p = await currentPersona();
  return p.roles.includes(ROLE.TravelAdmin) || p.roles.includes(ROLE.SystemAdmin);
}

export async function saveUpliftRateAction(fd: FormData) {
  if (!(await isAdmin())) return;
  const fromClassId = String(fd.get('fromClassId') ?? '');
  const toClassId = String(fd.get('toClassId') ?? '');
  const pct = Number(fd.get('pctPercent') ?? 0) / 100; // UI enters a whole % uplift; stored as a fraction
  await upsertUpliftRate(fromClassId, toClassId, pct);
  revalidatePath('/setup/upgrade-rates');
}

export async function toggleUpliftRateAction(id: string, active: boolean) {
  if (!(await isAdmin())) return;
  await setUpliftRateActive(id, active);
  revalidatePath('/setup/upgrade-rates');
}
