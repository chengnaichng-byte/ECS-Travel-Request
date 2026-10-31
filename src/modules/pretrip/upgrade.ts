// §13.19 M6 ENTITLEMENT split (the corrected M6 model). When a traveller flies their entitlement and
// their travel-policy group attracts M6 (and the entitlement is above Economy), the entitled fare
// splits into an Economy base + an M6 differential (Economy→entitled). The base is stored on the line
// (entitlementFareSgd, derived at capture via the uplift % master); the M6 differential = fare − base.
// NTU always funds the full entitled fare; the M6 differential is reallocated to the M6 account
// (upgradeDeltaCode) while the Economy base stays on the original WBS / cost centre. M6 is NOT a
// traveller-requested upgrade — a class ABOVE entitlement is a policy exception, handled separately.
// (Self-funding does not apply to M6; the SELF branch is retained only for backward data safety.)
import { EXPENSE_CATEGORY } from '@/shared/enums';

export type UpgradeFunding = 'NTU' | 'SELF';

export interface AirfareUpgrade {
  isUpgrade: boolean;       // true = line carries an M6 entitlement split
  fareSgd: number;          // the entitled-class fare — the amount paid to the TMC
  entitlementSgd: number;   // the derived Economy base (fare / (1 + upliftPct(ECO→entitled)))
  deltaSgd: number;         // fareSgd - base (the M6 differential, Economy→entitled)
  upliftPct: number | null; // the applied uplift fraction (for display)
  funding: UpgradeFunding | null; // always NTU for M6 (the org funds the entitlement)
  ntuAirfareSgd: number;    // airfare charged to NTU: the full entitled fare
  travellerPaysSgd: number; // 0 for M6 (retained for backward data safety)
  deltaCostCentre: string | null; // the M6 account the differential charges (null until resolved)
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export function airfareUpgrade(e: { sgdAmount: number; entitlementFareSgd?: number | null; upgradeFunding?: string | null; upgradeDeltaCode?: string | null }): AirfareUpgrade {
  const fare = r2(e.sgdAmount ?? 0);
  const ent = r2(e.entitlementFareSgd ?? 0);
  const isUpgrade = ent > 0 && fare > ent + 0.005;
  const delta = isUpgrade ? r2(fare - ent) : 0;
  const upliftPct = isUpgrade && ent > 0 ? r2(fare / ent - 1) : null;
  const funding: UpgradeFunding | null = isUpgrade ? (e.upgradeFunding === 'SELF' ? 'SELF' : 'NTU') : null;
  const ntuAirfare = !isUpgrade ? fare : funding === 'SELF' ? ent : fare;
  const travellerPays = isUpgrade && funding === 'SELF' ? delta : 0;
  return { isUpgrade, fareSgd: fare, entitlementSgd: ent, deltaSgd: delta, upliftPct, funding, ntuAirfareSgd: ntuAirfare, travellerPaysSgd: travellerPays, deltaCostCentre: e.upgradeDeltaCode ?? null };
}

/** Total NTU-funded upgrade differential across a request's airfare lines — the amount that charges
 *  the M6 account (the entitlement stays on the chosen allocation). Self-funded deltas are the
 *  traveller's, so they are excluded. */
export function ntuUpgradeDeltaTotal(expenses: { category: string; sgdAmount: number; entitlementFareSgd?: number | null; upgradeFunding?: string | null }[]): number {
  return r2(expenses.reduce((s, e) => {
    if (e.category !== EXPENSE_CATEGORY.Airfare) return s;
    const u = airfareUpgrade(e);
    return s + (u.isUpgrade && u.funding === 'NTU' ? u.deltaSgd : 0);
  }, 0));
}

/** The NTU-funded upgrade differential grouped by the selected M6 account — one entry per account
 *  (usually one). `code` is null only when the line's account has not yet been selected. */
export function ntuUpgradeDeltaByAccount(expenses: { category: string; sgdAmount: number; entitlementFareSgd?: number | null; upgradeFunding?: string | null; upgradeDeltaCode?: string | null }[]): { code: string | null; amount: number }[] {
  const by = new Map<string | null, number>();
  for (const e of expenses) {
    if (e.category !== EXPENSE_CATEGORY.Airfare) continue;
    const u = airfareUpgrade(e);
    if (u.isUpgrade && u.funding === 'NTU' && u.deltaSgd > 0) {
      const code = e.upgradeDeltaCode ?? null;
      by.set(code, r2((by.get(code) ?? 0) + u.deltaSgd));
    }
  }
  return [...by.entries()].map(([code, amount]) => ({ code, amount }));
}
