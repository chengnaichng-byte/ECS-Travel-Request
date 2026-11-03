'use server';
// §13.x Academic calendar maintenance — the university-wide teaching calendar that drives the
// non-term-research derivation. Admin-only. Each term is a dated period typed TEACHING | EXAM | BREAK.
import { revalidatePath } from 'next/cache';
import { prisma } from '@/shared/db';
import { currentPersona } from '@/shared/session';
import { ROLE } from '@/shared/enums';

async function requireAdmin() {
  const p = await currentPersona();
  return p.roles.includes(ROLE.TravelAdmin) || p.roles.includes(ROLE.SystemAdmin);
}
const toDate = (fd: FormData, k: string): Date | null => {
  const v = String(fd.get(k) ?? '').trim();
  return v ? new Date(`${v}T00:00:00.000Z`) : null;
};
const TYPES = new Set(['TEACHING', 'EXAM', 'BREAK']);

export async function setTerm(id: string, fd: FormData) {
  if (!(await requireAdmin())) return;
  const start = toDate(fd, 'startDate'), end = toDate(fd, 'endDate');
  const type = String(fd.get('type') ?? 'TEACHING');
  const name = String(fd.get('name') ?? '').trim() || 'Term';
  if (!start || !end || end < start || !TYPES.has(type)) { revalidatePath('/setup/academic-calendar'); return; }
  await prisma.academicTerm.update({ where: { id }, data: { name, type, startDate: start, endDate: end } });
  revalidatePath('/setup/academic-calendar');
}

export async function removeTerm(id: string) {
  if (!(await requireAdmin())) return;
  await prisma.academicTerm.delete({ where: { id } });
  revalidatePath('/setup/academic-calendar');
}

export async function addTerm(fd: FormData) {
  if (!(await requireAdmin())) return;
  const start = toDate(fd, 'startDate'), end = toDate(fd, 'endDate');
  const ay = String(fd.get('academicYear') ?? '').trim();
  const name = String(fd.get('name') ?? '').trim();
  const type = String(fd.get('type') ?? 'TEACHING');
  if (!ay || !name || !start || !end || end < start || !TYPES.has(type)) return;
  const max = await prisma.academicTerm.aggregate({ where: { academicYear: ay }, _max: { sortOrder: true } });
  await prisma.academicTerm.create({ data: { academicYear: ay, name, type, startDate: start, endDate: end, sortOrder: (max._max.sortOrder ?? 0) + 1 } });
  revalidatePath('/setup/academic-calendar');
}
