// §4.4/§13.14 Main destination derivation — shared by the Trip step (save) and the Review page so
// both record the SAME "main country/city of travel". The rule is the COUNTRY with the LONGEST stay
// (nights summed by destination country across the non-personal legs), then the longest-stay city
// within that country. Ties at either level are broken alphabetically by name. Falls back to the first non-personal
// leg's destination when no nights exist
// (e.g. a same-day return). Returns ECS cityCode + countryCode (empty strings when there are no legs).
import { EcsReference } from '@/shared/ecs/services';

export type DestLeg = { destCode: string; nights?: number | null; isPersonal?: boolean | null };

export function mainDestination(legs: DestLeg[]): { cityCode: string; countryCode: string } {
  const cityOf = (ap: string) => EcsReference.airport(ap)?.cityCode ?? ap;
  const countryOf = (city: string) => EcsReference.city(city)?.countryCode ?? '';
  const cityName = (code: string) => EcsReference.city(code)?.name ?? code;
  const countryName = (code: string) => EcsReference.country(code)?.name ?? code;
  const nightsByCountry = new Map<string, number>();
  const nightsByCity = new Map<string, number>();
  for (const l of legs) {
    if (l.isPersonal) continue;
    const city = cityOf(l.destCode);
    const country = countryOf(city);
    if (!country) continue;
    nightsByCountry.set(country, (nightsByCountry.get(country) ?? 0) + (l.nights ?? 0));
    nightsByCity.set(city, (nightsByCity.get(city) ?? 0) + (l.nights ?? 0));
  }
  // Longest-stay country; ties broken alphabetically by country name (deterministic).
  const topCountry = [...nightsByCountry.entries()].sort((a, b) => b[1] - a[1] || countryName(a[0]).localeCompare(countryName(b[0])))[0];
  if (topCountry && topCountry[1] > 0) {
    const countryCode = topCountry[0];
    // Longest-stay city within the country; ties broken alphabetically by city name (deterministic).
    const cityCode = [...nightsByCity.entries()]
      .filter(([c]) => countryOf(c) === countryCode)
      .sort((a, b) => b[1] - a[1] || cityName(a[0]).localeCompare(cityName(b[0])))[0]?.[0] ?? '';
    if (cityCode) return { cityCode, countryCode };
  }
  // Fallback — first non-personal leg (else the first leg) destination.
  const first = legs.find((l) => !l.isPersonal) ?? legs[0];
  if (first) { const cityCode = cityOf(first.destCode); return { cityCode, countryCode: countryOf(cityCode) }; }
  return { cityCode: '', countryCode: '' };
}
