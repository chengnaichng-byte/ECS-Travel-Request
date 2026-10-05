// Multi-TMC provider resolution. A travel request is routed to exactly ONE TMC provider.
// Order of precedence: (1) an explicit preferred provider on the request, when it is active
// and can serve the trip; (2) the high-risk specialist desk for high-risk destinations;
// (3) a regional provider whose scope covers the destination; (4) the default provider.
import { tmcProviders, tmcProvider, defaultTmcProvider, type TmcProvider } from '@/data/tmcProviders';
import { isHighRisk } from './risk';
import type { FullRequest } from './queries';

function supportsMethod(p: TmcProvider, method: string | null): boolean {
  if (!p.active) return false;
  if (!method) return true; // method not yet chosen (draft) — don't exclude on that basis
  return p.bookingMethods.length === 0 || p.bookingMethods.includes(method);
}
function covers(p: TmcProvider, countryCode: string | null): boolean {
  return p.scope === 'ALL' || (!!countryCode && p.scope.includes(countryCode));
}

export interface TmcResolution { provider: TmcProvider; reason: string }

export function resolveTmcProvider(req: FullRequest): TmcResolution {
  const method = req.bookingMethod ?? null;
  const country = req.destCountry ?? null;

  // 1. explicit preference
  const pref = tmcProvider(req.tmcProviderId);
  if (pref && supportsMethod(pref, method) && covers(pref, country)) {
    return { provider: pref, reason: 'Preferred provider selected on the request' };
  }

  // 2. high-risk specialist desk
  if (isHighRisk(req)) {
    const specialist = tmcProviders.find((p) => p.highRiskOnly && supportsMethod(p, method));
    if (specialist) return { provider: specialist, reason: 'High-risk destination — routed to the specialist desk' };
  }

  // 3. regional provider covering the destination
  const regional = tmcProviders.find((p) => !p.isDefault && !p.highRiskOnly && p.scope !== 'ALL' && covers(p, country) && supportsMethod(p, method));
  if (regional) return { provider: regional, reason: `Regional provider for ${country}` };

  // 4. default catch-all
  return { provider: defaultTmcProvider(), reason: 'Default provider' };
}
