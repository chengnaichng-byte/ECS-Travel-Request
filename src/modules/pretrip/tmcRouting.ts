// Multi-TMC provider resolution. A travel request is routed to exactly ONE TMC provider.
// Order of precedence: (1) an explicit preferred provider on the request, when it is active
// and can serve the trip; (2) the high-risk specialist desk for high-risk destinations;
// (3) a regional provider whose scope covers the destination; (4) the default provider.
// The provider list is the live, DB-effective registry (tmcConfig.listTmcProviders); a pure
// variant takes the list so it can be unit-tested and reused without a DB round-trip.
import { tmcProviders as seedProviders, type TmcProvider } from '@/data/tmcProviders';
import { listTmcProviders } from './tmcConfig';
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
function defaultProvider(list: TmcProvider[]): TmcProvider {
  return list.find((p) => p.isDefault && p.active) ?? list.find((p) => p.active) ?? list[0];
}

export interface TmcResolution { provider: TmcProvider; reason: string }

/** Pure resolution over a given provider list (the live registry, or the seed for tests). */
export function resolveTmcProviderFrom(req: FullRequest, providers: TmcProvider[]): TmcResolution {
  const method = req.bookingMethod ?? null;
  const country = req.destCountry ?? null;

  const pref = req.tmcProviderId ? providers.find((p) => p.id === req.tmcProviderId) : undefined;
  if (pref && supportsMethod(pref, method) && covers(pref, country)) {
    return { provider: pref, reason: 'Preferred provider selected on the request' };
  }
  if (isHighRisk(req)) {
    const specialist = providers.find((p) => p.highRiskOnly && supportsMethod(p, method));
    if (specialist) return { provider: specialist, reason: 'High-risk destination — routed to the specialist desk' };
  }
  const regional = providers.find((p) => !p.isDefault && !p.highRiskOnly && p.scope !== 'ALL' && covers(p, country) && supportsMethod(p, method));
  if (regional) return { provider: regional, reason: `Regional provider for ${country}` };
  return { provider: defaultProvider(providers), reason: 'Default provider' };
}

/** Live resolution against the DB-effective registry. Use this in server components / actions. */
export async function resolveTmcProvider(req: FullRequest): Promise<TmcResolution> {
  return resolveTmcProviderFrom(req, await listTmcProviders());
}

/** Synchronous fallback over the seed list — only for a context that cannot await. */
export function resolveTmcProviderSeed(req: FullRequest): TmcResolution {
  return resolveTmcProviderFrom(req, seedProviders);
}
