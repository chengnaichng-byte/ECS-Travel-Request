// §6.4 Booking-deviation computation (AC10). Pure and side-effect free so it can be unit tested and
// reused by receiveBooking. Compares the booked itinerary against the FROZEN approval snapshot at
// CATEGORY level (airfare, accommodation amounts; travel dates) and at SEGMENT / PNR level (per-PNR
// airfare, booked cabin class, booked route).
//
// Post-approval model (NTU Finance confirmed): the approved amount is a REFERENCE, not a booking
// limit — bookings are never blocked. A deviation is REVIEWED AT CLAIM approval; there is no in-system
// re-approval after the TR is approved. A material deviation (material = true) is flagged to the claim
// approver (action = ReviewAtClaim); a non-material one is recorded for the record (action = LogOnly).

export interface DeviationThreshold { pct: number; absSgd: number }   // §6.4 category-amount materiality (AND of both)
export interface DateShiftLimit { daysBefore: number; daysAfter: number }

/** An approved AIR segment carried on the snapshot: its per-leg approved amount, approved cabin class
 *  and approved departure date. */
export interface ApprovedAirSegment {
  type?: string; origin?: string; destination?: string;
  approvedAmountSgd?: number; approvedClass?: string; departDate?: string | null;
}

/** One booked PNR as returned by the TMC feed (the fields the deviation check needs). */
export interface BookedForDeviation {
  pnr: string | null;
  fareSgd: number; taxesSgd: number; feesSgd: number;
  segments: {
    type: string; origin?: string | null; destination?: string | null;
    amountSgd?: number | null; roomRateSgd?: number | null;
    bookedClass?: string | null; departDate?: string | null;
  }[];
}

export interface DeviationInput {
  approvedAirfareSgd: number;          // Σ approved airfare (category total, from the snapshot)
  approvedAccommodationSgd: number;    // Σ approved accommodation (category total, from the snapshot)
  approvedAirSegments: ApprovedAirSegment[];  // approved AIR legs (amount / class / date)
  booked: BookedForDeviation[];        // one entry per booked PNR
  threshold: DeviationThreshold;       // §6.4 category-amount materiality (deviationThreshold* settings)
  // §6.4 class / date checks (optional; omitted inputs skip that check)
  classRankByName?: Record<string, number>;  // cabin-class name → rank (higher number = higher cabin)
  hasApprovedClassException?: boolean;        // an approved CLASS policy exception authorises a higher cabin
  dateShift?: DateShiftLimit;                 // online-booking date-shift allowance (days before / after approved)
  validityEnd?: string | null;                // approval validity (ISO date); a booked date beyond it deviates
}

export type DeviationAction = 'ReviewAtClaim' | 'LogOnly' | 'UpdateBooking';

/** A booking deviation, scoped so a category, segment or PNR variance can be told apart. `level` /
 *  `scopeRef` / `pnr` carry the scope; `material` + `action` carry how it is handled at claim. */
export interface Deviation {
  field: string;
  approvedValue: string; bookedValue: string;
  level: 'TOTAL' | 'CATEGORY' | 'SEGMENT';
  scopeRef: string;            // AIRFARE | ACCOMMODATION | DATES | AIR:SIN-HND[,…] | CLASS:SIN-HND | ROUTE:SIN-HND
  pnr: string | null;          // the booked PNR a SEGMENT deviation is on (null at CATEGORY / TOTAL level)
  material: boolean;           // true → ReviewAtClaim (flagged to the claim approver); false → LogOnly
  action: DeviationAction;
}

/** §8 Map a deviation's scopeRef to the evidence-type token used by ModuleSettings.evidenceRequiredFor
 *  (CLASS | DATES | ROUTE | CATEGORY_AMOUNT). Segment airfare (AIR:...) has no own evidence type — when
 *  material it is only ever accompanied by a CATEGORY airfare deviation, which carries CATEGORY_AMOUNT.
 *  Returns null for a type that never requires evidence. */
export function evidenceTypeFor(scopeRef: string): string | null {
  if (scopeRef.startsWith('CLASS:')) return 'CLASS';
  if (scopeRef === 'DATES') return 'DATES';
  if (scopeRef.startsWith('ROUTE:')) return 'ROUTE';
  if (scopeRef === 'AIRFARE' || scopeRef === 'ACCOMMODATION') return 'CATEGORY_AMOUNT';
  return null;
}

const sgd0 = (n: number) => n.toFixed(0);
const route = (o?: string | null, d?: string | null) => `${o}-${d}`;
const dayNum = (iso: string) => Math.floor(new Date(`${iso}T00:00:00Z`).getTime() / 86400000);

/** Compute the booking deviations. Empty array = booking matches the approved reference within every
 *  threshold. `material` deviations are reviewed at claim; nothing here blocks a booking.
 *
 *  §6.4 item 1 — the airfare CATEGORY check is the primary control. A per-leg (segment) airfare breach
 *  ON ITS OWN is non-material (LogOnly): the per-leg apportionment is a prototype assumption, so it is
 *  recorded but not flagged. It becomes material (ReviewAtClaim) only when the airfare category amount
 *  is ALSO over threshold. A category amount is material only when it exceeds the approved amount by
 *  more than BOTH the percentage AND the absolute threshold. */
export function computeBookingDeviations(input: DeviationInput): Deviation[] {
  const {
    approvedAirfareSgd, approvedAccommodationSgd, approvedAirSegments, booked, threshold,
    classRankByName, hasApprovedClassException, dateShift, validityEnd,
  } = input;
  const deviations: Deviation[] = [];

  // A category amount is material only when the excess is over BOTH the % and the SGD threshold.
  const overBoth = (approved: number, bookedAmt: number) => {
    const excess = bookedAmt - approved;
    return excess > (approved * threshold.pct) / 100 && excess > threshold.absSgd;
  };

  // ---- Category amounts (airfare, accommodation) — always material when over threshold.
  const bookedAir = booked.reduce((s, b) => s + b.fareSgd + b.taxesSgd + b.feesSgd, 0);
  const bookedHotel = booked.reduce((s, b) => s + b.segments.filter((sg) => sg.type === 'HOTEL').reduce((h, sg) => h + (sg.amountSgd ?? sg.roomRateSgd ?? 0), 0), 0);
  const airfareCategoryBreached = approvedAirfareSgd > 0 && overBoth(approvedAirfareSgd, bookedAir);
  if (airfareCategoryBreached) deviations.push({ field: 'Airfare', approvedValue: sgd0(approvedAirfareSgd), bookedValue: sgd0(bookedAir), level: 'CATEGORY', scopeRef: 'AIRFARE', pnr: null, material: true, action: 'ReviewAtClaim' });
  if (approvedAccommodationSgd > 0 && overBoth(approvedAccommodationSgd, bookedHotel)) deviations.push({ field: 'Accommodation', approvedValue: sgd0(approvedAccommodationSgd), bookedValue: sgd0(bookedHotel), level: 'CATEGORY', scopeRef: 'ACCOMMODATION', pnr: null, material: true, action: 'ReviewAtClaim' });

  // ---- Approved-leg lookups (by route) for the segment / class / date checks.
  const approvedAmtByRoute = new Map<string, number>();
  const approvedClassByRoute = new Map<string, string | undefined>();
  const approvedDateByRoute = new Map<string, string | null | undefined>();
  for (const s of approvedAirSegments) {
    if (s.type !== 'AIR') continue;
    const k = route(s.origin, s.destination);
    if (s.approvedAmountSgd != null) approvedAmtByRoute.set(k, (approvedAmtByRoute.get(k) ?? 0) + s.approvedAmountSgd);
    if (!approvedClassByRoute.has(k)) approvedClassByRoute.set(k, s.approvedClass);
    if (!approvedDateByRoute.has(k)) approvedDateByRoute.set(k, s.departDate);
  }

  // ---- Segment / PNR airfare — material only when the airfare category is also over threshold (item 1).
  if (approvedAmtByRoute.size) {
    for (const b of booked) {
      const airSegs = b.segments.filter((sg) => sg.type === 'AIR');
      if (!airSegs.length) continue;
      const matched = airSegs.reduce((s, sg) => s + (approvedAmtByRoute.get(route(sg.origin, sg.destination)) ?? 0), 0);
      const bookedPnrAir = b.fareSgd + b.taxesSgd + b.feesSgd;
      if (matched > 0 && bookedPnrAir > matched * (1 + threshold.pct / 100)) {
        const routes = airSegs.map((sg) => route(sg.origin, sg.destination));
        deviations.push({
          field: `Airfare segment (PNR ${b.pnr}: ${routes.join(', ')})`, approvedValue: sgd0(matched), bookedValue: sgd0(bookedPnrAir),
          level: 'SEGMENT', scopeRef: `AIR:${routes.join(',')}`, pnr: b.pnr,
          material: airfareCategoryBreached, action: airfareCategoryBreached ? 'ReviewAtClaim' : 'LogOnly',
        });
      }
    }
  }

  // ---- Route change — a booked route with no approved match should not occur (TMC returns NOT BOOKED);
  // if one is received, flag it (always material).
  for (const b of booked) {
    for (const sg of b.segments.filter((s) => s.type === 'AIR')) {
      const k = route(sg.origin, sg.destination);
      if (!approvedAmtByRoute.has(k) && !approvedClassByRoute.has(k)) {
        deviations.push({ field: `Route change (PNR ${b.pnr}: ${k})`, approvedValue: 'approved routes', bookedValue: k, level: 'SEGMENT', scopeRef: `ROUTE:${k}`, pnr: b.pnr, material: true, action: 'ReviewAtClaim' });
      }
    }
  }

  // ---- Cabin class — a booked class above the approved class, without a matching approved exception,
  // is material (always). Needs the class-rank map; skipped when not provided.
  if (classRankByName && !hasApprovedClassException) {
    for (const b of booked) {
      for (const sg of b.segments.filter((s) => s.type === 'AIR')) {
        const k = route(sg.origin, sg.destination);
        const approvedClass = approvedClassByRoute.get(k);
        const bookedClass = sg.bookedClass ?? undefined;
        if (!approvedClass || !bookedClass) continue;
        const ar = classRankByName[approvedClass], br = classRankByName[bookedClass];
        if (ar != null && br != null && br > ar) {
          deviations.push({ field: `Cabin class above approved (PNR ${b.pnr}: ${k})`, approvedValue: approvedClass, bookedValue: bookedClass, level: 'SEGMENT', scopeRef: `CLASS:${k}`, pnr: b.pnr, material: true, action: 'ReviewAtClaim' });
        }
      }
    }
  }

  // ---- Travel dates — a booked date beyond the approved date ± the shift limit, or beyond the approval
  // validity, is material (CATEGORY / DATES). One aggregated deviation naming the first offending leg.
  if (dateShift || validityEnd) {
    for (const b of booked) {
      let hit: { k: string; approved?: string | null; booked: string; why: string } | null = null;
      for (const sg of b.segments.filter((s) => s.type === 'AIR')) {
        if (!sg.departDate) continue;
        const k = route(sg.origin, sg.destination);
        const bd = dayNum(sg.departDate);
        if (validityEnd && bd > dayNum(validityEnd)) { hit = { k, approved: `≤ ${validityEnd}`, booked: sg.departDate, why: 'beyond approval validity' }; break; }
        const ad = approvedDateByRoute.get(k);
        if (dateShift && ad) {
          const diff = bd - dayNum(ad);
          if (diff < -dateShift.daysBefore || diff > dateShift.daysAfter) { hit = { k, approved: ad, booked: sg.departDate, why: `${diff > 0 ? '+' : ''}${diff} days vs approved` }; break; }
        }
      }
      if (hit) {
        deviations.push({ field: `Travel date out of range (PNR ${b.pnr}: ${hit.k}, ${hit.why})`, approvedValue: String(hit.approved ?? '—'), bookedValue: hit.booked, level: 'CATEGORY', scopeRef: 'DATES', pnr: null, material: true, action: 'ReviewAtClaim' });
        break; // one DATES deviation per request is enough to flag for claim review
      }
    }
  }

  return deviations;
}
