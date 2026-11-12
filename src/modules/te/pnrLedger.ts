// TMC transition — the unified claimed-PNR ledger (lighter demo build). Pre-go-live travel booked
// under the existing TMC has no Pre-Trip TR, so it is claimed via the LEGACY path: the claimant picks
// a PNR from a dropdown instead of the claim being created from an approved TA. The key fix is that a
// PNR consumed by ANY claim is hidden from the picker (so it cannot be claimed twice) and is released
// when that claim is deleted/recalled. `LegacyBooking.consumedByClaimId` is that ledger.
import { prisma } from '@/shared/db';
import { listTmcProviders } from '@/modules/pretrip/tmcConfig';

export interface LegacyPnrRow {
  id: string;
  pnr: string;
  travellerName: string;
  route: string | null;
  amountSgd: number;
  bookedOn: Date | null;
  tmcProviderId: string | null;
  tmcSource: string;                 // resolved TMC-source label (the multi-TMC master name)
  consumedByClaimId: string | null;
}

async function sourceMap(): Promise<Map<string, string>> {
  const providers = await listTmcProviders();
  return new Map(providers.map((p) => [p.id, p.name] as const));
}

/** Legacy PNRs for the transition picker. `availableOnly` filters out any already consumed by a claim. */
export async function listLegacyBookings(opts: { availableOnly?: boolean } = {}): Promise<LegacyPnrRow[]> {
  const rows = await prisma.legacyBooking.findMany({
    where: opts.availableOnly ? { consumedByClaimId: null } : {},
    orderBy: { bookedOn: 'asc' },
  });
  const byCode = await sourceMap();
  return rows.map((r) => ({
    id: r.id, pnr: r.pnr, travellerName: r.travellerName, route: r.route,
    amountSgd: r.amountSgd, bookedOn: r.bookedOn, tmcProviderId: r.tmcProviderId,
    tmcSource: r.tmcProviderId ? (byCode.get(r.tmcProviderId) ?? r.tmcProviderId) : 'Legacy TMC',
    consumedByClaimId: r.consumedByClaimId,
  }));
}

export async function legacyBookingByPnr(pnr: string): Promise<LegacyPnrRow | null> {
  const r = await prisma.legacyBooking.findUnique({ where: { pnr } });
  if (!r) return null;
  const byCode = await sourceMap();
  return {
    id: r.id, pnr: r.pnr, travellerName: r.travellerName, route: r.route,
    amountSgd: r.amountSgd, bookedOn: r.bookedOn, tmcProviderId: r.tmcProviderId,
    tmcSource: r.tmcProviderId ? (byCode.get(r.tmcProviderId) ?? r.tmcProviderId) : 'Legacy TMC',
    consumedByClaimId: r.consumedByClaimId,
  };
}

/** Mark a PNR consumed by a claim — ONLY if currently available, so a race can't double-claim it. */
export async function consumeLegacyBooking(pnr: string, claimId: string): Promise<boolean> {
  const res = await prisma.legacyBooking.updateMany({ where: { pnr, consumedByClaimId: null }, data: { consumedByClaimId: claimId } });
  return res.count > 0;
}

/** Release every PNR a claim consumed (claim deleted / recalled) — back into the picker. */
export async function releaseLegacyBookingsForClaim(claimId: string): Promise<void> {
  await prisma.legacyBooking.updateMany({ where: { consumedByClaimId: claimId }, data: { consumedByClaimId: null } });
}
