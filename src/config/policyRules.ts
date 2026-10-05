// §25/§43 Policy rule catalogue. The pre-trip policy checks are DATA-DRIVEN: each rule
// has a name, category, default outcome, an effective-from date and an active flag, so
// rules can be turned on/off or dated without code changes (the OutSystems equivalent is
// a Policy Rules maintenance entity). `policy.ts` and the duplicate-trip check gate each
// check on `ruleActive(code, onDate)`. Structural-integrity rules are marked `mandatory`
// (always enforced, shown here for completeness); discretionary rules honour `active`.
import { POLICY_OUTCOME } from '@/shared/enums';

export interface PolicyRule {
  code: string;            // matches PolicyCheck.code
  name: string;
  category: string;        // Dates | Funding | Accommodation | Travel class | Booking | Lead time | Duration | Estimate | Duplicate
  defaultOutcome: string;  // POLICY_OUTCOME — the worst outcome this rule can raise
  effectiveFrom: string;   // ISO date the rule takes effect
  active: boolean;
  mandatory?: boolean;     // structural integrity rule — always enforced regardless of `active`
  description: string;
}

export const policyRules: PolicyRule[] = [
  { code: 'DATES', name: 'Official travel dates present & ordered', category: 'Dates', defaultOutcome: POLICY_OUTCOME.HardStop, effectiveFrom: '2025-01-01', active: true, mandatory: true, description: 'Start and end dates are required and the return must be on/after departure.' },
  { code: 'ALLOC', name: 'Charging allocation totals 100%', category: 'Funding', defaultOutcome: POLICY_OUTCOME.HardStop, effectiveFrom: '2025-01-01', active: true, mandatory: true, description: 'A funding split must be present and total exactly 100%.' },
  { code: 'FUNDING', name: 'Valid charging codes', category: 'Funding', defaultOutcome: POLICY_OUTCOME.HardStop, effectiveFrom: '2025-01-01', active: true, mandatory: true, description: 'Every charging code must resolve to a known CC/WBS master.' },
  { code: 'FUNDING_INACTIVE', name: 'Inactive / closed charging code', category: 'Funding', defaultOutcome: POLICY_OUTCOME.HardStop, effectiveFrom: '2025-01-01', active: true, description: 'A closed or inactive CC/WBS cannot be charged (§25).' },
  { code: 'ESTIMATE', name: 'At least one estimated cost', category: 'Estimate', defaultOutcome: POLICY_OUTCOME.HardStop, effectiveFrom: '2025-01-01', active: true, mandatory: true, description: 'At least one estimated cost line is required.' },
  { code: 'CLASS_JUSTIFY', name: 'Class-upgrade justification required', category: 'Travel class', defaultOutcome: POLICY_OUTCOME.HardStop, effectiveFrom: '2025-01-01', active: true, mandatory: true, description: 'Selecting a class above entitlement requires a justification comment (AC39).' },
  { code: 'HOTEL_CAP', name: 'Accommodation above cap', category: 'Accommodation', defaultOutcome: POLICY_OUTCOME.Exception, effectiveFrom: '2025-01-01', active: true, description: 'Nightly rate above the country/city cap raises a policy exception.' },
  { code: 'CLASS', name: 'Travel class above entitlement', category: 'Travel class', defaultOutcome: POLICY_OUTCOME.Exception, effectiveFrom: '2025-01-01', active: true, description: 'A cabin above the derived entitlement raises an exception (§13.19).' },
  { code: 'OFFLINE', name: 'Offline booking', category: 'Booking', defaultOutcome: POLICY_OUTCOME.Exception, effectiveFrom: '2025-01-01', active: true, description: 'Offline booking requires a supporting quotation and approval.' },
  { code: 'LEAD', name: 'Short lead time', category: 'Lead time', defaultOutcome: POLICY_OUTCOME.Warning, effectiveFrom: '2025-01-01', active: true, description: 'Departure within the recommended advance-booking window.' },
  { code: 'LONG', name: 'Long trip', category: 'Duration', defaultOutcome: POLICY_OUTCOME.Warning, effectiveFrom: '2025-01-01', active: true, description: 'Trip duration beyond the long-trip threshold.' },
  { code: 'HIGH', name: 'High estimate', category: 'Estimate', defaultOutcome: POLICY_OUTCOME.Warning, effectiveFrom: '2025-01-01', active: true, description: 'Approval amount above the high-estimate threshold.' },
  { code: 'DUPLICATE', name: 'Overlapping / duplicate trip', category: 'Duplicate', defaultOutcome: POLICY_OUTCOME.Warning, effectiveFrom: '2025-01-01', active: true, description: 'Another live trip for the same traveller overlaps these dates (§25/§40).' },
  { code: 'HIGH_RISK', name: 'High-risk travel destination', category: 'High-risk', defaultOutcome: POLICY_OUTCOME.Warning, effectiveFrom: '2025-01-01', active: true, description: 'Destination is designated high-risk; advisory shown and traveller + approver acknowledgements are mandatory (§4.8).' },
];

const byCode = new Map(policyRules.map((r) => [r.code, r]));

export function policyRule(code: string): PolicyRule | undefined {
  return byCode.get(code);
}

/** A rule runs when it is mandatory, or it is active and its effective date has arrived. */
export function ruleActive(code: string, onDate: Date = new Date()): boolean {
  const r = byCode.get(code);
  if (!r) return true; // unknown codes default to enabled (fail-open for structural checks)
  if (r.mandatory) return true;
  return r.active && r.effectiveFrom <= onDate.toISOString().slice(0, 10);
}
