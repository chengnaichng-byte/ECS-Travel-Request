// §13.3 Travel Request and Travel Authorisation numbering. Derived from the highest
// existing suffix for the year's prefix (not a row count), so deleting a record never
// causes a collision with a @unique number.
import { prisma } from '@/shared/db';

/** Next NNNNNN suffix after the highest existing value for `prefix`. */
function nextSuffix(values: (string | null)[], prefix: string): number {
  let max = 0;
  for (const v of values) {
    if (!v || !v.startsWith(prefix)) continue;
    const n = parseInt(v.slice(prefix.length), 10);
    if (!Number.isNaN(n) && n > max) max = n;
  }
  return max + 1;
}

/** TR-YYYY-NNNNNN request number. */
export async function nextRequestNumber(year: number): Promise<string> {
  const prefix = `TR-${year}-`;
  const rows = await prisma.travelRequest.findMany({ where: { requestNumber: { startsWith: prefix } }, select: { requestNumber: true } });
  return `${prefix}${String(nextSuffix(rows.map((r) => r.requestNumber), prefix)).padStart(6, '0')}`;
}

/** TA-YYYY-NNNNNN authorisation number, unique across the university, on final approval (§13.3). */
export async function nextAuthorisationNumber(year: number): Promise<string> {
  const prefix = `TA-${year}-`;
  const rows = await prisma.travelRequest.findMany({ where: { authorisationNo: { startsWith: prefix } }, select: { authorisationNo: true } });
  return `${prefix}${String(nextSuffix(rows.map((r) => r.authorisationNo), prefix)).padStart(6, '0')}`;
}

/** CLM-YYYY-NNNNNN mock TE claim number. */
export async function nextClaimNumber(year: number): Promise<string> {
  const prefix = `CLM-${year}-`;
  const rows = await prisma.travelExpenseClaim.findMany({ where: { claimNumber: { startsWith: prefix } }, select: { claimNumber: true } });
  return `${prefix}${String(nextSuffix(rows.map((r) => r.claimNumber), prefix)).padStart(6, '0')}`;
}
