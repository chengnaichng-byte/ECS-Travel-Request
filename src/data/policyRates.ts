// §13.7 Effective-dated hotel caps and ODA rates (existing ECS policy config,
// same values used by TE — §2). Consumed read-only by the pre-trip module.

export interface HotelCap { cityCode: string; capNightlySgd: number; effectiveFrom: string; }
export interface CountryHotelCap { countryCode: string; capNightlySgd: number; effectiveFrom: string; }
export interface OdaRate  { countryCode: string; dailyRateSgd: number; effectiveFrom: string; }

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
export const odaRates: OdaRate[] = [
  { countryCode: 'AU', dailyRateSgd: 125, effectiveFrom: '2025-01-01' },
  { countryCode: 'CN', dailyRateSgd: 100, effectiveFrom: '2025-01-01' },
  { countryCode: 'DE', dailyRateSgd: 120, effectiveFrom: '2025-01-01' },
  { countryCode: 'FR', dailyRateSgd: 110, effectiveFrom: '2025-01-01' },
  { countryCode: 'GB', dailyRateSgd: 130, effectiveFrom: '2025-01-01' },
  { countryCode: 'HK', dailyRateSgd: 115, effectiveFrom: '2025-01-01' },
  { countryCode: 'IN', dailyRateSgd: 85,  effectiveFrom: '2025-01-01' },
  { countryCode: 'JP', dailyRateSgd: 120, effectiveFrom: '2025-01-01' },
  { countryCode: 'KR', dailyRateSgd: 110, effectiveFrom: '2025-01-01' },
  { countryCode: 'MY', dailyRateSgd: 75,  effectiveFrom: '2025-01-01' },
  { countryCode: 'US', dailyRateSgd: 140, effectiveFrom: '2025-01-01' },
];

/**
 * §13.7 travel-period percentages: departure & return days paid at 50%, full days
 * at 100% (ODA excludes personal days — §4.5, AC18).
 */
export const ODA_TRAVEL_DAY_PCT = 50;
export const ODA_FULL_DAY_PCT = 100;
// Number of days at each end of the trip (departure + return) paid at the travel-day
// rate rather than the full-day rate.
export const ODA_TRAVEL_DAYS = 2;
