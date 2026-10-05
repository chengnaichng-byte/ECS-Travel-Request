// Allowed values for String-typed status/enum fields (SQLite has no Prisma enums).
// Central reference for the state machines in Build Pack §13.1, §6.2, §6.3, §6.4.

/** §13.1 Travel Request approval status state machine. */
export const REQUEST_STATUS = {
  Draft: 'Draft',
  Submitted: 'Submitted',
  PendingRO: 'Pending RO Approval',
  PendingAdditional: 'Pending Additional Approval',  // §23 traveller-added Additional Approver
  PendingException: 'Pending Exception Approval',
  PendingDOA: 'Pending DOA Approval',
  Approved: 'Approved',
  AmendmentInProgress: 'Amendment In Progress',
  SentBack: 'Sent Back',
  Rejected: 'Rejected',
  Withdrawn: 'Withdrawn',
  Cancelled: 'Cancelled',
  Expired: 'Expired',
  Closed: 'Closed',
} as const;
export type RequestStatus = (typeof REQUEST_STATUS)[keyof typeof REQUEST_STATUS];

/** §13.1 allowed transitions — invalid transitions must not be offered (AC24). A Travel
 *  Request has NO Reject: an approver who disagrees sends it back (→ Sent Back → Draft) to
 *  be revised and resubmitted. "Rejected" is retained as a value for legacy/compat only and
 *  is no longer a transition target. */
export const STATUS_TRANSITIONS: Record<string, string[]> = {
  [REQUEST_STATUS.Draft]: [REQUEST_STATUS.Submitted, REQUEST_STATUS.Withdrawn],
  [REQUEST_STATUS.Submitted]: [REQUEST_STATUS.PendingAdditional, REQUEST_STATUS.PendingDOA, REQUEST_STATUS.PendingException],
  [REQUEST_STATUS.PendingRO]: [REQUEST_STATUS.PendingDOA, REQUEST_STATUS.PendingException, REQUEST_STATUS.SentBack],
  [REQUEST_STATUS.PendingAdditional]: [REQUEST_STATUS.PendingException, REQUEST_STATUS.PendingDOA, REQUEST_STATUS.SentBack],
  [REQUEST_STATUS.PendingException]: [REQUEST_STATUS.PendingDOA, REQUEST_STATUS.SentBack],
  [REQUEST_STATUS.PendingDOA]: [REQUEST_STATUS.Approved, REQUEST_STATUS.SentBack],
  [REQUEST_STATUS.Approved]: [REQUEST_STATUS.AmendmentInProgress, REQUEST_STATUS.Cancelled, REQUEST_STATUS.Expired, REQUEST_STATUS.Closed],
  [REQUEST_STATUS.AmendmentInProgress]: [REQUEST_STATUS.Approved, REQUEST_STATUS.SentBack, REQUEST_STATUS.Cancelled],
  [REQUEST_STATUS.SentBack]: [REQUEST_STATUS.Draft, REQUEST_STATUS.Withdrawn],
  [REQUEST_STATUS.Expired]: [REQUEST_STATUS.PendingRO, REQUEST_STATUS.PendingDOA, REQUEST_STATUS.Cancelled],
  [REQUEST_STATUS.Rejected]: [],
  [REQUEST_STATUS.Withdrawn]: [],
  [REQUEST_STATUS.Cancelled]: [],
  [REQUEST_STATUS.Closed]: [],
};

/** §13.1 booking status (maintained separately on the approved request). */
export const BOOKING_STATUS = {
  NotSent: 'Not Sent',
  SentToTMC: 'Sent to TMC',
  ReceivedByTMC: 'Received by TMC',          // §30/§39 TMC acknowledged the instruction
  InProgress: 'Booking In Progress',
  TravellerActionRequired: 'Traveller Action Required', // §39 TMC needs traveller input
  PartiallyBooked: 'Partially Booked',
  Booked: 'Booked',
  TravelCompleted: 'Travel Completed',        // §30 trip taken; ready to close/claim
  Failed: 'Booking Failed',
  SelfBooked: 'Self-Booked',
  Cancelled: 'Cancelled',
} as const;

/** §30/§39 TMC booking lifecycle — valid intermediate statuses while a request is in
 *  flight with the TMC (between hand-off and a final Booked/Failed outcome), plus the
 *  post-booking "Travel Completed" close-out. */
export const TMC_INFLIGHT_STATUSES: string[] = [
  BOOKING_STATUS.ReceivedByTMC,
  BOOKING_STATUS.InProgress,
  BOOKING_STATUS.TravellerActionRequired,
  BOOKING_STATUS.PartiallyBooked,
];

/** §6.3 policy outcome. */
export const POLICY_OUTCOME = {
  Pass: 'PASS',
  Warning: 'WARNING',
  Exception: 'EXCEPTION',
  HardStop: 'HARD_STOP',
} as const;
export type PolicyOutcome = (typeof POLICY_OUTCOME)[keyof typeof POLICY_OUTCOME];

/** Approval step role types (§6.2, §2.3). */
export const APPROVER_ROLE = {
  RO: 'RO',
  AdditionalApprover: 'ADDITIONAL_APPROVER',
  DOA: 'DOA',
  ResearchDOA: 'RESEARCH_DOA',
  Exception: 'EXCEPTION',
  FundingOwner: 'FUNDING_OWNER',
  Verifier: 'VERIFIER',            // §51 TE claim verifier (claim-stage only)
} as const;

/** §51 TE claim approval status (configurable claim workflow). */
export const CLAIM_STATUS = {
  Draft: 'Draft',
  PendingVerification: 'Pending Verification',
  PendingException: 'Pending Exception Approval',
  PendingRO: 'Pending RO Approval',
  PendingDOA: 'Pending DOA Approval',
  Approved: 'Approved',
  SentBack: 'Sent Back',
} as const;

/** First pending claim step → claim status. */
export function claimStatusForRole(roleType: string): string {
  if (roleType === APPROVER_ROLE.Verifier) return CLAIM_STATUS.PendingVerification;
  if (roleType === APPROVER_ROLE.Exception) return CLAIM_STATUS.PendingException;
  if (roleType === APPROVER_ROLE.RO) return CLAIM_STATUS.PendingRO;
  return CLAIM_STATUS.PendingDOA;
}

/** §13.8 TE pre-population treatment. */
export const TE_TREATMENT = {
  Locked: 'LOCKED',
  Editable: 'EDITABLE',
  Reference: 'REFERENCE',
  Excluded: 'EXCLUDED',
} as const;

/** §2.2 booking methods (incl. Self-Booked §13.17). */
export const BOOKING_METHOD = {
  TMCOnline: 'TMC_ONLINE',
  AgentAssisted: 'AGENT_ASSISTED',
  Offline: 'OFFLINE',
  HostArranged: 'HOST_ARRANGED',
  SelfBooked: 'SELF_BOOKED',
  NoBooking: 'NO_BOOKING',
} as const;

export const BOOKING_METHOD_LABEL: Record<string, string> = {
  TMC_ONLINE: 'TMC online',
  AGENT_ASSISTED: 'TMC agent-assisted',
  OFFLINE: 'Offline (TMC)',
  HOST_ARRANGED: 'Host-arranged',
  SELF_BOOKED: 'Self-booked',
  NO_BOOKING: 'No booking required',
};

/** §2.2 the TMC channel sub-methods offered when the booking is arranged via a TMC. */
export const TMC_BOOKING_METHODS: { value: string; label: string }[] = [
  { value: BOOKING_METHOD.TMCOnline, label: 'TMC online' },
  { value: BOOKING_METHOD.AgentAssisted, label: 'TMC agent-assisted' },
  { value: BOOKING_METHOD.Offline, label: 'Offline (TMC)' },
];

/** §2.2 Booking arrangement — how the trip is fulfilled. A TMC (Auto = provider chosen
 *  by policy, or a specific provider) OR a non-TMC arrangement. The non-TMC values replace
 *  the old booking-method values Self-booked / Host-arranged / No booking required. */
export const BOOKING_ARRANGEMENT = {
  Auto: 'AUTO',
  SelfBooked: 'SELF_BOOKED',
  HostArranged: 'HOST_ARRANGED',
  NoBooking: 'NO_BOOKING',
} as const;
export const NON_TMC_ARRANGEMENTS: { value: string; label: string }[] = [
  { value: BOOKING_ARRANGEMENT.SelfBooked, label: 'Self-booked (§13.17)' },
  { value: BOOKING_ARRANGEMENT.HostArranged, label: 'Host-arranged' },
  { value: BOOKING_ARRANGEMENT.NoBooking, label: 'No booking required' },
];

export const EXPENSE_CATEGORY = {
  Airfare: 'AIRFARE',
  Accommodation: 'ACCOMMODATION',
  ODA: 'ODA',
  Conference: 'CONFERENCE',
  Other: 'OTHER',
} as const;

/** ECS roles (§13.7 personas). */
export const ROLE = {
  Traveller: 'TRAVELLER',
  TravelRequestor: 'TRAVEL_REQUESTOR',
  RO: 'RO',
  DOA: 'DOA',
  ResearchDOA: 'RESEARCH_DOA',
  ExceptionApprover: 'EXCEPTION_APPROVER',
  TravelAdmin: 'TRAVEL_ADMIN',
  SystemAdmin: 'SYSTEM_ADMIN',
  FinanceViewer: 'FINANCE_VIEWER',   // §41/§4 read-only finance oversight
} as const;
export type Role = (typeof ROLE)[keyof typeof ROLE];
