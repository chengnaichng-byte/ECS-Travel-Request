// §13.7 Travel-class entitlement: derived from policy group + structured duration
// bands. Individual records primarily represent exceptions (§2.4).
// `costIndex` is the typical fare of a class relative to Economy (=1.0); used to
// estimate the SGD impact of a class-upgrade exception on the approver review page.
export interface TravelClass { id: string; name: string; rank: number; costIndex: number; }

export const travelClasses: TravelClass[] = [
  { id: 'TC-ECO',  name: 'Economy',          rank: 1, costIndex: 1.0 },
  { id: 'TC-PEY',  name: 'Premium Economy',  rank: 2, costIndex: 1.5 },
  { id: 'TC-BIZ',  name: 'Business',         rank: 3, costIndex: 2.2 },
];

// Entitlement is driven solely by the effective-dated Travel Class Register
// (src/data/travelClassRegister.ts, §13.19) via EcsTravelClassRegister — per employee,
// per policy group, with a duration threshold. The earlier policy-group band table and
// individual-exception list were removed: they duplicated (and contradicted) the
// register and drove no runtime behaviour. The register is the single source of truth.
