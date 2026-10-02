// Cost computations. §4.6 requires the pre-trip cost summary to separately display
// gross estimated cost, expected sponsorship, estimated NTU-funded cost, major-cost
// total, incidental-cost total, approval amount and approved booking ceiling.
// §4.5 accommodation cap and ODA indicative-estimate calculators.
import { EcsPolicy, EcsReference } from '@/shared/ecs/services';
import { EXPENSE_CATEGORY, POLICY_OUTCOME } from '@/shared/enums';
import type { FullRequest } from './queries';

export interface CostSummary {
  gross: number;
  sponsorship: number;
  ntuFunded: number;
  major: number;
  incidental: number;
  approvalAmount: number;
  bookingCeiling: number;
}

export function computeSummary(
  expenses: FullRequest['expenses'],
  approvalAmountBasis: string,
): CostSummary {
  let gross = 0, sponsorship = 0, major = 0, incidental = 0, bookingCeiling = 0;
  for (const e of expenses) {
    gross += e.sgdAmount;
    sponsorship += e.sponsorSgd;
    const type = EcsReference.expenseType(e.expenseTypeId);
    if (type?.isMajorCost) major += e.sgdAmount; else incidental += e.sgdAmount;
    if (e.category === EXPENSE_CATEGORY.Airfare || e.category === EXPENSE_CATEGORY.Accommodation) {
      bookingCeiling += e.sgdAmount;
    }
  }
  const ntuFunded = gross - sponsorship;
  let approvalAmount: number;
  switch (approvalAmountBasis) {
    case 'GROSS': approvalAmount = gross; break;
    case 'MAJOR_COST': approvalAmount = major; break;
    case 'ALLOCATION': // allocation-level amount for DOA tiering (single-alloc == NTU-funded)
    case 'NET_NTU':
    default: approvalAmount = ntuFunded; break;
  }
  return { gross, sponsorship, ntuFunded, major, incidental, approvalAmount, bookingCeiling };
}

/** §4.5 accommodation: cap, budgeted rate per basis, variance and exception outcome. */
export function computeAccommodation(input: {
  cityCode: string;
  nights: number;
  personalNights: number;
  quotedNightly: number;
  basis: string; // QUOTED | CAP | LOWER
}) {
  const capNightly = EcsPolicy.hotelCap(input.cityCode) ?? 0;
  const chargeableNights = Math.max(input.nights - input.personalNights, 0);
  let budgetedNightly: number;
  switch (input.basis) {
    case 'QUOTED': budgetedNightly = input.quotedNightly; break;
    case 'CAP': budgetedNightly = capNightly; break;
    case 'LOWER':
    default: budgetedNightly = Math.min(input.quotedNightly, capNightly || input.quotedNightly); break;
  }
  const overCap = capNightly > 0 && input.quotedNightly > capNightly;
  const capVariance = overCap ? (input.quotedNightly - capNightly) * chargeableNights : 0;
  const sgdAmount = budgetedNightly * chargeableNights;
  return {
    capNightly,
    budgetedNightly,
    chargeableNights,
    capVariance,
    sgdAmount,
    outcome: overCap ? POLICY_OUTCOME.Exception : POLICY_OUTCOME.Pass,
  };
}

/** §4.5 ODA indicative estimate. Departure & return days at 50%, full days at 100%;
 *  personal days excluded (AC18). Rates are already in SGD. */
export function computeOda(input: {
  countryCode: string;
  arrive: Date | null;
  depart: Date | null;
  personalDays: number;
}) {
  const dailyRate = EcsPolicy.odaRate(input.countryCode) ?? 0;
  let totalDays = 0;
  if (input.arrive && input.depart) {
    totalDays = Math.max(Math.round((input.depart.getTime() - input.arrive.getTime()) / 86400000) + 1, 0);
  }
  const eligibleDays = Math.max(totalDays - input.personalDays, 0);
  const travelDays = Math.min(eligibleDays, EcsPolicy.odaTravelDays);           // departure + return at travel-day rate
  const fullDays = Math.max(eligibleDays - EcsPolicy.odaTravelDays, 0);
  const sgdAmount = dailyRate * (fullDays * (EcsPolicy.odaFullDayPct / 100) + travelDays * (EcsPolicy.odaTravelDayPct / 100));
  return { dailyRate, totalDays, eligibleDays, sgdAmount };
}

export function fmtSgd(n: number): string {
  return new Intl.NumberFormat('en-SG', { style: 'currency', currency: 'SGD', maximumFractionDigits: 2 }).format(n || 0);
}
