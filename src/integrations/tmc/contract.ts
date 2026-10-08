// §7.3 / §7.4 / §13.9 Provider-neutral canonical TMC contract. ECS publishes ONE
// standard outbound and inbound contract; provider-specific mappings live in the
// adapter layer (§7.5) so a future TMC change is contained. The prototype uses static
// mock payloads only — no live connectivity.

/** Provenance header carried alongside the payload body for correlation & audit. It is
 * NOT the parameter-filter rules (those are sender-side gates) — just a factual snapshot
 * of who/when/what-config emitted the message. */
export interface OutboundMeta {
  messageId: string;        // idempotency key — a re-send of the same message is ignored
  sentAt: string;           // ISO timestamp of emission
  sourceStatus: string;     // request status at time of send (snapshot)
  contractVersion: string;  // integration-contract version in effect
  tmc?: string;             // multi-TMC: the provider this message is routed to
}
export interface InboundMeta {
  messageId: string;
  receivedAt: string;
  correlationId: string | null; // the outbound messageId this responds to
  sourceStatus: string;
  contractVersion: string;
  tmc?: string;             // multi-TMC: the provider this response came from
}

export interface CanonicalOutbound {
  meta?: OutboundMeta;                 // provenance header (§13.9)
  authorisationNumber: string;
  travellerRef: string;
  travellerName?: string;             // §8 resolved name (guest or employee)
  bookingFor?: 'EMPLOYEE' | 'GUEST';  // §8 guest / non-employee indicator (AC7)
  guest?: { name: string; email?: string | null; organisation?: string | null }; // §8 guest identity (no ECS profile)
  settlement?: { mode: 'HOST_DIRECT_BILL'; costObject: string }; // §8 guest: TMC direct-bills the host cost object (no traveller reimbursement / claim)
  travellers?: string[];              // §13.14 group hand-off carries all travellers
  // §9.3 group fan-out (AC15): one approval emits one instruction PER traveller.
  instructionSeq?: number;
  instructionCount?: number;
  costShareSgd?: number;              // this traveller's share of the approved cost
  bookingMethod: string;
  bookingDeadline?: string | null;    // omitted when excluded from the contract
  approvedCostCeilingSgd?: number;    // omitted when excluded from the contract
  approvedExceptions?: string[];      // omitted when excluded from the contract
  // §4.6 approved-request context required in the ECS-led hand-off
  travelPurpose?: string;             // purpose name
  eventStartDate?: string | null;     // event / conference dates (may differ from travel dates)
  eventEndDate?: string | null;
  approvalValidUntil?: string | null; // approval validity period (authorisation expiry)
  // §29 payload enrichment (each gated by its contract toggle)
  charging?: { code: string; type: string; businessArea?: string | null; companyCode?: string | null; percent: number; isResearch: boolean; primary: boolean }[];
  approvals?: { role: string; approver: string; decidedAt: string | null }[];
  traveller?: { category: string; email?: string | null };
  personalTravel?: boolean;
  segments: {
    type: 'AIR' | 'HOTEL';
    origin?: string;
    destination?: string;
    departDate?: string | null;
    returnDate?: string | null;
    approvedClass?: string;
    city?: string;
    nights?: number;
    cappedNightlySgd?: number;
  }[];
}

/** §9.3 group fan-out envelope (AC15): a single approval produces N traveller-level
 *  booking instructions sent to the TMC under one correlation header. */
export interface GroupFanoutOutbound {
  meta?: OutboundMeta;
  mode: 'GROUP_FANOUT';
  authorisationNumber: string;
  instructionCount: number;
  instructions: CanonicalOutbound[];
}

/** The inbound counterpart — one booking confirmation per traveller instruction. */
export interface GroupFanoutInbound {
  meta?: InboundMeta;
  mode: 'GROUP_FANOUT';
  authorisationNumber: string;
  bookings: CanonicalInbound[];
}

export interface CanonicalInbound {
  meta?: InboundMeta;                  // provenance header (§13.9)
  authorisationNumber: string;
  pnr: string;
  ticketNumbers: string[];
  bookingStatus: string;
  channel: string;
  fareSgd: number;
  taxesSgd: number;
  feesSgd: number;
  segments: {
    type: 'AIR' | 'HOTEL';
    origin?: string;
    destination?: string;
    bookedClass?: string;
    departDate?: string | null;
    city?: string;
    roomRateSgd?: number;
    amountSgd?: number;
  }[];
}
