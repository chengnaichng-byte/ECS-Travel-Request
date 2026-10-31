// §13.19 Travel Policy Group master (travel eligibility master) — the reusable ECS master that
// defines, per policy group, the entitled travel class by flight-duration band, and whether the
// group ATTRACTS M6. Employees are mapped to a group in the Travel Class register
// (src/data/travelClassRegister.ts); their entitled class derives from the group's tiers here — the
// group is the single source of entitlement (not a per-employee class).
//
// M6 (§ funding): a group flagged `m6` has the Economy→entitled-class differential funded from an M6
// account — an ENTITLEMENT split, applied automatically when the entitled class is above Economy. It
// is NOT a traveller-requested upgrade (that is a policy exception, handled separately). Only certain
// groups attract M6; the flag is on the group, here in the master.
export interface TravelPolicyGroupTier {
  minHours: number; // this class applies to a leg of at least this many hours
  classId: string;  // entitled class when the band is met (highest met band wins; else Economy)
}

export interface TravelPolicyGroup {
  code: string;            // E10 / C20 / B70 … (ECS travel policy group)
  description: string;
  eligibilityClass: string; // display label of the top eligibility as per the ECS master
  tiers: TravelPolicyGroupTier[]; // entitled class = highest tier with minHours ≤ leg hours, else Economy
  m6: boolean;             // attracts M6 (Economy→entitled differential funded from an M6 account)
}

const ECO = 'TC-ECO';
const PEY = 'TC-PEY';
const BIZ = 'TC-BIZ';

// Seeded from the ECS Travel Policy Group master. C20 (Appointment Holders) attracts M6.
export const travelPolicyGroups: TravelPolicyGroup[] = [
  { code: 'E10', description: 'Economy', eligibilityClass: 'Economy Class', tiers: [], m6: false },

  { code: 'C40', description: 'Premium Economy Class upgrade for flights >= 6h (NAP)', eligibilityClass: 'Premium Economy', tiers: [{ minHours: 6, classId: PEY }], m6: false },
  { code: 'C30', description: 'Premium Economy Class upgrade for flights >= 6h (RSR)', eligibilityClass: 'Premium Economy', tiers: [{ minHours: 6, classId: PEY }], m6: false },
  { code: 'C20', description: 'Premium Economy Class upgrade for flights >= 6h (Appointment Holders)', eligibilityClass: 'Premium Economy', tiers: [{ minHours: 6, classId: PEY }], m6: true },
  { code: 'C10', description: 'Premium Economy Class upgrade for flights >= 6h (Medical)', eligibilityClass: 'Premium Economy', tiers: [{ minHours: 6, classId: PEY }], m6: false },

  { code: 'B80', description: 'Business Class upgrade for flights >= 6h (MAR - Conference only)', eligibilityClass: 'Premium Economy / Business Class', tiers: [{ minHours: 6, classId: BIZ }], m6: false },
  { code: 'B70', description: 'Business Class upgrade for flights >= 6h (RSR)', eligibilityClass: 'Premium Economy / Business Class', tiers: [{ minHours: 6, classId: BIZ }], m6: false },
  { code: 'B60', description: 'Business Class upgrade for flights >= 6h (Medical)', eligibilityClass: 'Premium Economy / Business Class', tiers: [{ minHours: 6, classId: BIZ }], m6: false },
  { code: 'B50', description: 'Business Class for flights >= 6h', eligibilityClass: 'Premium Economy / Business Class', tiers: [{ minHours: 6, classId: BIZ }], m6: false },
  // B40 is two-tier: Business ≥ 6h, Premium Economy 4h–<6h, else Economy.
  { code: 'B40', description: 'Business Class for flights >= 6h and Premium Economy for flights >= 4h and < 6h', eligibilityClass: 'Premium Economy / Business Class', tiers: [{ minHours: 4, classId: PEY }, { minHours: 6, classId: BIZ }], m6: false },
  { code: 'B30', description: "Business Class for flights >= 4h (President's Council)", eligibilityClass: 'Premium Economy / Business Class', tiers: [{ minHours: 4, classId: BIZ }], m6: false },
  { code: 'B20', description: 'Business Class upgrade for flights >= 2h (Medical)', eligibilityClass: 'Premium Economy / Business Class', tiers: [{ minHours: 2, classId: BIZ }], m6: false },
  { code: 'B10', description: 'Business Class for all flights', eligibilityClass: 'Premium Economy / Business Class', tiers: [{ minHours: 0, classId: BIZ }], m6: false },
  { code: 'A10', description: 'Other: Management override for all travel classes - No limit to flight hour', eligibilityClass: 'Premium Economy / Business Class', tiers: [{ minHours: 0, classId: BIZ }], m6: false },
];
