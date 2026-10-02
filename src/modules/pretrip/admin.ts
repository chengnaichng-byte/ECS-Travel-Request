'use server';
// Travel Administration Workbench actions (TR-18, §8.3 overrides).
import { revalidatePath } from 'next/cache';
import { prisma } from '@/shared/db';
import { currentPersonaId } from '@/shared/session';
import { loadRequest } from './queries';
import { REQUEST_STATUS } from '@/shared/enums';

async function adminAudit(id: string, summary: string) {
  const persona = await currentPersonaId();
  await prisma.auditEvent.create({ data: { requestId: id, actorId: persona, kind: 'STATUS', summary: `[Travel Admin] ${summary}` } });
}

/** §13.1 Close a completed trip that will not be claimed (marked no-claim). */
export async function closeAsNoClaim(id: string) {
  await prisma.travelRequest.update({ where: { id }, data: { status: REQUEST_STATUS.Closed } });
  await adminAudit(id, 'Marked no-claim; request closed');
  revalidatePath('/workbench');
  revalidatePath('/dashboard');
}

/** Reinstate an expired, unbooked authorisation for reapproval (§13.3). */
export async function reinstateExpired(id: string) {
  const req = await loadRequest(id);
  if (!req || req.status !== REQUEST_STATUS.Expired) return;
  await prisma.travelRequest.update({ where: { id }, data: { status: REQUEST_STATUS.PendingDOA } });
  await adminAudit(id, 'Reinstated expired authorisation for reapproval');
  revalidatePath('/workbench');
}

/** Simulate an expiry sweep — approved & unbooked requests past validity move to Expired. */
export async function runExpirySweep() {
  const approved = await prisma.travelRequest.findMany({ where: { status: REQUEST_STATUS.Approved, bookingStatus: 'Not Sent' } });
  const now = Date.now();
  for (const r of approved) {
    if (r.authorisationExpiry && r.authorisationExpiry.getTime() < now) {
      await prisma.travelRequest.update({ where: { id: r.id }, data: { status: REQUEST_STATUS.Expired } });
      await prisma.auditEvent.create({ data: { requestId: r.id, kind: 'STATUS', summary: '[Travel Admin] Authorisation expired (validity lapsed unbooked)' } });
    }
  }
  revalidatePath('/workbench');
}
