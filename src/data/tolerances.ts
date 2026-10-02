// §13.7 Tolerances — booking deviation, date shift, estimate amendment threshold.
// Consumed by the policy engine (§6.4 material-change table) and booking
// reconciliation (§6.4, AC10, AC19).
export const tolerances = {
  // Booking deviation: fare +10% or +SGD 200 whichever lower
  bookingFarePct: 10,
  bookingFareAbsSgd: 200,
  // Date shift tolerance: 2 days
  dateShiftDays: 2,
  // Estimate amendment threshold: +10% or +SGD 500
  estimateAmendPct: 10,
  estimateAmendAbsSgd: 500,
} as const;
