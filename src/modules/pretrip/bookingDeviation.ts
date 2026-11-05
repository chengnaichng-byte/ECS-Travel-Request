// §6.4 / v1.3 Booking-deviation computation (AC10). Pure and side-effect free so it can be unit
// tested and reused by receiveBooking. Compares the booked amounts against the approved limits at
// CATEGORY level (airfare, accommodation) and at SEGMENT / PNR level (each booked PNR's air against
// the approved legs it fulfils, matched by route), not only the combined total.

export interface DeviationTolerance { bookingFarePct: number; bookingFareAbsSgd: number }

/** An approved AIR segment carried on the outbound (its per-leg approvedAmountSgd from the
 *  cost-ceiling breakdown). */
export interface ApprovedAirSegment { type?: string; origin?: string; destination?: string; approvedAmountSgd?: number }

/** One booked PNR as returned by the TMC feed (the fields the deviation check needs). */
export interface BookedForDeviation {
  pnr: string | null;
  fareSgd: number; taxesSgd: number; feesSgd: number;
  segments: { type: string; origin?: string | null; destination?: string | null; amountSgd?: number | null; roomRateSgd?: number | null }[];
}

export interface DeviationInput {
  approvedAirfareSgd: number;          // Σ approved airfare (category total)
  approvedAccommodationSgd: number;    // Σ approved accommodation (category total)
  approvedAirSegments: ApprovedAirSegment[];  // approved AIR legs with per-leg approvedAmountSgd
  booked: BookedForDeviation[];        // one entry per booked PNR
  tol: DeviationTolerance;
}

export interface Deviation { field: string; approved: number; booked: number }

/** Compute the material booking deviations. Empty array = booking is within every limit. */
export function computeBookingDeviations(input: DeviationInput): Deviation[] {
  const { approvedAirfareSgd, approvedAccommodationSgd, approvedAirSegments, booked, tol } = input;
  const allow = (approved: number) => approved + Math.min((approved * tol.bookingFarePct) / 100, tol.bookingFareAbsSgd);
  const deviations: Deviation[] = [];

  // Category level.
  const bookedAir = booked.reduce((s, b) => s + b.fareSgd + b.taxesSgd + b.feesSgd, 0);
  const bookedHotel = booked.reduce((s, b) => s + b.segments.filter((sg) => sg.type === 'HOTEL').reduce((h, sg) => h + (sg.amountSgd ?? sg.roomRateSgd ?? 0), 0), 0);
  if (approvedAirfareSgd > 0 && bookedAir > allow(approvedAirfareSgd)) deviations.push({ field: 'Airfare', approved: approvedAirfareSgd, booked: bookedAir });
  if (approvedAccommodationSgd > 0 && bookedHotel > allow(approvedAccommodationSgd)) deviations.push({ field: 'Accommodation', approved: approvedAccommodationSgd, booked: bookedHotel });

  // Segment / PNR level — match each booked PNR's air to the approved legs it fulfils (by route).
  const approvedByRoute = new Map<string, number>();
  for (const s of approvedAirSegments) {
    if (s.type !== 'AIR' || s.approvedAmountSgd == null) continue;
    const k = `${s.origin}->${s.destination}`;
    approvedByRoute.set(k, (approvedByRoute.get(k) ?? 0) + s.approvedAmountSgd);
  }
  if (approvedByRoute.size) {
    for (const b of booked) {
      const airSegs = b.segments.filter((sg) => sg.type === 'AIR');
      if (!airSegs.length) continue;
      const matched = airSegs.reduce((s, sg) => s + (approvedByRoute.get(`${sg.origin}->${sg.destination}`) ?? 0), 0);
      const bookedPnrAir = b.fareSgd + b.taxesSgd + b.feesSgd;
      if (matched > 0 && bookedPnrAir > allow(matched)) {
        const route = airSegs.map((sg) => `${sg.origin}-${sg.destination}`).join(', ');
        deviations.push({ field: `Airfare segment (PNR ${b.pnr}: ${route})`, approved: matched, booked: bookedPnrAir });
      }
    }
  }
  return deviations;
}
