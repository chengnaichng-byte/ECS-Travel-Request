// Cost computations. §4.6 requires the pre-trip cost summary to separately display
// gross estimated cost, expected sponsorship, estimated NTU-funded cost, major-cost
// total, incidental-cost total, approval amount and approved booking ceiling.
// §4.5 accommodation cap and ODA indicative-estimate calculators.
import { EcsPolicy, EcsReference } from '@/shared/ecs/services';
import { EXPENSE_CATEGORY, POLICY_OUTCOME } from '@/shared/enums';
import { airfareUpgrade } from './upgrade';
import type { FullRequest } from './queries';

export interface CostSummary {
  gross: number;
  sponsorship: number;
  travellerFunded: number;   // #7 self-funded upgrade delta the traveller pays the TMC directly
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
  let gross = 0, sponsorship = 0, major = 0, incidental = 0, bookingCeiling = 0, travellerFunded = 0;
  for (const e of expenses) {
    gross += e.sgdAmount;
    sponsorship += e.sponsorSgd;
    const type = EcsReference.expenseType(e.expenseTypeId);
    if (type?.isMajorCost) major += e.sgdAmount; else incidental += e.sgdAmount;
    if (e.category === EXPENSE_CATEGORY.Airfare || e.category === EXPENSE_CATEGORY.Accommodation) {
      bookingCeiling += e.sgdAmount;
    }
    // #7 a self-funded class-upgrade delta is settled by the traveller with the TMC directly — it is
    // not an NTU cost, so it is excluded from the NTU-funded total and the approval amount (like sponsorship).
    if (e.category === EXPENSE_CATEGORY.Airfare) {
      const up = airfareUpgrade({ sgdAmount: e.sgdAmount, entitlementFareSgd: e.entitlementFareSgd, upgradeFunding: e.upgradeFunding });
      if (up.isUpgrade && up.funding === 'SELF') travellerFunded += up.travellerPaysSgd;
    }
  }
  const ntuFunded = gross - sponsorship - travellerFunded;
  let approvalAmount: number;
  switch (approvalAmountBasis) {
    case 'GROSS': approvalAmount = gross; break;
    case 'MAJOR_COST': approvalAmount = major; break;
    case 'ALLOCATION': // allocation-level amount for DOA tiering (single-alloc == NTU-funded)
    case 'NET_NTU':
    default: approvalAmount = ntuFunded; break;
  }
  return { gross, sponsorship, travellerFunded, ntuFunded, major, incidental, approvalAmount, bookingCeiling };
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

/** ECS tiered ODA by trip duration (the "Setting For Travel Periods Up To 31 Days" + Monthly
 *  allowance Rate config): days 1–15 at 100% of the daily rate, days 16–31 at 75%, and days 32+
 *  at the country's monthly allowance rate pro-rated per day (monthly ÷ 30). A short trip (≤ 15
 *  days) is unaffected. Returns the per-tier day counts/amounts so the breakdown can explain it. */
export function computeOdaTiered(input: { days: number; dailyRate: number; monthlyRate: number }) {
  const days = Math.max(0, Math.round(input.days));
  const t1End = EcsPolicy.odaTier1EndDay, t2End = EcsPolicy.odaTier2EndDay;
  const perMonth = EcsPolicy.odaMonthlyDays || 30;
  const t1 = Math.min(days, t1End);                        // days 1..tier1End  (100%)
  const t2 = Math.max(0, Math.min(days, t2End) - t1End);   // days tier1End+1..tier2End (75%)
  const t3 = Math.max(0, days - t2End);                    // days tier2End+1..  (monthly basis)
  const t1Amt = t1 * input.dailyRate * (EcsPolicy.odaTier1Pct / 100);
  const t2Amt = t2 * input.dailyRate * (EcsPolicy.odaTier2Pct / 100);
  const t3Amt = t3 * (input.monthlyRate / perMonth);
  const sgdAmount = Math.round((t1Amt + t2Amt + t3Amt) * 100) / 100;
  return { days, t1, t2, t3, t1Amt, t2Amt, t3Amt, sgdAmount, dailyRate: input.dailyRate, monthlyRate: input.monthlyRate };
}

export function fmtSgd(n: number): string {
  return new Intl.NumberFormat('en-SG', { style: 'currency', currency: 'SGD', maximumFractionDigits: 2 }).format(n || 0);
}
