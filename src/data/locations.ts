// §13.7 / §2.4 Location master (shared ECS). Clear country > city > airport
// hierarchy because policy calculations and TMC booking use different levels.
export interface Country { code: string; name: string; overseas: boolean; }
export interface City { code: string; name: string; countryCode: string; timezone: string; }
export interface Airport { code: string; name: string; cityCode: string; }

export const countries: Country[] = [
  { code: 'SG', name: 'Singapore',      overseas: false },
  { code: 'JP', name: 'Japan',          overseas: true },
  { code: 'GB', name: 'United Kingdom', overseas: true },
  { code: 'FR', name: 'France',         overseas: true },
  { code: 'EG', name: 'Egypt',          overseas: true },
];

export const cities: City[] = [
  { code: 'SIN', name: 'Singapore', countryCode: 'SG', timezone: 'UTC+8' },
  { code: 'TYO', name: 'Tokyo',     countryCode: 'JP', timezone: 'UTC+9' },
  { code: 'OSA', name: 'Osaka',     countryCode: 'JP', timezone: 'UTC+9' },
  { code: 'LON', name: 'London',    countryCode: 'GB', timezone: 'UTC+0' },
  { code: 'PAR', name: 'Paris',     countryCode: 'FR', timezone: 'UTC+1' },
  { code: 'CAI', name: 'Cairo',     countryCode: 'EG', timezone: 'UTC+2' },
];

export const airports: Airport[] = [
  { code: 'SIN', name: 'Singapore Changi',       cityCode: 'SIN' },
  { code: 'HND', name: 'Tokyo Haneda',           cityCode: 'TYO' },
  { code: 'NRT', name: 'Tokyo Narita',           cityCode: 'TYO' },
  { code: 'KIX', name: 'Osaka Kansai',           cityCode: 'OSA' },
  { code: 'LHR', name: 'London Heathrow',        cityCode: 'LON' },
  { code: 'CDG', name: 'Paris Charles de Gaulle', cityCode: 'PAR' },
  { code: 'CAI', name: 'Cairo International',     cityCode: 'CAI' },
];

/** Approx. non-stop flight hours from Singapore — drives travel-class duration bands (§13.19). */
export const flightHoursFromSIN: Record<string, number> = { TYO: 7, OSA: 7, LON: 13, PAR: 13, CAI: 11, SIN: 0 };
