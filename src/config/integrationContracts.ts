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
export const CONTRACT_VERSION = 'ecs-pretrip-contract/1.0';

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

  { key: 'teAirfareLine', group: 'Claim lines', label: 'Airfare line', source: 'expense(AIRFARE)', te: 'line', category: 'AIRFARE', defaultTe: 'REFERENCE', note: 'Default overridden by the Airfare-treatment setting (§13.8).' },
  { key: 'teAccommodationLine', group: 'Claim lines', label: 'Accommodation line', source: 'expense(ACCOMMODATION)', te: 'line', category: 'ACCOMMODATION', defaultTe: 'EDITABLE' },
  { key: 'teOdaLine', group: 'Claim lines', label: 'Overseas Daily Allowance line', source: 'expense(ODA)', te: 'line', category: 'ODA', defaultTe: 'EDITABLE' },
  { key: 'teConferenceLine', group: 'Claim lines', label: 'Conference / registration line', source: 'expense(CONFERENCE)', te: 'line', category: 'CONFERENCE', defaultTe: 'EDITABLE' },
  { key: 'teOtherLine', group: 'Claim lines', label: 'Other expense lines', source: 'expense(OTHER)', te: 'line', category: 'OTHER', defaultTe: 'EDITABLE' },

  { key: 'teBookedAmounts', group: 'Claim actuals', label: 'Booked amounts (from TMC feed)', source: 'booking.fare / taxes / fees', te: 'actual', defaultTe: 'REFERENCE', note: 'Inbound TMC actuals shown for estimate-to-actual (§13.17). Set Excluded for self-booked trips.' },
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
    note: 'Reject responses that do not carry a valid TA.' },
  // ---- Sync to ECS Expense Claim (TE): only pre-populate a claim when ALL of these hold ----
  { key: 'te.claimable', flow: 'TE_SYNC', label: 'Request is claimable', param: 'status', op: 'in',
    value: [REQUEST_STATUS.Approved, REQUEST_STATUS.Closed], note: 'Only create / sync a TE claim from a request in these statuses.' },
  { key: 'te.authorised', flow: 'TE_SYNC', label: 'Travel Authorisation issued', param: 'authorisationNo', op: 'isSet',
    note: 'Require a TA number before an expense claim can be raised against the request.' },
];
