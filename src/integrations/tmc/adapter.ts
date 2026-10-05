// §7.5 Mock TMC provider adapter. Translates the canonical ECS model to/from a
// provider — here it just echoes a simulated booking. In production this is the ONLY
// layer that changes when the TMC changes; canonical model, workflow and TE linkage
// stay unchanged.
import { EcsReference } from '@/shared/ecs/services';
import { BOOKING_STATUS } from '@/shared/enums';
import type { CanonicalOutbound, CanonicalInbound, OutboundMeta, InboundMeta } from './contract';

/**
 * Build the canonical outbound hand-off from an approved request (§13.9).
 * `enabled` is the set of Integration-Contract field keys the admin has switched on
 * (src/config/integrationContracts.ts). When omitted, every field is included (the
 * demo-seed default). Core fields (authorisation, traveller, booking method) always
 * flow; toggled fields are omitted from the payload when their key is absent.
 */
export function buildOutbound(req: {
  authorisationNo: string | null;
  travellerId: string;
  travellerName?: string;
  bookingFor?: 'EMPLOYEE' | 'GUEST';
  guest?: { name: string; email?: string | null; organisation?: string | null };
  travellers: { employeeId: string }[];
  bookingMethod: string | null;
  bookingDeadline: Date | null;
  approvedCostCeilingSgd: number;
  approvedExceptions: string[];
  travelPurpose?: string;
  eventStartDate?: Date | null;
  eventEndDate?: Date | null;
  approvalValidUntil?: Date | null;
  legs: { originCode: string; destCode: string; departDate: Date | null; travelClassId: string | null }[];
  accommodation: { city: string; nights: number; cappedNightlySgd: number }[];
  charging?: { code: string; type: string; businessArea?: string | null; companyCode?: string | null; percent: number; isResearch: boolean; primary: boolean }[];
  approvals?: { role: string; approver: string; decidedAt: string | null }[];
  travellerCategory?: string;
  travellerEmail?: string | null;
  personalTravel?: boolean;
}, enabled?: Set<string>, meta?: OutboundMeta): CanonicalOutbound {
  const on = (k: string) => !enabled || enabled.has(k);
  const out: CanonicalOutbound = {
    ...(meta ? { meta } : {}),
    authorisationNumber: req.authorisationNo ?? '',
    travellerRef: req.travellerId,
    ...(req.travellerName ? { travellerName: req.travellerName } : {}),
    bookingFor: req.bookingFor ?? 'EMPLOYEE',
    ...(req.bookingFor === 'GUEST' && req.guest ? { guest: req.guest } : {}),
    bookingMethod: req.bookingMethod ?? 'TMC_ONLINE',
    segments: [
      ...(on('airSegments') ? req.legs.map((l) => ({
        type: 'AIR' as const,
        origin: l.originCode,
        destination: l.destCode,
        departDate: l.departDate ? l.departDate.toISOString().slice(0, 10) : null,
        approvedClass: on('airApprovedClass') ? EcsReference.travelClass(l.travelClassId ?? '')?.name : undefined,
      })) : []),
      ...(on('hotelSegments') ? req.accommodation.map((a) => ({
        type: 'HOTEL' as const,
        city: a.city,
        nights: a.nights,
        cappedNightlySgd: a.cappedNightlySgd,
      })) : []),
    ],
  };
  if (on('travellers')) out.travellers = req.travellers.map((t) => t.employeeId);
  if (on('bookingDeadline')) out.bookingDeadline = req.bookingDeadline ? req.bookingDeadline.toISOString().slice(0, 10) : null;
  if (on('costCeiling')) out.approvedCostCeilingSgd = req.approvedCostCeilingSgd;
  if (on('approvedExceptions')) out.approvedExceptions = req.approvedExceptions;
  // §4.6 approved-request context
  if (on('tripPurpose') && req.travelPurpose) out.travelPurpose = req.travelPurpose;
  if (on('eventDates') && (req.eventStartDate || req.eventEndDate)) {
    out.eventStartDate = req.eventStartDate ? req.eventStartDate.toISOString().slice(0, 10) : null;
    out.eventEndDate = req.eventEndDate ? req.eventEndDate.toISOString().slice(0, 10) : null;
  }
  if (on('approvalValidity')) out.approvalValidUntil = req.approvalValidUntil ? req.approvalValidUntil.toISOString().slice(0, 10) : null;
  // §29 enrichment
  if (on('charging') && req.charging?.length) out.charging = req.charging;
  if (on('approvalMetadata') && req.approvals?.length) out.approvals = req.approvals;
  if (on('travellerCategory') && req.travellerCategory) out.traveller = { category: req.travellerCategory, email: req.travellerEmail ?? null };
  if (on('personalIndicator')) out.personalTravel = !!req.personalTravel;
  return out;
}

/**
 * Simulate the TMC returning a booking (§13.9). Produces a PNR, ticket and fares.
 * `overFare` lets the demo drive a booking-deviation scenario (S09).
 */
export function simulateInbound(out: CanonicalOutbound, opts?: { overFarePct?: number; pnrPrefix?: string }, meta?: InboundMeta): CanonicalInbound {
  const air = out.segments.filter((s) => s.type === 'AIR');
  const hotel = out.segments.filter((s) => s.type === 'HOTEL');
  const baseFare = (out.approvedCostCeilingSgd ?? 5000) * 0.6 * (1 + (opts?.overFarePct ?? 0) / 100);
  const pnrSeed = out.authorisationNumber.replace(/\D/g, '').slice(-4) || '0001';
  const prefix = opts?.pnrPrefix ?? 'PNR';
  return {
    ...(meta ? { meta } : {}),
    authorisationNumber: out.authorisationNumber,
    pnr: `${prefix}${pnrSeed}`,
    ticketNumbers: air.map((_, i) => `TKT-${pnrSeed}-${i + 1}`),
    bookingStatus: BOOKING_STATUS.Booked,
    channel: out.bookingMethod,
    fareSgd: Math.round(baseFare),
    taxesSgd: Math.round(baseFare * 0.12),
    feesSgd: 30,
    segments: [
      ...air.map((s) => ({ type: 'AIR' as const, origin: s.origin, destination: s.destination, bookedClass: s.approvedClass, departDate: s.departDate })),
      ...hotel.map((s) => ({ type: 'HOTEL' as const, city: s.city, roomRateSgd: s.cappedNightlySgd, amountSgd: (s.cappedNightlySgd ?? 0) * (s.nights ?? 0) })),
    ],
  };
}

/** Provider-specific adapter registry. In production each TMC has its own mapping of the
 * canonical model to/from the provider's wire format; here the outbound build is shared
 * (the canonical payload) and providers differ by their booking-reference prefix. The
 * handoff/receive actions pick the adapter by the resolved provider's `adapterKey`. */
export interface TmcAdapter {
  buildOutbound: typeof buildOutbound;
  simulateInbound: (out: CanonicalOutbound, opts?: { overFarePct?: number }, meta?: InboundMeta) => CanonicalInbound;
}
const withPrefix = (pnrPrefix: string): TmcAdapter => ({
  buildOutbound,
  simulateInbound: (out, opts, meta) => simulateInbound(out, { ...opts, pnrPrefix }, meta),
});
export const tmcAdapters: Record<string, TmcAdapter> = {
  fcm: withPrefix('FCM'),
  ctc: withPrefix('CTC'),
  crisis24: withPrefix('C24'),
};
export function adapterFor(adapterKey: string | null | undefined): TmcAdapter {
  return (adapterKey && tmcAdapters[adapterKey]) || tmcAdapters.fcm;
}
