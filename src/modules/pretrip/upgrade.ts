// #7 / #14 Travel-class upgrade split. When an airfare line is booked above the traveller's
// entitlement, the differential is derived (Model B) from a configured uplift % for the class step:
// entitlement = chosenFare / (1 + pct) is stored on the line (entitlementFareSgd), so the delta is
// chosenFare − entitlement. The delta is then funded one of two ways:
//   • NTU-funded  → NTU pays the full fare; the delta is charged to the traveller-selected M6 account
//                   (upgradeDeltaCode) while the entitlement stays on the original WBS / cost centre (#14).
//   • Self-funded → NTU pays only the entitlement (to the original WBS); the traveller pays the
//                   delta to the TMC directly, so the delta is never an NTU charge or reimbursement (#7).
// This helper reads the stored derived entitlement; capture (addAirfare / demo) does the derivation.
import { EXPENSE_CATEGORY } from '@/shared/enums';

export type UpgradeFunding = 'NTU' | 'SELF';

export interface AirfareUpgrade {
  isUpgrade: boolean;
  fareSgd: number;          // the chosen (upgraded) fare — the amount paid to the TMC
  entitlementSgd: number;   // the derived entitlement-class fare (chosenFare / (1 + upliftPct))
  deltaSgd: number;         // fareSgd - entitlementSgd (the upgrade differential)
  upliftPct: number | null; // the applied uplift fraction over the entitlement (for display)
  funding: UpgradeFunding | null;
  ntuAirfareSgd: number;    // airfare charged to NTU: full fare (NTU-funded) or entitlement only (self-funded)
  travellerPaysSgd: number; // delta the traveller settles with the TMC directly (self-funded only)
  deltaCostCentre: string | null; // the selected M6 account an NTU-funded delta charges (null until chosen)
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
