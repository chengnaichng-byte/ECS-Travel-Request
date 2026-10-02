// §13.19 Travel Class register (Figure D5) — effective-dated per-employee travel-class
// entitlements with travel policy group and a duration condition (entitlement applies
// to flights of at least `minHours`; shorter legs fall back to Economy). Employees not
// listed default to Economy. Seeded read-only per §13.18.
export interface TravelClassRegisterEntry {
  employeeId: string;
  displayName: string;
  entitledClassId: string;   // class entitled when the duration condition is met
  policyGroup: string;       // e.g. C20 / B70 (ECS travel policy group)
  minHours: number;          // duration condition: applies to legs >= minHours
  effectiveFrom: string;
  effectiveTo: string;
}

export const travelClassRegister: TravelClassRegisterEntry[] = [
  // Premium Economy, duration-conditioned (>= 6h) — §13.19 required sample
  { employeeId: 'E-TRAV',  displayName: 'Dr Alice Tan',  entitledClassId: 'TC-PEY', policyGroup: 'C20', minHours: 6, effectiveFrom: '2025-07-01', effectiveTo: '2027-03-31' },
  // PremiumEconomy/BusinessClass tier (>= 6h) — §13.19 required sample
  { employeeId: 'E-TRAV3', displayName: 'Dr Henry Ong',  entitledClassId: 'TC-BIZ', policyGroup: 'B70', minHours: 6, effectiveFrom: '2024-01-01', effectiveTo: '2028-12-31' },
  // Senior staff — Business on any flight
  { employeeId: 'E-RO',    displayName: 'Prof Ben Lim',  entitledClassId: 'TC-BIZ', policyGroup: 'A10', minHours: 0, effectiveFrom: '2024-01-01', effectiveTo: '2029-12-31' },
  { employeeId: 'E-RO2',   displayName: 'Prof Ivy Chua', entitledClassId: 'TC-BIZ', policyGroup: 'A10', minHours: 0, effectiveFrom: '2024-01-01', effectiveTo: '2029-12-31' },
  // E-TRAV2 (Dr Grace Ho) is deliberately ABSENT → defaults to Economy (AC38, S15).
];
