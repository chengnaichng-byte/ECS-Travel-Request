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
