// §7.3 / §7.4 / §13.9 Provider-neutral canonical TMC contract. ECS publishes ONE
// standard outbound and inbound contract; provider-specific mappings live in the
// adapter layer (§7.5) so a future TMC change is contained. The prototype uses static
// mock payloads only — no live connectivity.
import type { ObtBookingStatus } from './vocab';

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
  type: 'AIRFARE' | 'ACCOMMODATION' | 'FEE' | 'CAR' | 'VISA' | 'ANCILLARY';   // ANCILLARY = seat / baggage / etc.
  expenseTypeId: string;               // ECS expense-type master id → debit GL + default SAP tax code
  amountSgd: number;                   // gross, GST-inclusive (SGD — the posting basis)
  gstCode: string;                     // SAP tax code (IZ zero-rated / IO out-of-scope / I9 / P9)
  gstAmountSgd: number;                // external tax amount (0 for IZ / IO)
  gstClaimable?: boolean;              // fee lines only: drives I9 (true) vs P9 (false)
  // Original booking currency (audit only — ECS posts the SGD amount above). The TMC often books in
  // a foreign currency and converts; carrying the source figures lets finance reconcile the statement.
  currency?: string;                   // ISO currency the supplier billed in
  foreignAmount?: number;              // gross in the original currency
  fxRate?: number;                     // SGD per unit applied by the TMC / card feed
  // Charge → fulfilment trace (§7.3 association). A charge is tied to WHAT it paid for so finance can
  // walk charge → ticket/coupon (air) or PNR/confirmation (hotel) → segment → PNR → TA. Air charges
  // carry the e-ticket + coupon; all charges carry the owning PNR and (where applicable) the segment ref.
  pnr?: string;                        // the PNR this charge settled under
  ticketNumber?: string;               // air: the e-ticket this fare/ancillary was issued against
  couponNumber?: number;               // air: the ticket coupon (flight sequence) the charge covers
  segmentRef?: string;                 // the booked segment this charge maps to (segments[].segmentRef)
}

export interface CanonicalInbound {
  meta?: InboundMeta;                  // provenance header (§13.9)
  authorisationNumber: string;        // §7.3 the TA — the anchor the whole feed is keyed by (one TA → N PNRs)
  pnr: string;                        // the booking record locator; the PNR KEY is (supplierCode, pnr) — a locator is only unique within its owning GDS/supplier
  supplierCode?: string;              // GDS / plating-carrier code that OWNS this PNR — the other half of the PNR key
  invoiceNumber?: string | null;       // DD-31 provider invoice number — SAP posting Reference (PNR used when absent)
  ticketNumbers: string[];
  bookingStatus: ObtBookingStatus;    // §7.3 OBT/TMC booking-record status (industry vocabulary) — ECS maps it to its own lifecycle via obtToEcsBookingStatus()
  channel: string;
  fareSgd: number;
  taxesSgd: number;
  feesSgd: number;
  bookedAt?: string | null;            // ISO — when the booking was confirmed / space held
  ticketedAt?: string | null;          // ISO — when the ticket was issued (drives when a charge may post)
  ctaAccountId?: string | null;        // DD-30 the CTA account the central charges were lodged to (feed-reported)
  ctaCardRef?: string | null;          // DD-30 masked CTA card reference (e.g. last-4) for statement reconciliation
  statementPeriod?: string | null;     // DD-30 the card billing / statement period the charge falls in (e.g. 2026-11)
  ctaCharged?: boolean;                 // DD-30 the central charges have settled on the CTA (ticketed/charged), not just confirmed
  ctaChargeDate?: string | null;        // DD-30 date the charge posted to the CTA (ISO)
  charges?: InboundCharge[];            // DD-31 per-charge CTA breakdown with GST — the SAP posting datapoints
  // Lifecycle events the feed reports AFTER the initial confirmation. A cancellation drives the CTA
  // reversal (the refund credits, the penalty stays a charge); a reissue carries the change fee and
  // the new booking reference so ECS can reconcile the amendment against the approved request.
  cancellation?: {
    cancelledAt: string;
    reason?: string | null;
    cancellationFeeSgd?: number;        // non-refundable penalty retained by the supplier / TMC
    refundSgd?: number;                 // amount refunded to the CTA
  };
  reissue?: {
    reissuedAt: string;
    changeFeeSgd?: number;
    newPnr?: string | null;
    newTicketNumbers?: string[];
  };
  segments: {
    type: 'AIR' | 'HOTEL';
    // §7.3 association keys — how a segment is tied back up the hierarchy: segment → PNR → TA.
    segmentRef?: string;            // stable per-segment id within the feed (e.g. SEG-<pnr>-A1); charges reference this
    pnr?: string;                   // the PNR this segment sits under (a TA may span several PNRs)
    origin?: string;
    destination?: string;
    bookedClass?: string;
    segmentStatus?: string;         // air: GDS segment action/advice code (HK confirmed / UN cancelled / TK sched-change …)
    ticketNumber?: string;          // air: the e-ticket covering this segment
    couponNumber?: number;          // air: the coupon (flight sequence) on that ticket
    departDate?: string | null;
    arriveDate?: string | null;     // DD-17 booked arrival date (persisted on BookingSegment)
    city?: string;
    roomRateSgd?: number;
    amountSgd?: number;
    supplierName?: string;          // airline / hotel name (for reconciliation)
    supplierCode?: string;          // IATA airline code / hotel chain code
    confirmationNo?: string;        // hotel confirmation number (distinct from the air PNR)
  }[];
}
