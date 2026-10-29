// §7.3–§7.5 / §13.8–§13.9 Integration Contract registry. This is the DECLARATIVE
// source of truth for the two integration boundaries:
//   • "Send to TMC"  — the provider-neutral booking instruction (outbound, §13.9)
//   • "Sync to TE"   — the field-level pre-population of the expense claim (§13.8)
// Each field row says whether it flows to the TMC and how it is treated in the claim.
// The DEFAULTS live here (mapping to OutSystems site properties / exposed REST
// structure); admin overrides are persisted in the IntegrationFieldSetting entity and
// merged at read time by `getContractSettings`. Both `buildOutbound` and
// `prepopulateClaim` READ this contract, so a toggle actually changes the payload
// (a working prototype, not a diagram).

import { REQUEST_STATUS, BOOKING_STATUS, BOOKING_METHOD } from '@/shared/enums';

// Version stamped into each message's provenance header (§13.9). Bump when the
// contract shape changes so downstream logs can correlate payloads to a contract.
export const CONTRACT_VERSION = 'ecs-pretrip-contract/1.2';

export type TeTreatment = 'LOCKED' | 'EDITABLE' | 'REFERENCE' | 'EXCLUDED';

export interface ContractField {
  key: string;
  group: string;
  label: string;
  source: string;                 // where the value comes from (TR entity.field)
  // ---- TMC (outbound booking instruction) ----
  tmc?: 'core' | 'toggle';        // core = always sent (not editable); toggle = admin can include/exclude
  defaultTmc?: boolean;           // default inclusion for a toggle field
  // ---- TE (expense-claim sync) ----
  te?: 'field' | 'line' | 'actual'; // field = header field, line = expense line (by category), actual = TMC feed
  category?: string;              // EXPENSE_CATEGORY governed, for te:'line' rows
  defaultTe?: TeTreatment;
  transform?: string;
  note?: string;
}

export const TE_TREATMENT_OPTIONS: TeTreatment[] = ['LOCKED', 'EDITABLE', 'REFERENCE', 'EXCLUDED'];

export const CONTRACT_FIELDS: ContractField[] = [
  // ============================ SEND TO TMC ============================
  { key: 'authorisationNumber', group: 'Booking header', label: 'Travel Authorisation number', source: 'req.authorisationNo',
    tmc: 'core', note: 'Booking reference — always carried.' },
  { key: 'travellerRef', group: 'Booking header', label: 'Traveller reference', source: 'req.travellerId',
    tmc: 'core', note: 'Lead traveller — always carried.' },
  { key: 'bookingMethod', group: 'Booking header', label: 'Booking method / channel', source: 'req.bookingMethod',
    tmc: 'core', note: 'Routes the instruction to the correct TMC channel.' },
  { key: 'travellers', group: 'Booking header', label: 'All group travellers', source: 'req.travellers[]',
    tmc: 'toggle', defaultTmc: true, note: '§13.14 group hand-off carries every traveller.' },
  { key: 'bookingDeadline', group: 'Booking header', label: 'Booking deadline', source: 'req.bookingDeadline',
    tmc: 'toggle', defaultTmc: true },
  { key: 'costCeiling', group: 'Booking header', label: 'Approved cost ceiling (SGD)', source: 'Σ airfare + accommodation',
    tmc: 'toggle', defaultTmc: true, note: 'Booking must stay within this ceiling.' },
  { key: 'approvedExceptions', group: 'Booking header', label: 'Approved policy exceptions', source: 'policyChecks(Exception)',
    tmc: 'toggle', defaultTmc: true, note: 'Authorises e.g. an approved class upgrade at booking.' },
  { key: 'tripPurpose', group: 'Booking header', label: 'Travel purpose', source: 'req.purposeId',
    tmc: 'toggle', defaultTmc: true, note: '§4.6 required in the approved-request hand-off.' },
  { key: 'eventDates', group: 'Booking header', label: 'Event / conference dates', source: 'req.eventStartDate / eventEndDate',
    tmc: 'toggle', defaultTmc: true, note: '§4.6 event dates (may differ from travel dates).' },
  { key: 'approvalValidity', group: 'Booking header', label: 'Approval validity period', source: 'req.authorisationExpiry',
    tmc: 'toggle', defaultTmc: true, note: '§4.6 approval validity window.' },
  { key: 'airSegments', group: 'Itinerary', label: 'Air segments (origin / dest / date)', source: 'legs[] (shared)',
    tmc: 'toggle', defaultTmc: true },
  { key: 'airApprovedClass', group: 'Itinerary', label: 'Approved cabin class', source: 'leg.travelClassId',
    tmc: 'toggle', defaultTmc: true, transform: 'ID → class name', note: 'Ceiling cabin the TMC must not exceed.' },
  { key: 'hotelSegments', group: 'Accommodation', label: 'Hotel segments (city / nights / cap)', source: 'accommodation[]',
    tmc: 'toggle', defaultTmc: true },
  // §29 payload enrichment — charging/approval/traveller context carried to the TMC so
  // airfare can post directly to ERP (§36) and the agent has full booking context.
  { key: 'charging', group: 'Charging & context', label: 'Charging / cost objects (CC·WBS·BA)', source: 'req.allocations[]',
    tmc: 'toggle', defaultTmc: true, note: '§36 direct airfare posting needs the cost object (CC/WBS + business area).' },
  { key: 'approvalMetadata', group: 'Charging & context', label: 'Approval metadata (approvers + timestamps)', source: 'approvalSteps(Approved)',
    tmc: 'toggle', defaultTmc: true, note: 'Who approved and when — audit context for the agent.' },
  { key: 'travellerCategory', group: 'Charging & context', label: 'Traveller category & contact', source: 'employee.policyGroup / guest',
    tmc: 'toggle', defaultTmc: true, note: 'Grade / policy group (or GUEST) + contact for the booking.' },
  { key: 'personalIndicator', group: 'Charging & context', label: 'Personal-travel indicator', source: 'req.personalStart / personal legs',
    tmc: 'toggle', defaultTmc: true, note: 'Flags a personal extension so the TMC separates the personal portion.' },
  // §8 / DD-21 Guest profile collection via the TMC (PDPA). For a GUEST request only, the
  // instruction asks the TMC to e-mail the guest a secure link to capture passport / DOB /
  // contact directly — ECS never stores guest sensitive data (name, e-mail & organisation only).
  { key: 'guestProfile', group: 'Guest (PDPA)', label: 'Guest profile collection (TMC secure link)', source: 'guest.email → TMC secure profile link',
    tmc: 'toggle', defaultTmc: true, note: '§8/DD-21 PDPA — guest-only: the TMC e-mails the guest a secure link to capture passport / DOB / contact; ECS stores name, e-mail & organisation only.' },

  // ======================= SYNC TO EXPENSE CLAIM (TE) =======================
  { key: 'teTraveller', group: 'Claim header', label: 'Traveller', source: 'employee.name', te: 'field', defaultTe: 'LOCKED' },
  { key: 'teEntity', group: 'Claim header', label: 'Employing entity', source: 'ECS entity', te: 'field', defaultTe: 'LOCKED' },
  { key: 'teDepartment', group: 'Claim header', label: 'Department', source: 'employee.departmentId', te: 'field', defaultTe: 'LOCKED' },
  { key: 'teRequestNo', group: 'Claim header', label: 'Travel Request number', source: 'req.requestNumber', te: 'field', defaultTe: 'LOCKED' },
  { key: 'teAuthNo', group: 'Claim header', label: 'Travel Authorisation number', source: 'req.authorisationNo', te: 'field', defaultTe: 'LOCKED' },
  { key: 'tePurpose', group: 'Claim header', label: 'Travel purpose', source: 'req.purposeId', te: 'field', defaultTe: 'LOCKED' },
  { key: 'teDescription', group: 'Claim header', label: 'Description', source: 'req.description', te: 'field', defaultTe: 'LOCKED' },
  { key: 'teDestination', group: 'Claim header', label: 'Main destination', source: 'req.destCity / destCountry', te: 'field', defaultTe: 'LOCKED' },
  { key: 'teDates', group: 'Claim header', label: 'Official travel dates', source: 'req.startDate / endDate', te: 'field', defaultTe: 'EDITABLE', note: 'Editable so the claimant can trim to actual dates.' },
  { key: 'teApprovedClass', group: 'Claim header', label: 'Travel class (approved)', source: 'req.travelClassId', te: 'field', defaultTe: 'REFERENCE' },
  { key: 'teCharging', group: 'Claim header', label: 'Charging & cost allocation', source: 'req.allocations[]', te: 'field', defaultTe: 'LOCKED', note: 'CC / WBS — never sent to the TMC.' },
  { key: 'teBookingRef', group: 'Claim header', label: 'Booking reference (PNR / ticket)', source: 'booking.pnr / ticketNo', te: 'field', defaultTe: 'REFERENCE', note: '§35 carries the confirmed TMC booking reference into the claim.' },

  { key: 'teAirfareLine', group: 'Claim lines', label: 'Airfare line', source: 'expense(AIRFARE)', te: 'line', category: 'AIRFARE', defaultTe: 'REFERENCE', note: 'DD-19: TMC-booked airfare is central (CTA) → Reference-only (not reimbursed); self-booked airfare is employee-paid → Editable. Settlement decides reimbursable-vs-reference; the Airfare-treatment setting only governs how a central line posts (direct-to-SAP vs shown-in-claim). Admin override still wins.' },
  { key: 'teAccommodationLine', group: 'Claim lines', label: 'Accommodation line', source: 'expense(ACCOMMODATION)', te: 'line', category: 'ACCOMMODATION', defaultTe: 'EDITABLE', note: 'DD-19: Individual hotel is employee-paid → Editable (reimbursable); CTA hotel is central-billed → Reference-only (not reimbursed). Driven by the request’s hotel payment channel. Admin override still wins.' },
  { key: 'teOdaLine', group: 'Claim lines', label: 'Overseas Daily Allowance line', source: 'expense(ODA)', te: 'line', category: 'ODA', defaultTe: 'EDITABLE' },
  { key: 'teConferenceLine', group: 'Claim lines', label: 'Conference / registration line', source: 'expense(CONFERENCE)', te: 'line', category: 'CONFERENCE', defaultTe: 'EDITABLE' },
  { key: 'teOtherLine', group: 'Claim lines', label: 'Other expense lines', source: 'expense(OTHER)', te: 'line', category: 'OTHER', defaultTe: 'EDITABLE' },

  { key: 'teBookedAmounts', group: 'Claim actuals', label: 'Booked amounts (from TMC feed)', source: 'booking.fare / taxes / fees', te: 'actual', defaultTe: 'REFERENCE', note: 'Inbound TMC actuals shown for estimate-to-actual (§13.17). Set Excluded for self-booked trips.' },

  // ============ BOOKING CONFIRMATION — TMC FEED (§30 / §39 lifecycle · DD-17) ============
  // The datapoints the TMC booking feed syncs back on confirmation. Reference-only: they update the
  // booking + estimate-to-actual view, not claim lines. Keyed by the Travel Authorisation (one TR → N PNRs).
  { key: 'feedBookingStatus', group: 'Booking confirmation (feed)', label: 'Booking status (lifecycle)', source: 'inbound.bookingStatus', te: 'actual', defaultTe: 'REFERENCE', note: '§30/§39 the booking lifecycle status — Booked / Ticketed / Partially booked / Traveller action required / Cancelled / Failed. Also gates the inbound-accept guard.' },
  { key: 'feedPnr', group: 'Booking confirmation (feed)', label: 'PNR / record locator', source: 'inbound.pnr', te: 'actual', defaultTe: 'REFERENCE', note: 'The supplier booking reference; carried into the claim (see Booking reference).' },
  { key: 'feedTickets', group: 'Booking confirmation (feed)', label: 'E-ticket numbers', source: 'inbound.ticketNumbers[]', te: 'actual', defaultTe: 'REFERENCE', note: 'One e-ticket per air coupon.' },
  { key: 'feedBookedClass', group: 'Booking confirmation (feed)', label: 'Booked cabin class', source: 'inbound.segments[].bookedClass', te: 'actual', defaultTe: 'REFERENCE', note: '§6.4 the actual class booked — compared to the approved class to raise a booking deviation.' },
  { key: 'feedBookedDates', group: 'Booking confirmation (feed)', label: 'Booked travel dates', source: 'inbound.segments[].departDate / arriveDate', te: 'actual', defaultTe: 'REFERENCE', note: 'DD-17 the booked depart / arrival dates (persisted on the segment).' },
  { key: 'feedChannel', group: 'Booking confirmation (feed)', label: 'Fulfilment channel', source: 'inbound.channel', te: 'actual', defaultTe: 'REFERENCE', note: 'TMC online / agent-assisted / offline — the channel that fulfilled the booking.' },
  { key: 'feedTimestamps', group: 'Booking confirmation (feed)', label: 'Booked / ticketed timestamps', source: 'inbound.bookedAt / ticketedAt', te: 'actual', defaultTe: 'REFERENCE', note: 'When the booking was confirmed and the ticket issued — a charge may post to SAP only once ticketed.' },
  { key: 'feedSupplier', group: 'Booking confirmation (feed)', label: 'Supplier (airline / hotel)', source: 'inbound.segments[].supplierName / supplierCode', te: 'actual', defaultTe: 'REFERENCE', note: 'Airline / hotel name + code (and hotel confirmation no.) for reconciliation.' },

  // ==================== CTA CHARGES — TMC FEED (DD-30 / DD-31) ====================
  // The inbound datapoints the TMC feed carries for centrally-settled (CTA) charges, which ECS
  // posts to SAP on receipt (Dr expense ⇄ Cr CTA clearing). Reference-only: not claim lines.
  { key: 'ctaFeedAccount', group: 'CTA charges (feed)', label: 'CTA account lodged to', source: 'inbound.ctaAccountId', te: 'actual', defaultTe: 'REFERENCE', note: 'DD-30 the CTA card the central charges hit → credit (clearing) GL via the CTA master.' },
  { key: 'ctaFeedSettled', group: 'CTA charges (feed)', label: 'Settlement status + charge date', source: 'inbound.ctaCharged / ctaChargeDate', te: 'actual', defaultTe: 'REFERENCE', note: 'DD-31 a charge posts to SAP only once the feed reports it settled (ticketed/charged) on the CTA.' },
  { key: 'ctaFeedInvoice', group: 'CTA charges (feed)', label: 'Provider invoice number', source: 'inbound.invoiceNumber', te: 'actual', defaultTe: 'REFERENCE', note: 'DD-31 SAP posting Reference for the journal (the PNR is used when absent).' },
  { key: 'ctaFeedCharges', group: 'CTA charges (feed)', label: 'Per-charge breakdown (type · expense type · amount)', source: 'inbound.charges[]', te: 'actual', defaultTe: 'REFERENCE', note: 'DD-31 one Dr line per expense type (airfare / fee / hotel / car / visa) — each maps to the ECS expense-type master for its GL; the agency fee is its own line, never folded into the zero-rated airfare.' },
  { key: 'ctaFeedGst', group: 'CTA charges (feed)', label: 'Per-charge tax code + GST amount', source: 'inbound.charges[].gstCode / gstAmountSgd', te: 'actual', defaultTe: 'REFERENCE', note: 'DD-31 SAP tax code (IZ / IO / I9 / P9) + external tax amount per charge. Resolved via the shared GST logic (src/data/gstCodes.ts); the I9 ↔ P9 fork follows the charging-account GST-claimable flag.' },
  { key: 'ctaFeedCard', group: 'CTA charges (feed)', label: 'CTA card reference + statement period', source: 'inbound.ctaCardRef / statementPeriod', te: 'actual', defaultTe: 'REFERENCE', note: 'DD-30 masked card reference and billing period — reconciles the SAP posting to the CTA card statement.' },
  { key: 'ctaFeedCurrency', group: 'CTA charges (feed)', label: 'Original booking currency + FX', source: 'inbound.charges[].currency / foreignAmount / fxRate', te: 'actual', defaultTe: 'REFERENCE', note: 'Audit only — ECS posts the SGD amount; the source currency / foreign amount / FX rate let finance reconcile a foreign-currency booking.' },

  // ==================== CANCELLATION, REFUND & CHANGE — TMC FEED ====================
  // Lifecycle events after confirmation. A cancellation drives the CTA reversal (the refund credits
  // back, the non-refundable penalty stays a charge); a reissue carries the change fee + new reference.
  { key: 'feedCancellation', group: 'Cancellation & change (feed)', label: 'Cancellation / refund', source: 'inbound.cancellation', te: 'actual', defaultTe: 'REFERENCE', note: 'Cancelled date + reason, the non-refundable penalty (stays a charge) and the refund credited to the CTA — drives the auto-reversal of the CTA posting.' },
  { key: 'feedReissue', group: 'Cancellation & change (feed)', label: 'Change / reissue', source: 'inbound.reissue', te: 'actual', defaultTe: 'REFERENCE', note: 'Reissue date, change fee and the new PNR / e-ticket when a booking is amended — reconciled against the approved request (§6.4 deviation).' },
];

// ============================ PARAMETER FILTERS (message guards) ============================
// Message-level gating: the conditions that must ALL hold before an outbound booking
// instruction is sent, or an inbound TMC response is accepted. Each guard is a
// declarative predicate (param · operator · value); the admin can enable/disable it and,
// where marked editable, change the value. Evaluated in `evaluateFlow` (integration.ts)
// and enforced in `handoffToTmc` (OUTBOUND) and `receiveBooking` (INBOUND).
export type GuardFlow = 'OUTBOUND' | 'INBOUND' | 'TE_SYNC';
export type GuardOp = 'eq' | 'in' | 'isSet';
export type GuardParam = 'status' | 'bookingStatus' | 'bookingMethod' | 'authorisationNo';

export interface ContractGuard {
  key: string;
  flow: GuardFlow;
  label: string;
  param: GuardParam;
  op: GuardOp;
  value?: string | string[];   // catalogue default value (string for eq, string[] for in)
  note?: string;
}

export const GUARD_PARAM_LABELS: Record<GuardParam, string> = {
  status: 'Approval status',
  bookingStatus: 'Booking status',
  bookingMethod: 'Booking method',
  authorisationNo: 'Travel Authorisation no.',
};

// Selectable values per parameter — the choices offered when editing a guard's value.
// `authorisationNo` uses the `isSet` operator (presence), so it has no value list.
export const GUARD_PARAM_OPTIONS: Record<GuardParam, string[]> = {
  status: Object.values(REQUEST_STATUS),
  bookingStatus: Object.values(BOOKING_STATUS),
  bookingMethod: Object.values(BOOKING_METHOD),
  authorisationNo: [],
};

/** A guard's value is editable unless it tests mere presence (`isSet`). */
export function guardEditable(g: ContractGuard): boolean {
  return g.op !== 'isSet';
}

// Methods that route to the TMC (self-booked / no-booking are never sent).
const TMC_METHODS = [BOOKING_METHOD.TMCOnline, BOOKING_METHOD.AgentAssisted, BOOKING_METHOD.Offline, BOOKING_METHOD.HostArranged];

export const CONTRACT_GUARDS: ContractGuard[] = [
  // ---- Send to TMC: do not hand off unless ALL of these hold ----
  { key: 'out.approved', flow: 'OUTBOUND', label: 'Request is approved', param: 'status', op: 'eq',
    value: REQUEST_STATUS.Approved,
    note: 'Do not send the travel request to the TMC until it reaches this status.' },
  { key: 'out.unsent', flow: 'OUTBOUND', label: 'Not already handed off / booked', param: 'bookingStatus', op: 'eq',
    value: BOOKING_STATUS.NotSent, note: 'Prevents re-sending a request already sent to the TMC or booked.' },
  { key: 'out.tmcMethod', flow: 'OUTBOUND', label: 'Booking method is TMC-served', param: 'bookingMethod', op: 'in',
    value: TMC_METHODS, note: 'Self-booked and no-booking methods are never sent to the TMC.' },
  { key: 'out.authorised', flow: 'OUTBOUND', label: 'Travel Authorisation issued', param: 'authorisationNo', op: 'isSet',
    note: 'Only send once a TA number exists.' },
  // ---- Receive from TMC: do not accept a response unless ALL of these hold ----
  { key: 'in.sent', flow: 'INBOUND', label: 'A booking instruction is in flight', param: 'bookingStatus', op: 'in',
    value: [BOOKING_STATUS.SentToTMC, BOOKING_STATUS.ReceivedByTMC, BOOKING_STATUS.InProgress, BOOKING_STATUS.TravellerActionRequired, BOOKING_STATUS.PartiallyBooked],
    note: 'Only process a response for a request in flight with the TMC (§30/§39 lifecycle).' },
  { key: 'in.authorised', flow: 'INBOUND', label: 'Travel Authorisation issued', param: 'authorisationNo', op: 'isSet',
    note: 'DD-17: the inbound is keyed by the Travel Authorisation (TA/TR), not the PNR — retrieval returns the FULL set of PNRs under the TA (one TR → N PNRs). Reject responses that do not carry a valid TA.' },
  // ---- Sync to ECS Expense Claim (TE): only pre-populate a claim when ALL of these hold ----
  { key: 'te.claimable', flow: 'TE_SYNC', label: 'Request is claimable', param: 'status', op: 'in',
    value: [REQUEST_STATUS.Approved, REQUEST_STATUS.Closed], note: 'Only create / sync a TE claim from a request in these statuses.' },
  { key: 'te.authorised', flow: 'TE_SYNC', label: 'Travel Authorisation issued', param: 'authorisationNo', op: 'isSet',
    note: 'Require a TA number before an expense claim can be raised against the request.' },
];
