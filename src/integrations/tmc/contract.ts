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
  // §8 / DD-21 PDPA: ECS holds only the guest's name/email/org. The TMC is instructed to
  // collect the guest's own travel profile (passport/DOB/contact) via a secure link — ECS
  // never stores it. Present only for a GUEST booking, and only when the contract toggle is on.
  guestProfile?: { collectVia: 'TMC_SECURE_LINK'; deliverTo: string | null; tmcCollectedFields: string[]; ecsRetains: string };
  settlement?: { mode: 'HOST_DIRECT_BILL'; costObject: string }; // §8 guest: TMC direct-bills the host cost object (no traveller reimbursement / claim)
  // §13.x / DD-23 emergency lane (book first, raise later): the instruction is authorised ahead of
  // the full approval cycle. The indicator tells the TMC to reconcile against any space already
  // held during the emergency and NOT create a duplicate booking.
  emergency?: { lane: 'EMERGENCY_BOOK_FIRST'; authorisedBy: string | null; authorisationNumber: string; reconcile: string };
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
    arriveDate?: string | null;     // DD-17 booked arrival date — carried so the inbound can persist it
    returnDate?: string | null;
    approvedClass?: string;
    city?: string;
    nights?: number;
    cappedNightlySgd?: number;
    billTo?: 'CTA' | 'TRAVELLER';   // DD-19 hotel payment channel (HOTEL segments): central CTA vs employee-paid
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

/** DD-31 per-charge breakdown of the CTA-settled charges on this booking — the datapoints ECS posts
 *  to SAP (one Dr expense line per charge ⇄ Cr CTA clearing). Each charge maps to the ECS expense-type
 *  master for its GL and default tax code; the feed also asserts the SAP tax code and GST amount
 *  (SAP's "external tax amount"), which ECS validates against its own GST logic (src/data/gstCodes.ts).
 *  This replaces the single fare/taxes/fees aggregate as the authoritative posting basis: the agency
 *  fee is its OWN line (I9 9% claimable), never rolled into the zero-rated (IZ) airfare. */
export interface InboundCharge {
  type: 'AIRFARE' | 'ACCOMMODATION' | 'FEE' | 'CAR' | 'VISA';
  expenseTypeId: string;               // ECS expense-type master id → debit GL + default SAP tax code
  amountSgd: number;                   // gross, GST-inclusive
  gstCode: string;                     // SAP tax code (IZ zero-rated / IO out-of-scope / I9 / P9)
  gstAmountSgd: number;                // external tax amount (0 for IZ / IO)
  gstClaimable?: boolean;              // fee lines only: drives I9 (true) vs P9 (false)
}

export interface CanonicalInbound {
  meta?: InboundMeta;                  // provenance header (§13.9)
  authorisationNumber: string;
  pnr: string;
  invoiceNumber?: string | null;       // DD-31 provider invoice number — SAP posting Reference (PNR used when absent)
  ticketNumbers: string[];
  bookingStatus: string;
  channel: string;
  fareSgd: number;
  taxesSgd: number;
  feesSgd: number;
  ctaAccountId?: string | null;        // DD-30 the CTA account the central charges were lodged to (feed-reported)
  ctaCharged?: boolean;                 // DD-30 the central charges have settled on the CTA (ticketed/charged), not just confirmed
  ctaChargeDate?: string | null;        // DD-30 date the charge posted to the CTA (ISO)
  charges?: InboundCharge[];            // DD-31 per-charge CTA breakdown with GST — the SAP posting datapoints
  segments: {
    type: 'AIR' | 'HOTEL';
    origin?: string;
    destination?: string;
    bookedClass?: string;
    departDate?: string | null;
    arriveDate?: string | null;     // DD-17 booked arrival date (persisted on BookingSegment)
    city?: string;
    roomRateSgd?: number;
    amountSgd?: number;
  }[];
}
