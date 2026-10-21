// §13.9 / DD-17 TA-keyed TMC booking retrieval. With the pre-trip module inside ECS the
// Travel Authorisation (TA / TR) is the anchor: the claimant creates the TE FROM the TR, and
// the TMC exposes booking retrieval BY the authorisation number — returning the FULL SET of
// PNRs under that TA — rather than the legacy PNR-by-PNR lookup. One TR → N PNRs (a multi-city
// itinerary is commonly split for competitive fares), so keying by TA returns them all in one
// call, ties the actuals to the governed authority (which the DD-08 auto-grant reconciles
// against), and survives a re-issue (a new PNR/ticket under the same TA is picked up
// automatically). The PNR remains the TMC's native record id; the TA is the query key.
//
// In the prototype the inbound is PUSH-primary: receiveBooking already stores bookings against
// the TR (requestId), so this is the read over that stored set — the shape a real TMC "GET
// bookings for TA-YYYY-NNNNNN" endpoint would return. A self-booked trip returns an empty set
// (no TMC PNR); the claimant then enters actuals manually.
import type { FullRequest } from './queries';

export interface RetrievedSegment {
  type: string;                 // AIR | HOTEL
  originCode: string | null;
  destCode: string | null;
  departDate: Date | null;
  arriveDate: Date | null;      // now captured on inbound (was previously dropped)
  bookedClassId: string | null;
  amount: number | null;
}

export interface RetrievedPnr {
  pnr: string | null;
  ticketNo: string | null;
  providerId: string | null;
  travellerId: string | null;   // group fan-out: one booking per traveller
  status: string;
  fareSgd: number;
  taxesSgd: number;
  feesSgd: number;
  hotelRateSgd: number | null;
  totalSgd: number;
  segments: RetrievedSegment[];
}

export interface TaBookingSet {
  authorisationNo: string | null;
  pnrCount: number;
  bookings: RetrievedPnr[];
  totalFareSgd: number;         // Σ air fare+taxes+fees across every PNR
}

/** Retrieve the full set of bookings/PNRs for a request's Travel Authorisation — the TA-keyed
 *  "bookings by authorisation number" view. Empty `bookings` = not yet booked or self-booked. */
export function bookingsForAuthorisation(req: FullRequest): TaBookingSet {
  const bookings: RetrievedPnr[] = (req.bookings ?? []).map((b) => {
    const fareSgd = b.fare ?? 0, taxesSgd = b.taxes ?? 0, feesSgd = b.fees ?? 0;
    return {
      pnr: b.pnr ?? null,
      ticketNo: b.ticketNo ?? null,
      providerId: b.tmcProviderId ?? null,
      travellerId: b.travellerId ?? null,
      status: b.status,
      fareSgd, taxesSgd, feesSgd,
      hotelRateSgd: b.hotelRate ?? null,
      totalSgd: Math.round((fareSgd + taxesSgd + feesSgd) * 100) / 100,
      segments: (b.segments ?? []).map((s) => ({
        type: s.type,
        originCode: s.originCode ?? null,
        destCode: s.destCode ?? null,
        departDate: s.departDate ?? null,
        arriveDate: s.arriveDate ?? null,
        bookedClassId: s.bookedClassId ?? null,
        amount: s.amount ?? null,
      })),
    };
  });
  return {
    authorisationNo: req.authorisationNo ?? null,
    pnrCount: bookings.length,
    bookings,
    totalFareSgd: Math.round(bookings.reduce((s, b) => s + b.totalSgd, 0) * 100) / 100,
  };
}

/** DD-17 Map each shared AIR leg to the PNR that ticketed it — by matching origin + destination
 *  (and the depart date when both are present) against the booked segments. Returns legId → PNR.
 *  A leg with no clean match is simply absent (no tag), so a booking whose segments don't line up
 *  with the planned legs (e.g. a date change at the OBT) degrades to the TR-level summary rather
 *  than mis-tagging a leg. Hotel segments are not flight legs and are never tagged here. */
export function legPnrMap(req: FullRequest): Record<string, string> {
  const map: Record<string, string> = {};
  const sameDay = (a: Date | null, b: Date | null) =>
    a && b ? a.toISOString().slice(0, 10) === b.toISOString().slice(0, 10) : true;
  const shared = (req.legs ?? []).filter((l) => !l.travellerId);
  for (const b of req.bookings ?? []) {
    if (!b.pnr) continue;
    const air = (b.segments ?? []).filter((s) => s.type === 'AIR');
    for (const l of shared) {
      if (map[l.id]) continue;
      const hit = air.find((s) => s.originCode === l.originCode && s.destCode === l.destCode && sameDay(s.departDate, l.departDate));
      if (hit) map[l.id] = b.pnr!;
    }
  }
  return map;
}
