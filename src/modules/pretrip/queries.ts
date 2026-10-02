// Read models for the pre-trip module. A full Travel Request with all lines is the
// unit most screens work with.
import { prisma } from '@/shared/db';
import { REQUEST_STATUS } from '@/shared/enums';

export const fullInclude = {
  travellers: true,
  legs: { orderBy: { seq: 'asc' } },
  expenses: { include: { accommodation: true, oda: true } },
  allocations: true,
  policyChecks: true,
  approvalSteps: { orderBy: { seq: 'asc' } },
  bookings: { include: { segments: true } },
  deviations: true,
  teLinks: true,
  claims: { include: { lines: true } },
  messages: true,
  auditEvents: { orderBy: { createdAt: 'desc' } },
  versions: { orderBy: { version: 'desc' } },
  attachments: { orderBy: { createdAt: 'desc' } },
} as const;

export async function loadRequest(id: string) {
  return prisma.travelRequest.findUnique({ where: { id }, include: fullInclude });
}

export type FullRequest = NonNullable<Awaited<ReturnType<typeof loadRequest>>>;

export async function listRequests() {
  return prisma.travelRequest.findMany({
    include: { expenses: true, travellers: true, policyChecks: true, allocations: true, bookings: true },
    orderBy: { updatedAt: 'desc' },
  });
}

/** §25/§40 Duplicate / overlapping-trip detection. Finds other live requests for any of
 *  the given travellers whose official dates overlap [start, end]. Rejected / Withdrawn /
 *  Cancelled requests are ignored. Runs as a query (not in the pure policy engine) because
 *  it must look across sibling requests. */
export async function overlappingTripsFor(
  employeeIds: string[],
  start: Date | null,
  end: Date | null,
  excludeRequestId: string,
) {
  if (!start || !end || employeeIds.length === 0) return [];
  const dead = [REQUEST_STATUS.Rejected, REQUEST_STATUS.Withdrawn, REQUEST_STATUS.Cancelled, REQUEST_STATUS.Draft];
  const candidates = await prisma.travelRequest.findMany({
    where: {
      id: { not: excludeRequestId },
      status: { notIn: dead },
      startDate: { lte: end },
      endDate: { gte: start },
    },
    include: { travellers: true },
  });
  return candidates
    .map((c) => {
      const who = employeeIds.filter((e) => c.travellerId === e || c.travellers.some((t) => t.employeeId === e));
      return { request: c, who };
    })
    .filter((r) => r.who.length > 0);
}
