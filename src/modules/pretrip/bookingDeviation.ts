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

/** v1.3 A booking deviation, scoped so a category, segment or PNR overspend can be told apart.
 *  `level` / `scopeRef` / `pnr` carry the scope; `material` + `action` carry how it is handled. */
export interface Deviation {
  field: string; approved: number; booked: number;
  level: 'TOTAL' | 'CATEGORY' | 'SEGMENT';
  scopeRef: string;            // AIRFARE | ACCOMMODATION | AIR:SIN-HND[,HND-KIX] | HOTEL:TYO
  pnr: string | null;          // the booked PNR a SEGMENT deviation is on (null at CATEGORY / TOTAL level)
  material: boolean;           // true → needs reapproval; false → logged for the record only
  action: 'Reapproval' | 'LogOnly' | 'UpdateBooking';
}

/** Compute the booking deviations. Empty array = booking is within every limit.
 *
 *  v1.3 item 1 — the airfare CATEGORY check is the primary control. Airlines often price a return or
 *  multi-city fare as a whole, so the per-leg apportionment (a prototype assumption, see the
 *  Integration Contract §4.2 / §5) can make a single leg look uneven. A per-leg (segment) airfare
 *  breach ON ITS OWN is therefore non-material (action = LogOnly): it is recorded but does not force
 *  reapproval. It becomes material (Reapproval) only when the airfare category limit is ALSO exceeded.
 *  Category breaches (airfare, accommodation) are always material. Routes never change at booking
 *  (a route that cannot be fulfilled as approved is returned not booked and needs a fresh TR/TA), so
 *  a segment is only ever a fare gap on the same route. */
export function computeBookingDeviations(input: DeviationInput): Deviation[] {
  const { approvedAirfareSgd, approvedAccommodationSgd, approvedAirSegments, booked, tol } = input;
  const allow = (approved: number) => approved + Math.min((approved * tol.bookingFarePct) / 100, tol.bookingFareAbsSgd);
  const deviations: Deviation[] = [];

  // Category level (always material).
  const bookedAir = booked.reduce((s, b) => s + b.fareSgd + b.taxesSgd + b.feesSgd, 0);
  const bookedHotel = booked.reduce((s, b) => s + b.segments.filter((sg) => sg.type === 'HOTEL').reduce((h, sg) => h + (sg.amountSgd ?? sg.roomRateSgd ?? 0), 0), 0);
  const airfareCategoryBreached = approvedAirfareSgd > 0 && bookedAir > allow(approvedAirfareSgd);
  if (airfareCategoryBreached) deviations.push({ field: 'Airfare', approved: approvedAirfareSgd, booked: bookedAir, level: 'CATEGORY', scopeRef: 'AIRFARE', pnr: null, material: true, action: 'Reapproval' });
  if (approvedAccommodationSgd > 0 && bookedHotel > allow(approvedAccommodationSgd)) deviations.push({ field: 'Accommodation', approved: approvedAccommodationSgd, booked: bookedHotel, level: 'CATEGORY', scopeRef: 'ACCOMMODATION', pnr: null, material: true, action: 'Reapproval' });

  // Segment / PNR level — match each booked PNR's air to the approved legs it fulfils (by route).
  // Material only when the airfare category is also breached (item 1); otherwise LogOnly.
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
        const routes = airSegs.map((sg) => `${sg.origin}-${sg.destination}`);
        deviations.push({
          field: `Airfare segment (PNR ${b.pnr}: ${routes.join(', ')})`, approved: matched, booked: bookedPnrAir,
          level: 'SEGMENT', scopeRef: `AIR:${routes.join(',')}`, pnr: b.pnr,
          material: airfareCategoryBreached,
          action: airfareCategoryBreached ? 'Reapproval' : 'LogOnly',
        });
      }
    }
  }
  return deviations;
}
