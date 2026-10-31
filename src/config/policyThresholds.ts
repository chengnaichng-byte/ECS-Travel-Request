// §6.3 Policy / review tuning thresholds — kept in config (mapping to OutSystems site
// properties) instead of hard-coded in the policy evaluator and the approver-review
// severity logic, so they can be tuned without a code change.
export const policyThresholds = {
  shortLeadDays: 14,        // departure within this many days → short-lead-time advisory
  longTripDays: 14,         // trip longer than this many days → long-trip advisory
  highEstimateSgd: 20000,   // approval amount above this → high-estimate advisory (aligns with the top workflow band)
  severityHighSgd: 2500,    // exception $ impact ≥ this → High severity on the review page
  severityMediumSgd: 500,   // exception $ impact ≥ this → Medium severity
};

// §6.2 Per-policy exception handling — pulled from the Policy Configuration (here) rather than a blanket
// rule: does a given exception need ONLY a justification, or a justification AND an exception-approver
// step before the DOA? Keyed by the policy-check code; an unlisted code defaults to needing approval.
export const exceptionApprovalRequired: Record<string, boolean> = {
  CLASS: true,      // travel class above entitlement → justification + exception approval
  HOTEL_CAP: true,  // accommodation above the cap → justification + exception approval
};
/** Whether this exception requires an exception-approver step (true) or just a justification (false). */
export function exceptionNeedsApproval(code: string): boolean {
  return exceptionApprovalRequired[code] ?? true;
}
