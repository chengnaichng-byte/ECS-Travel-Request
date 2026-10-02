// §26 Rejection Reasons master — reused from the ECS maintenance list rather than free
// text, so rejections are categorised consistently (and reportable). Consumed read-only.
export interface RejectionReason { code: string; label: string; }

export const rejectionReasons: RejectionReason[] = [
  { code: 'RR-BUDGET', label: 'Insufficient budget / funding not available' },
  { code: 'RR-POLICY', label: 'Not in line with travel policy' },
  { code: 'RR-JUSTIFY', label: 'Business justification inadequate' },
  { code: 'RR-COST', label: 'Estimated cost too high' },
  { code: 'RR-CLASS', label: 'Travel class not justified' },
  { code: 'RR-DATES', label: 'Dates / duration not supported' },
  { code: 'RR-DUPLICATE', label: 'Duplicate / overlapping trip' },
  { code: 'RR-INCOMPLETE', label: 'Incomplete or incorrect information' },
  { code: 'RR-OTHER', label: 'Other (see comment)' },
];
