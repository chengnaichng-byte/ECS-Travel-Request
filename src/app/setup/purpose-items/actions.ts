'use server';
// §4.4 Purpose Cost Items master maintenance — the per-travel-purpose cost-item profile that drives
// the purpose-driven auto-population on Estimates. Admin-only. ODA / accommodation are policy-computed
// and ignore the standard cost; the standard cost pre-fills a declarable item's line.
import { revalidatePath } from 'next/cache';
import { prisma } from '@/shared/db';
import { currentPersona } from '@/shared/session';
import { ROLE } from '@/shared/enums';

async function requireAdmin() {
  const persona = await currentPersona();
  return persona.roles.includes(ROLE.TravelAdmin) || persona.roles.includes(ROLE.SystemAdmin);
}

const parseCost = (fd: FormData): number | null => {
  const v = fd.get('standardCostSgd');
  const s = v == null ? '' : String(v).trim();
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

export async function setPurposeItemCost(itemId: string, fd: FormData) {
  if (!(await requireAdmin())) return;
  await prisma.purposeCostItem.update({ where: { id: itemId }, data: { standardCostSgd: parseCost(fd) } });
  revalidatePath('/setup/purpose-items');
}

export async function removePurposeItem(itemId: string) {
  if (!(await requireAdmin())) return;
  await prisma.purposeCostItem.delete({ where: { id: itemId } });
  revalidatePath('/setup/purpose-items');
}

export async function addPurposeItem(purposeId: string, fd: FormData) {
  if (!(await requireAdmin())) return;
  const expenseTypeId = String(fd.get('expenseTypeId') ?? '').trim();
  if (!expenseTypeId) return;
  const max = await prisma.purposeCostItem.aggregate({ where: { purposeId }, _max: { sortOrder: true } });
  await prisma.purposeCostItem.upsert({
    where: { purposeId_expenseTypeId: { purposeId, expenseTypeId } },
    update: { standardCostSgd: parseCost(fd) },
    create: { purposeId, expenseTypeId, standardCostSgd: parseCost(fd), sortOrder: (max._max.sortOrder ?? 0) + 1 },
  });
  revalidatePath('/setup/purpose-items');
}
