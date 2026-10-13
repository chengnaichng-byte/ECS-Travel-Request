// §8 / DD-25 Provost reference service. The per-school Provost list is a maintainable master
// (list + add/deactivate in Setup & Maintenance) that governs who may authorise a GUEST
// travel-class upgrade. The selection is stored on the request (provostId) and inserted into
// the approval route ahead of the host DOA. The list is DB-backed and seeded idempotently so a
// fresh/reseeded database always offers a default provost per school (O-6 source still open).
import { prisma } from '@/shared/db';
import { EcsIdentity } from '@/shared/ecs/services';

// Default per-school provost authorities (seeded when the table is empty). A single university
// Provost covers each school; a Dean is offered as a delegated alternative for the host school.
const DEFAULT_PROVOSTS: { schoolId: string; approverId: string }[] = [
  { schoolId: 'SCH-CS', approverId: 'E-PROVOST' },
  { schoolId: 'SCH-CS', approverId: 'E-DEAN' },
  { schoolId: 'RI-AI', approverId: 'E-PROVOST' },
];

function snapshot(approverId: string): { name: string; title: string } {
  const e = EcsIdentity.employee(approverId);
  return { name: e?.name ?? approverId, title: e?.title ?? 'Provost' };
}

/** Seed the default provosts once (idempotent). Safe to call on every read. */
export async function ensureProvostSeed(): Promise<void> {
  const n = await prisma.provost.count();
  if (n > 0) return;
  for (const d of DEFAULT_PROVOSTS) {
    const s = snapshot(d.approverId);
    await prisma.provost.upsert({
      where: { schoolId_approverId: { schoolId: d.schoolId, approverId: d.approverId } },
      update: {},
      create: { schoolId: d.schoolId, approverId: d.approverId, name: s.name, title: s.title, active: true },
    });
  }
}

export interface ProvostRow { id: string; schoolId: string; approverId: string; name: string; title: string; active: boolean }

/** All provost entries (for the maintenance screen). */
export async function listProvosts(): Promise<ProvostRow[]> {
  await ensureProvostSeed();
  return prisma.provost.findMany({ orderBy: [{ schoolId: 'asc' }, { name: 'asc' }] });
}

/** Active provosts selectable for a host school. Falls back to all active provosts when the
 *  school has none of its own, so a guest upgrade can always be routed to a provost. */
export async function provostsForSchool(schoolId: string | null | undefined): Promise<ProvostRow[]> {
  await ensureProvostSeed();
  const all = await prisma.provost.findMany({ where: { active: true }, orderBy: { name: 'asc' } });
  const own = all.filter((p) => p.schoolId === schoolId);
  return own.length ? own : all;
}

/** Add (or reactivate) a provost for a school; name/title snapshot from the employee master. */
export async function addProvost(schoolId: string, approverId: string): Promise<void> {
  if (!schoolId || !approverId) return;
  const s = snapshot(approverId);
  await prisma.provost.upsert({
    where: { schoolId_approverId: { schoolId, approverId } },
    update: { active: true, name: s.name, title: s.title },
    create: { schoolId, approverId, name: s.name, title: s.title, active: true },
  });
}

export async function setProvostActive(id: string, active: boolean): Promise<void> {
  await prisma.provost.update({ where: { id }, data: { active } });
}
