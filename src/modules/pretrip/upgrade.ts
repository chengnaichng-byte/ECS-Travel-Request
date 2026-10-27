// #7 / #14 Travel-class upgrade split. When an airfare line is booked above the traveller's
// entitlement, the fare is captured as two quotes — the entitlement-class fare and the (higher)
// chosen fare — and the delta between them is funded one of two ways:
//   • NTU-funded  → NTU pays the full fare; the delta is charged to the fixed M6 cost centre while
//                   the entitlement stays on the original WBS / cost centre (#14).
//   • Self-funded → NTU pays only the entitlement (to the original WBS); the traveller pays the
//                   delta to the TMC directly, so the delta is never an NTU charge or reimbursement (#7).
// This helper derives the split from the airfare line; charging, posting and the claim all read it.
import { UPGRADE_DELTA_CC } from '@/data/charging';

export type UpgradeFunding = 'NTU' | 'SELF';

export interface AirfareUpgrade {
  isUpgrade: boolean;
  fareSgd: number;          // the chosen (upgraded) fare — the amount paid to the TMC
  entitlementSgd: number;   // the entitlement-class fare (second quote)
  deltaSgd: number;         // fareSgd - entitlementSgd (the upgrade differential)
  funding: UpgradeFunding | null;
  ntuAirfareSgd: number;    // airfare charged to NTU: full fare (NTU-funded) or entitlement only (self-funded)
  travellerPaysSgd: number; // delta the traveller settles with the TMC directly (self-funded only)
  deltaCostCentre: string;  // M6 — where an NTU-funded delta is charged
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export function airfareUpgrade(e: { sgdAmount: number; entitlementFareSgd?: number | null; upgradeFunding?: string | null }): AirfareUpgrade {
  const fare = r2(e.sgdAmount ?? 0);
  const ent = r2(e.entitlementFareSgd ?? 0);
  const isUpgrade = ent > 0 && fare > ent + 0.005;
  const delta = isUpgrade ? r2(fare - ent) : 0;
  const funding: UpgradeFunding | null = isUpgrade ? (e.upgradeFunding === 'SELF' ? 'SELF' : 'NTU') : null;
  const ntuAirfare = !isUpgrade ? fare : funding === 'SELF' ? ent : fare;
  const travellerPays = isUpgrade && funding === 'SELF' ? delta : 0;
  return { isUpgrade, fareSgd: fare, entitlementSgd: ent, deltaSgd: delta, funding, ntuAirfareSgd: ntuAirfare, travellerPaysSgd: travellerPays, deltaCostCentre: UPGRADE_DELTA_CC };
}
