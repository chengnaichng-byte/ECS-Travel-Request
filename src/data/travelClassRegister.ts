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
  // Only Dr Alice Tan is in the register — C20 (Appointment Holders), Premium Economy ≥ 6h, and the
  // only group flagged for M6. Every other employee is ABSENT → defaults to Economy (AC38, S15); a
  // higher class for anyone else is therefore a policy exception.
  { employeeId: 'E-TRAV',  displayName: 'Dr Alice Tan',  entitledClassId: 'TC-PEY', policyGroup: 'C20', minHours: 6, effectiveFrom: '2025-07-01', effectiveTo: '2027-03-31' },
];
