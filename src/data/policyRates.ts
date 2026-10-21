// §13.7 Effective-dated hotel caps and ODA rates (existing ECS policy config,
// same values used by TE — §2). Consumed read-only by the pre-trip module.

export interface HotelCap { cityCode: string; capNightlySgd: number; effectiveFrom: string; }
export interface CountryHotelCap { countryCode: string; capNightlySgd: number; effectiveFrom: string; }
export interface OdaRate  { countryCode: string; dailyRateSgd: number; monthlyRateSgd: number; effectiveFrom: string; }

// §13.7 / §15 city-specific caps (override the country cap for high-cost cities).
export const hotelCaps: HotelCap[] = [
  { cityCode: 'TYO', capNightlySgd: 350, effectiveFrom: '2025-01-01' },
  { cityCode: 'OSA', capNightlySgd: 300, effectiveFrom: '2025-01-01' },
  { cityCode: 'LON', capNightlySgd: 280, effectiveFrom: '2025-01-01' },
  { cityCode: 'PAR', capNightlySgd: 300, effectiveFrom: '2025-01-01' },
  { cityCode: 'SIN', capNightlySgd: 200, effectiveFrom: '2025-01-01' },
];

// §15 accommodation cap maintained BY COUNTRY (A–Z), mirroring the ECS maintenance
// screen. Used as the fallback when a city has no city-specific cap above.
export const hotelCapsByCountry: CountryHotelCap[] = [
  { countryCode: 'AU', capNightlySgd: 260, effectiveFrom: '2025-01-01' },
  { countryCode: 'CN', capNightlySgd: 240, effectiveFrom: '2025-01-01' },
  { countryCode: 'DE', capNightlySgd: 270, effectiveFrom: '2025-01-01' },
  { countryCode: 'EG', capNightlySgd: 180, effectiveFrom: '2025-01-01' },
  { countryCode: 'FR', capNightlySgd: 290, effectiveFrom: '2025-01-01' },
  { countryCode: 'GB', capNightlySgd: 300, effectiveFrom: '2025-01-01' },
  { countryCode: 'HK', capNightlySgd: 280, effectiveFrom: '2025-01-01' },
  { countryCode: 'IN', capNightlySgd: 180, effectiveFrom: '2025-01-01' },
  { countryCode: 'JP', capNightlySgd: 320, effectiveFrom: '2025-01-01' },
  { countryCode: 'KR', capNightlySgd: 260, effectiveFrom: '2025-01-01' },
  { countryCode: 'MY', capNightlySgd: 150, effectiveFrom: '2025-01-01' },
  { countryCode: 'SG', capNightlySgd: 200, effectiveFrom: '2025-01-01' },
  { countryCode: 'US', capNightlySgd: 330, effectiveFrom: '2025-01-01' },
];

// §13.7 / §16 country ODA rates (A–Z sample).
// Daily ODA rate + the long-term monthly allowance rate per country (the ECS "Monthly allowance
// Rate", applied once a trip runs past the daily-tier window — see the ODA duration tiers below).
export const odaRates: OdaRate[] = [
  { countryCode: 'AU', dailyRateSgd: 125, monthlyRateSgd: 2250, effectiveFrom: '2025-01-01' },
  { countryCode: 'CN', dailyRateSgd: 100, monthlyRateSgd: 1800, effectiveFrom: '2025-01-01' },
  { countryCode: 'DE', dailyRateSgd: 120, monthlyRateSgd: 2200, effectiveFrom: '2025-01-01' },
  { countryCode: 'EG', dailyRateSgd: 90,  monthlyRateSgd: 1600, effectiveFrom: '2025-01-01' },
  { countryCode: 'FR', dailyRateSgd: 110, monthlyRateSgd: 2000, effectiveFrom: '2025-01-01' },
  { countryCode: 'GB', dailyRateSgd: 130, monthlyRateSgd: 2350, effectiveFrom: '2025-01-01' },
  { countryCode: 'HK', dailyRateSgd: 115, monthlyRateSgd: 2050, effectiveFrom: '2025-01-01' },
  { countryCode: 'IN', dailyRateSgd: 85,  monthlyRateSgd: 1500, effectiveFrom: '2025-01-01' },
  { countryCode: 'JP', dailyRateSgd: 120, monthlyRateSgd: 2200, effectiveFrom: '2025-01-01' },
  { countryCode: 'KR', dailyRateSgd: 110, monthlyRateSgd: 2000, effectiveFrom: '2025-01-01' },
  { countryCode: 'MY', dailyRateSgd: 75,  monthlyRateSgd: 1350, effectiveFrom: '2025-01-01' },
  { countryCode: 'US', dailyRateSgd: 140, monthlyRateSgd: 2500, effectiveFrom: '2025-01-01' },
];

/**
 * §13.7 travel-period percentages: departure & return days paid at 50%, full days
 * at 100% (ODA excludes personal days — §4.5, AC18). Retained for reference; the live
 * per-city ODA uses the duration tiers below, not the departure/return split.
 */
export const ODA_TRAVEL_DAY_PCT = 50;
export const ODA_FULL_DAY_PCT = 100;
// Number of days at each end of the trip (departure + return) paid at the travel-day
// rate rather than the full-day rate.
export const ODA_TRAVEL_DAYS = 2;

/**
 * ECS ODA duration tiers ("Setting For Travel Periods Up To 31 Days" + Monthly allowance Rate):
 *  • days 1–15   → 100% of the daily rate,
 *  • days 16–31  → 75% of the daily rate,
 *  • days 32+    → the country's monthly allowance rate, pro-rated per day (rate ÷ 30).
 * A short trip (≤ 15 days) is therefore unaffected (full daily rate); the step-downs only
 * apply to longer-term travel.
 */
export const ODA_TIER1_END_DAY = 15;   // last day paid at 100%
export const ODA_TIER1_PCT = 100;
export const ODA_TIER2_END_DAY = 31;   // last day paid at 75%
export const ODA_TIER2_PCT = 75;
export const ODA_MONTHLY_DAYS = 30;    // divisor turning the monthly allowance into a daily figure beyond day 31
