// §13.14 Group traveller line numbers (TA/0n). A group shares ONE Travel Request and ONE Travel
// Authorisation; each traveller is denoted by a stable, frozen line number within that TA. The
// line number is a finance-/human-readable reference (TA-…/0n) — the system key stays travellerId
// and the booking reference stays the per-traveller PNR.
import { prisma } from '@/shared/db';

/** Assign stable, FROZEN group line numbers. Existing numbers are kept; a traveller without one
 *  gets the next number above the current max, so a dropped traveller leaves a gap and a new one
 *  never reuses a retired number (an amendment must not shift references already on bookings /
 *  claims / SAP). The requestor (lead) takes 01 on first assignment. No-op for a non-group request. */
export async function assignGroupLineNos(requestId: string): Promise<void> {
  const travellers = await prisma.travelRequestTraveller.findMany({
    where: { requestId },
    orderBy: [{ isRequestor: 'desc' }, { id: 'asc' }],
  });
  if (travellers.length <= 1) return; // only a group (2+ travellers) carries line numbers
  let max = travellers.reduce((m, t) => Math.max(m, t.lineNo ?? 0), 0);
  for (const t of travellers) {
    if (t.lineNo == null) {
      max += 1;
      await prisma.travelRequestTraveller.update({ where: { id: t.id }, data: { lineNo: max } });
    }
  }
}

/** The group line reference for a traveller: the TA number with a 2-digit line suffix (TA-…/0n).
 *  Returns the bare TA when there is no line number (an individual, non-group request). */
export function taLineRef(authorisationNo: string | null | undefined, lineNo?: number | null): string {
  if (!authorisationNo) return '—';
  return lineNo ? `${authorisationNo}/${String(lineNo).padStart(2, '0')}` : authorisationNo;
}
