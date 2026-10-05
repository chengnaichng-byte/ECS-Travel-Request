// §4.8 High-risk travel detection. A request is high-risk when its destination country, or
// any itinerary leg's destination country, is a configured active high-risk destination.
import { EcsReference } from '@/shared/ecs/services';
import type { HighRiskDestination } from '@/data/highRiskDestinations';
import type { FullRequest } from './queries';

/** All distinct active high-risk destinations touched by the request (dest + legs). */
export function highRiskDestinationsForRequest(req: FullRequest): HighRiskDestination[] {
  const countries = new Set<string>();
  if (req.destCountry) countries.add(req.destCountry);
  for (const l of req.legs) {
    if (l.isPersonal) continue;
    const cc = EcsReference.city(EcsReference.airport(l.destCode)?.cityCode ?? l.destCode)?.countryCode;
    if (cc) countries.add(cc);
  }
  const hits: HighRiskDestination[] = [];
  for (const c of countries) { const h = EcsReference.highRiskForCountry(c); if (h) hits.push(h); }
  return hits;
}

export function isHighRisk(req: FullRequest): boolean {
  return highRiskDestinationsForRequest(req).length > 0;
}
