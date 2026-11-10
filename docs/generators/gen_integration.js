// NTU Travel Request: Integration Contract (.docx) generator.
// Source: src/config/integrationContracts.ts, src/integrations/tmc/{contract,adapter,vocab}.ts,
// src/modules/pretrip/{integration,tmcRetrieval}.ts, prisma schema (Integration* models).
const fs = require('fs');
const { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType, BorderStyle, ShadingType, AlignmentType, PageOrientation, TableLayoutType } = require('docx');

const NAVY = '1B1C62', RED = 'D71440', MUTE = '6b6f82', HEAD = 'EDEFF7', ZEBRA = 'F7F8FC', CODEBG = 'F4F5F9';
const out = [];
const cell = (text, { w, bold, color, shade, align, size, font } = {}) => new TableCell({
  width: { size: w, type: WidthType.DXA }, shading: shade ? { type: ShadingType.CLEAR, color: 'auto', fill: shade } : undefined,
  margins: { top: 40, bottom: 40, left: 90, right: 90 },
  children: [new Paragraph({ alignment: align, children: (Array.isArray(text) ? text : [text]).map((t) => new TextRun({ text: String(t), bold: !!bold, color: color || '222222', size: size || 15, font: font || 'Calibri' })) })],
});
function T(headers, widths, rows, opts = {}) {
  const hr = new TableRow({ tableHeader: true, children: headers.map((h, i) => cell(h, { w: widths[i], bold: true, color: NAVY, shade: HEAD, size: 15 })) });
  const rr = rows.map((r, idx) => new TableRow({ children: r.map((c, i) => cell(c, { w: widths[i], shade: idx % 2 ? ZEBRA : undefined, bold: i === 0 && opts.boldFirst !== false, color: i === 0 ? '2a2d40' : '333333', font: opts.mono && i === 0 ? 'Consolas' : 'Calibri' })) }));
  return new Table({ columnWidths: widths, width: { size: widths.reduce((a, b) => a + b, 0), type: WidthType.DXA }, layout: TableLayoutType.FIXED, rows: [hr, ...rr] });
}
const H1 = (t) => out.push(new Paragraph({ heading: HeadingLevel.HEADING_1, pageBreakBefore: true, children: [new TextRun({ text: t })] }));
const H2 = (t) => out.push(new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 220, after: 50 }, children: [new TextRun({ text: t })] }));
const P = (t) => out.push(new Paragraph({ spacing: { after: 100 }, children: typeof t === 'string' ? [new TextRun({ text: t, size: 19, color: '333333' })] : t }));
const BUL = (t) => out.push(new Paragraph({ bullet: { level: 0 }, spacing: { after: 20 }, children: [new TextRun({ text: t, size: 18, color: '333333' })] }));
const TBL = (x) => out.push(x);
const GAP = () => out.push(new Paragraph({ spacing: { after: 120 }, children: [] }));
function code(lines, caption) {
  if (caption) out.push(new Paragraph({ spacing: { before: 80, after: 20 }, children: [new TextRun({ text: caption, italics: true, size: 15, color: MUTE })] }));
  lines.forEach((ln, i) => out.push(new Paragraph({
    spacing: { before: i === 0 ? 0 : 0, after: i === lines.length - 1 ? 100 : 0 }, shading: { type: ShadingType.CLEAR, color: 'auto', fill: CODEBG },
    border: { left: { style: BorderStyle.SINGLE, size: 12, color: 'c9cde0' } }, indent: { left: 120 },
    children: [new TextRun({ text: ln || ' ', font: 'Consolas', size: 15, color: '2a2d40' })],
  })));
}

// Note box, styled the same as the Data Dictionary note box.
const boxP = (t, b) => new Paragraph({ spacing: { after: 60 }, shading: { type: ShadingType.CLEAR, color: 'auto', fill: 'FBF8EF' }, border: { left: { style: BorderStyle.SINGLE, size: 18, color: 'C8A24A' } }, indent: { left: 140 }, children: [new TextRun({ text: t, bold: !!b, size: b ? 19 : 16, color: b ? '7A5A00' : '444444' })] });

// ===== COVER =====
out.push(new Paragraph({ spacing: { before: 1800 }, children: [new TextRun({ text: 'NTU Travel & Expense Claim System', bold: true, color: RED, size: 26 })] }));
out.push(new Paragraph({ spacing: { before: 120 }, children: [new TextRun({ text: 'Travel Request: Integration Contract', bold: true, color: NAVY, size: 56 })] }));
out.push(new Paragraph({ spacing: { before: 160 }, children: [new TextRun({ text: 'Prototype reference: TMC integration boundary, covering the outbound booking instruction, inbound booking and charge feed, message guards, status vocabularies and the TE-claim sync. Not the target integration design.', color: '4a4e63', size: 23 })] }));
out.push(new Paragraph({ spacing: { before: 500, after: 160 }, border: { top: { style: BorderStyle.SINGLE, size: 12, color: 'eceaf3' } }, children: [new TextRun({ text: `Contract version ecs-pretrip-contract/1.3 · provider-neutral canonical model · 10 November 2026`, color: MUTE, size: 18 })] }));
out.push(boxP('Note to readers: prototype reference only', true));
out.push(boxP('This document describes how the Pre-Trip Travel Request prototype simulates the TMC, ECS and SAP integration. It is shared as a reference for the business intent: payloads, guards, status mapping, CTA posting and claim sync. It is not the target integration design.', false));
out.push(boxP('The prototype uses mock ECS services and a simulated TMC feed. Transport, authentication, error handling, retries, monitoring and other non-functional requirements are not covered and are to be designed by the vendor.', false));
out.push(boxP('Code references (file paths and function names) describe the prototype implementation only.', false));
out.push(boxP('References such as §13.9 or DD-31 point to sections and design decisions in the Pre-Trip prototype build pack, shared alongside this document.', false));

// ===== 1 OVERVIEW =====
H1('1 · Overview');
P('ECS publishes ONE provider-neutral canonical contract across two integration boundaries. Provider-specific wire mappings live in a thin adapter layer, so a change of TMC is contained there and the canonical model, workflow and TE linkage stay unchanged.');
BUL('Outbound, “Send to TMC”: the approved Travel Request becomes a canonical booking instruction (§13.9). Core fields always flow; every other field is an admin-togglable contract field.');
BUL('Inbound, booking & charge feed: the TMC returns a booking confirmation per PNR, keyed by the Travel Authorisation (TA). One Travel Request → N PNRs. The feed carries the OBT booking-record status, GDS segment/coupon codes and the per-charge CTA breakdown that drives the SAP posting.');
BUL('TE sync, “Sync to claim” (§13.8): approved-request fields and TMC actuals pre-populate the expense claim, each with a treatment (Locked / Editable / Reference / Excluded).');
P([new TextRun({ text: 'Transport & state. ', bold: true, size: 19, color: NAVY }), new TextRun({ text: 'The prototype is PUSH-primary: the inbound stores bookings against the request; retrieval is a read over that stored set, shaped exactly as a real “GET bookings for TA-YYYY-NNNNNN” endpoint would return. Every exchanged payload is persisted to the IntegrationMessage table (direction, kind, canonical JSON, provider) for audit and correlation.', size: 19, color: '333333' })]);
H2('Objects that persist the integration');
TBL(T(['Object / file', 'Role'], [4200, 11198], [
  ['IntegrationMessage (table)', 'One row per exchanged payload: direction OUTBOUND|INBOUND, kind TMC_HANDOFF|TMC_RESPONSE, tmcProviderId, canonical JSON payload, createdAt.'],
  ['IntegrationFieldSetting (table)', 'Admin override of a contract field: includeTmc (outbound) + teTreatment (claim). Overlays the CONTRACT_FIELDS default.'],
  ['IntegrationGuardSetting (table)', 'Admin override of a message guard: enabled + value. Overlays the CONTRACT_GUARDS default.'],
  ['CanonicalOutbound / CanonicalInbound', 'The wire contracts (src/integrations/tmc/contract.ts). buildOutbound() and simulateInbound() in adapter.ts build them.'],
  ['src/config/integrationContracts.ts', 'Declarative source of truth: CONTRACT_FIELDS, CONTRACT_GUARDS, CONTRACT_VERSION.'],
]));

// ===== 2 ENVELOPE =====
H1('2 · Message envelope & provenance');
P('Every message carries a provenance header (meta) alongside the payload body. It is a factual snapshot for correlation and audit, not the guard rules (those are sender-side gates evaluated before emission).');
H2('OutboundMeta');
TBL(T(['Field', 'Type', 'Notes'], [2800, 2600, 9998], [
  ['messageId', 'string', 'Idempotency key: a re-send of the same messageId is ignored by the receiver.'],
  ['sentAt', 'string (ISO)', 'Timestamp of emission.'],
  ['sourceStatus', 'string', 'Request status at the moment of send (snapshot).'],
  ['contractVersion', 'string', 'Integration-contract version in effect (e.g. ecs-pretrip-contract/1.3).'],
  ['tmc', 'string?', 'Multi-TMC: the provider this message is routed to.'],
], { mono: true }));
H2('InboundMeta');
TBL(T(['Field', 'Type', 'Notes'], [2800, 2600, 9998], [
  ['messageId', 'string', 'Receiver-side message id.'],
  ['receivedAt', 'string (ISO)', 'Timestamp of receipt.'],
  ['correlationId', 'string | null', 'The outbound messageId this response answers.'],
  ['sourceStatus', 'string', 'Request status snapshot at receipt.'],
  ['contractVersion', 'string', 'Contract version the response was processed under.'],
  ['tmc', 'string?', 'Multi-TMC: the provider this response came from.'],
], { mono: true }));

// ===== 3 GUARDS =====
H1('3 · Message guards (parameter filters)');
P('Message-level gating (§13.9). Before an outbound instruction is sent, an inbound response is accepted, or a claim is pre-populated, EVERY enabled guard for that flow must pass. Guards are declarative predicates (param · operator · value), evaluated by evaluateFlow(); an admin can disable a guard or, where editable, change its value (IntegrationGuardSetting). A guard using the isSet operator tests presence and has no editable value.');
H2('Outbound guards (handoffToTmc), all must hold to send');
TBL(T(['Key', 'Rule', 'Notes'], [2400, 4600, 8398], [
  ['out.approved', 'Approval status = Approved', 'Do not send until the request is approved.'],
  ['out.unsent', 'Booking status = Not Sent', 'Prevents re-sending a request already handed off or booked.'],
  ['out.tmcMethod', 'Booking method ∈ { TMC_ONLINE, AGENT_ASSISTED, OFFLINE, HOST_ARRANGED }', 'Self-booked / no-booking are never sent to the TMC.'],
  ['out.authorised', 'Travel Authorisation no. is set', 'Only send once a TA number exists.'],
], { mono: true }));
H2('Inbound guards (receiveBooking), all must hold to accept');
TBL(T(['Key', 'Rule', 'Notes'], [2400, 4600, 8398], [
  ['in.sent', 'Booking status ∈ { Sent to TMC, Received by TMC, Booking In Progress, Traveller Action Required, Partially Booked }', 'Only process a response for a request in flight (§30/§39).'],
  ['in.authorised', 'Travel Authorisation no. is set', 'The inbound is keyed by the TA (not the PNR); reject responses without a valid TA.'],
], { mono: true }));
H2('TE-sync guards (prepopulateClaim), all must hold to pre-populate');
TBL(T(['Key', 'Rule', 'Notes'], [2400, 4600, 8398], [
  ['te.claimable', 'Approval status ∈ { Approved, Closed }', 'Only create / sync a claim from a request in these statuses.'],
  ['te.authorised', 'Travel Authorisation no. is set', 'Require a TA before a claim can be raised.'],
], { mono: true }));
H2('TE-submit guard (submitClaim), must hold to submit the claim');
TBL(T(['Key', 'Rule', 'Notes'], [2400, 4600, 8398], [
  ['te.evidence', 'Offline-approval evidence complete', '§8 every booking deviation that requires offline-approval evidence (ModuleSettings.evidenceRequiredFor) has a linked evidence attachment OR an approved waiver. Self-booked trips have no booking to compare, so this passes vacuously. Enforced in submitClaim; a blocked submit is logged, not performed.'],
], { mono: true }));

// ===== 4 OUTBOUND =====
H1('4 · Outbound booking instruction (Send to TMC)');
P('The approved request is translated to a CanonicalOutbound by buildOutbound(req, enabled, meta). Core fields always flow; a toggled field is omitted from the payload when its contract key is switched off. The enabled set comes from the resolved contract (getContractSettings → tmcEnabledSet).');
P([new TextRun({ text: 'v1.3 / B2 approval snapshot. ', bold: true, size: 19, color: NAVY }), new TextRun({ text: 'At final approval the approved breakdown and itinerary are frozen as an immutable snapshot (TravelRequest.approvedBreakdownJson): the approved canonical instruction(s), one per traveller for a group, with the approved itinerary (routes + dates), the per-segment approved amounts and the cost-ceiling breakdown. The outbound instruction is built FROM this snapshot, not recomputed from the live request, so an edit after approval cannot change what is sent (only the operational channel, bookingMethod, is overlaid with the current hand-off routing). The approved request cannot be changed: at booking the traveller may shift dates, and the TMC returns the actual dates and fare, but not the route. A route that cannot be fulfilled as approved is returned NOT BOOKED, and the traveller raises a fresh TR/TA for the correct route. A material amendment re-approves and writes a fresh snapshot.', size: 19, color: '333333' })]);
H2('4.1 Field catalogue');
TBL(T(['Contract key', 'Label', 'Source', 'Sent', 'Notes'], [2100, 2500, 2900, 1500, 6398], [
  ['authorisationNumber', 'Travel Authorisation no.', 'req.authorisationNo', 'Core', 'Booking reference, always carried.'],
  ['travellerRef', 'Traveller reference', 'req.travellerId', 'Core', 'Lead traveller.'],
  ['bookingMethod', 'Booking method / channel', 'req.bookingMethod', 'Core', 'Routes to the correct TMC channel.'],
  ['travellers', 'All group travellers', 'req.travellers[]', 'Toggle · on', 'Group hand-off carries every traveller (§13.14).'],
  ['bookingDeadline', 'Booking deadline', 'req.bookingDeadline', 'Toggle · on', '-'],
  ['costCeiling', 'Approved cost ceiling (SGD)', 'Σ airfare + accommodation', 'Toggle · on', 'The approved REFERENCE amount for the TMC and the claim approver. It is NOT a hard limit at booking; the actual fare is charged and a material gap is reviewed at claim (§6.4).'],
  ['costCeilingBreakdown', 'Cost-ceiling breakdown', 'EstimatedExpense by category + hotel billTo', 'Toggle · on', 'Per-category reference amounts (airfare, accommodation) and the CTA / traveller split; adds approvedAmountSgd per AIR leg and approvedTotalSgd per HOTEL stay. Reference amounts, not booking limits.'],
  ['tripType', 'Trip type', 'req.tripType', 'Toggle · on', 'ROUND_TRIP, ONE_WAY or MULTI_CITY.'],
  ['allowedDateShift', 'Allowed date shift (days)', 'ModuleSettings.maxDateShiftDaysBefore / After', 'Toggle · on', '§6.4 { daysBefore, daysAfter }: at online booking the route and cabin cannot change; a travel date may move within approved ± these days (and within validity). The TMC tool can enforce it where supported; a booking outside the window is accepted but raises a material DATES deviation.'],
  ['approvedExceptions', 'Approved policy exceptions', 'policyChecks(Exception)', 'Toggle · on', 'Authorises e.g. an approved class upgrade at booking.'],
  ['tripPurpose', 'Travel purpose', 'req.purposeId', 'Toggle · on', '§4.6 required in the approved-request hand-off.'],
  ['eventDates', 'Event / conference dates', 'req.eventStartDate / eventEndDate', 'Toggle · on', 'May differ from travel dates.'],
  ['approvalValidity', 'Approval validity period', 'req.authorisationExpiry', 'Toggle · on', 'Approval validity window.'],
  ['airSegments', 'Air segments', 'legs[] (shared)', 'Toggle · on', 'Origin / dest / dates.'],
  ['airApprovedClass', 'Approved cabin class', 'leg.travelClassId', 'Toggle · on', 'Ceiling cabin the TMC must not exceed (ID → class name).'],
  ['hotelSegments', 'Hotel segments', 'accommodation[]', 'Toggle · on', 'City / nights / cap / billTo.'],
  ['charging', 'Charging / cost objects', 'req.allocations[]', 'Toggle · on', '§36 direct airfare posting needs the cost object (CC/WBS + BA).'],
  ['approvalMetadata', 'Approval metadata', 'approvalSteps(Approved)', 'Toggle · on', 'Who approved and when, audit context.'],
  ['travellerCategory', 'Traveller category & contact', 'employee.policyGroup / guest', 'Toggle · on', 'Grade / policy group (or GUEST) + contact.'],
  ['personalIndicator', 'Personal-travel indicator', 'req.personalStart / personal legs', 'Toggle · on', 'Flags a personal extension so the TMC separates it.'],
  ['guestProfile', 'Guest profile collection', 'guest.email → TMC secure link', 'Toggle · on', 'Guest-only PDPA: TMC collects passport/DOB/contact; ECS keeps name/email/org only.'],
], { boldFirst: true, mono: true }));
H2('4.2 CanonicalOutbound payload');
TBL(T(['Field', 'Type', 'Notes'], [2900, 3400, 9098], [
  ['meta', 'OutboundMeta?', 'Provenance header (§2).'],
  ['authorisationNumber', 'string', 'The TA: anchor for the whole exchange.'],
  ['travellerRef / travellerName', 'string / string?', 'Lead traveller id and resolved name.'],
  ['bookingFor', "'EMPLOYEE'|'GUEST'|'STUDENT'", 'Non-employee indicator.'],
  ['guest', '{ name, email?, organisation?, studentId?, programme? }', 'Non-employee identity (no ECS profile).'],
  ['guestProfile', "{ collectVia:'TMC_SECURE_LINK', deliverTo, tmcCollectedFields[], ecsRetains }", 'PDPA secure-link instruction (guest only).'],
  ['settlement', "{ mode:'HOST_DIRECT_BILL', costObject }", 'Guest: TMC direct-bills the host cost object (no claim).'],
  ['emergency', "{ lane:'EMERGENCY_BOOK_FIRST', authorisedBy, authorisationNumber, reconcile }", 'Emergency lane: reconcile against any space already held; no duplicate booking.'],
  ['travellers', 'string[]?', 'Group hand-off carries all travellers.'],
  ['instructionSeq / instructionCount / costShareSgd', 'number?', 'Group fan-out (AC15): one instruction per traveller under one correlation header.'],
  ['bookingMethod', 'string', 'TMC channel.'],
  ['bookingDeadline / approvedCostCeilingSgd / approvedExceptions', 'string?|null / number? / string[]?', 'Omitted when the contract toggle is off.'],
  ['travelPurpose / eventStartDate / eventEndDate / approvalValidUntil', 'string?/string?|null', '§4.6 approved-request context.'],
  ['tripType', "'ROUND_TRIP'|'ONE_WAY'|'MULTI_CITY'", 'Trip classification (tripType toggle).'],
  ['allowedDateShift', '{ daysBefore, daysAfter }', '§6.4 online date-shift allowance (allowedDateShift toggle). Route and cabin are fixed at booking; dates may move within this window and within validity.'],
  ['costCeilingBreakdown', '{ approvedAirfareCeilingSgd, approvedAccommodationCeilingSgd, ceilingByBillTo:{ ctaSgd, travellerSgd } }', 'v1.3 per-category and per-channel split of approvedCostCeilingSgd; reconciles to the overall ceiling.'],
  ['charging', '{ code, type, businessArea?, companyCode?, percent, isResearch, primary }[]', '§29 cost-object enrichment.'],
  ['approvals', '{ role, approver, decidedAt }[]', 'Approval metadata.'],
  ['traveller', '{ category, email? }', 'Grade / policy group + contact.'],
  ['personalTravel', 'boolean?', 'Personal-extension indicator.'],
  ['segments', '{ type:AIR|HOTEL, origin?, destination?, departDate?, arriveDate?, approvedClass?, approvedAmountSgd?, city?, nights?, cappedNightlySgd?, approvedTotalSgd?, billTo? }[]', 'AIR legs and HOTEL stays. v1.3: AIR carries approvedAmountSgd (apportioned airfare by leg duration), HOTEL carries approvedTotalSgd (approved funded total). billTo = CTA (central) | TRAVELLER (employee pays & claims) (DD-19).'],
], { mono: true }));
code([
  '{',
  '  "meta": { "messageId": "...", "sentAt": "2027-01-02T...", "sourceStatus": "Approved",',
  '           "contractVersion": "ecs-pretrip-contract/1.3", "tmc": "ctc" },',
  '  "authorisationNumber": "TA-2026-000123", "travellerRef": "E-TRAV", "bookingFor": "EMPLOYEE",',
  '  "tripType": "ROUND_TRIP", "bookingMethod": "TMC_ONLINE", "bookingDeadline": "2026-12-19",',
  '  "approvedCostCeilingSgd": 2600, "approvedExceptions": [],',
  '  "costCeilingBreakdown": {',
  '    "approvedAirfareCeilingSgd": 1200, "approvedAccommodationCeilingSgd": 1400,',
  '    "ceilingByBillTo": { "ctaSgd": 1200, "travellerSgd": 1400 } },',
  '  "charging": [{ "code": "CC-1000", "type": "CC", "businessArea": "BA-CS", "percent": 100,',
  '               "isResearch": false, "primary": true }],',
  '  "segments": [',
  '    { "type": "AIR",   "origin": "SIN", "destination": "HND", "departDate": "2027-01-02",',
  '      "arriveDate": "2027-01-02", "approvedClass": "Economy", "approvedAmountSgd": 600 },',
  '    { "type": "AIR",   "origin": "HND", "destination": "SIN", "departDate": "2027-01-06",',
  '      "arriveDate": "2027-01-06", "approvedClass": "Economy", "approvedAmountSgd": 600 },',
  '    { "type": "HOTEL", "city": "TYO", "nights": 4, "cappedNightlySgd": 350,',
  '      "approvedTotalSgd": 1400, "billTo": "TRAVELLER" }',
  '  ]',
  '}',
], 'Example: individual employee outbound (toggles default-on):');
P([new TextRun({ text: 'Per-leg apportionment is a prototype assumption. ', bold: true, size: 19, color: NAVY }), new TextRun({ text: 'Airlines often price a return or multi-city fare as a whole, so approvedAmountSgd per AIR leg is a duration-weighted split carried for governance only; the airfare category ceiling (Σ airfare) is the primary control. The vendor should confirm whether per-leg amounts are available from the GDS/OBT or whether only a journey total is meaningful.', size: 19, color: '333333' })]);
H2('4.3 Group fan-out (AC15)');
P('A single approval emits one instruction PER traveller under a GroupFanoutOutbound envelope { mode:"GROUP_FANOUT", authorisationNumber, groupType, instructionCount, instructions: CanonicalOutbound[] }. v1.3 the envelope carries groupType (STAFF, STUDENT or MIXED, from TravelRequest.groupType). Each instruction carries instructionSeq / instructionCount, that traveller’s costShareSgd, and v1.3 its own costCeilingBreakdown and approvedCostCeilingSgd for that traveller’s share, with bookingFor set per traveller (EMPLOYEE, STUDENT or GUEST in a mixed group). The inbound counterpart is GroupFanoutInbound { mode, authorisationNumber, bookings: CanonicalInbound[] }.');

// ===== 5 INBOUND =====
H1('5 · Inbound booking confirmation (from TMC)');
P('The TMC returns a CanonicalInbound per PNR. ECS maps the OBT booking-record status to its own lifecycle, persists the booking, segments and charges, and records a booking deviation (§6.4) where the booked itinerary differs materially from the approved reference. The approved amount is a REFERENCE, not a booking limit: a booking is never blocked, and a material deviation is REVIEWED AT CLAIM approval (there is no in-system re-approval after the TR is approved, see §5A). The approved baseline is read from the frozen approval snapshot (§4, approvedBreakdownJson), not recomputed, so an edit after approval cannot move it. The check runs at CATEGORY level (airfare and accommodation amounts, each against its own threshold; travel dates against the allowed shift) and at SEGMENT / PNR level (each booked PNR’s airfare against the approved legs it fulfils by route; booked cabin class; booked route). Routes do not change at booking (a route that cannot be fulfilled as approved is returned not booked, §4), so a segment is only ever a fare gap on the same route; a changed route or a higher cabin without an approved exception is flagged defensively.');
P([new TextRun({ text: 'Materiality. ', bold: true, size: 19, color: NAVY }), new TextRun({ text: 'A category amount (airfare or accommodation) is material only when the booked amount exceeds the approved reference by MORE than BOTH the percentage AND the absolute threshold (ModuleSettings.deviationThresholdPct / deviationThresholdAbsSgd). Because per-leg apportionment is a prototype assumption (§4.2), a per-leg (segment) airfare breach ON ITS OWN is non-material and is recorded as LogOnly; it becomes material only when the airfare category is ALSO over threshold. A booked cabin above the approved class without a matching approved exception, a changed route, and a travel date outside the allowed shift or the approval validity are always material. Material = action ReviewAtClaim (flagged to the claim approver); non-material = action LogOnly (recorded for the record).', size: 19, color: '333333' })]);
H2('5.1 CanonicalInbound payload');
TBL(T(['Field', 'Type', 'Notes'], [2900, 3100, 9398], [
  ['meta', 'InboundMeta?', 'Provenance header; correlationId ties it to the outbound.'],
  ['authorisationNumber', 'string', 'The TA: the feed is keyed by it (one TA → N PNRs).'],
  ['pnr', 'string', 'Record locator. The PNR KEY is (supplierCode, pnr), a locator is unique only within its owning GDS/supplier.'],
  ['supplierCode', 'string?', 'GDS / plating-carrier code that owns the PNR.'],
  ['invoiceNumber', 'string?|null', 'Provider invoice no., SAP posting Reference (PNR used when absent) (DD-31).'],
  ['ticketNumbers', 'string[]', 'One e-ticket per air coupon.'],
  ['bookingStatus', 'ObtBookingStatus', 'OBT/TMC booking-record status; mapped via obtToEcsBookingStatus() (§5.2).'],
  ['channel', 'string', 'Fulfilment channel.'],
  ['fareSgd / taxesSgd / feesSgd', 'number', 'Air fare aggregate (the authoritative posting basis is charges[], §6).'],
  ['bookedAt / ticketedAt', 'string?|null', 'When confirmed / when ticketed (a charge may post only once ticketed).'],
  ['ctaAccountId / ctaCardRef / statementPeriod', 'string?|null', 'CTA settlement references (DD-30).'],
  ['ctaCharged / ctaChargeDate', 'boolean? / string?|null', 'Whether the central charges settled, and when.'],
  ['charges', 'InboundCharge[]', 'Per-charge CTA breakdown with GST, the SAP posting datapoints (§6).'],
  ['cancellation', '{ cancelledAt, reason?, cancellationFeeSgd?, refundSgd? }', 'Drives the CTA reversal (§7).'],
  ['reissue', '{ reissuedAt, changeFeeSgd?, newPnr?, newTicketNumbers?[] }', 'Change / exchange (§7).'],
  ['segments', '{ type, segmentRef?, pnr?, origin?, destination?, bookedClass?, segmentStatus?, ticketNumber?, couponNumber?, departDate?, arriveDate?, city?, roomRateSgd?, amountSgd?, supplierName?, supplierCode?, confirmationNo? }[]', 'Booked segments with the trace keys (§5.4).'],
], { mono: true }));
H2('5.2 OBT booking status → ECS booking status (obtToEcsBookingStatus)');
TBL(T(['OBT status (feed)', 'Label', '→ ECS BOOKING_STATUS'], [3400, 4200, 7798], [
  ['IN_PROGRESS, QUEUED', 'In progress / Queued', 'Booking In Progress'],
  ['TRAVELLER_ACTION_REQUIRED', 'Traveller action required', 'Traveller Action Required'],
  ['PARTIALLY_TICKETED, WAITLISTED', 'Partially ticketed / Waitlisted', 'Partially Booked'],
  ['HELD, CONFIRMED, TICKETED, SCHEDULE_CHANGE, REISSUED', 'Held / Confirmed / Ticketed / Sched change / Reissued', 'Booked'],
  ['CANCELLED, VOIDED, REFUNDED, EXPIRED', 'Cancelled / Voided / Refunded / Expired', 'Cancelled'],
  ['REJECTED, FAILED', 'Rejected / Failed', 'Booking Failed'],
  ['NO_SHOW, COMPLETED', 'No-show / Completed', 'Travel Completed'],
  ['(any other)', '-', 'Booked (default)'],
], { mono: true }));
H2('5.3 GDS segment status & e-ticket coupon status');
TBL(T(['Segment status', 'Meaning', 'Coupon status', 'Meaning'], [1700, 4000, 1700, 8000], [
  ['HK', 'Confirmed', 'O', 'Open for use'],
  ['HL', 'Waitlisted', 'F', 'Flown / used'],
  ['HN / HS', 'Need / Sold (pending)', 'E', 'Exchanged'],
  ['KK / KL', 'Confirming / from waitlist', 'R', 'Refunded'],
  ['TK / TL', 'Schedule change, confirmed / waitlist', 'V', 'Void'],
  ['UN', 'Unable, carrier cancelled', 'A / C', 'Airport control / Checked-in'],
  ['UC / US', 'Unable, waitlist closed / waitlisted', 'L', 'Lifted / boarded'],
  ['SC / HX', 'Schedule change / Cancelled', 'S / P', 'Suspended / Printed'],
  ['WK / WL / WN', 'Was confirmed / waitlisted / need', 'I', 'Irregular ops'],
], { boldFirst: false }));
H2('5.4 Association trace (§7.3): charge → ticket/segment → PNR → TA');
P('Every actual is tied back up the hierarchy so finance can reconcile any charge to what it paid for. The Travel Authorisation is the query anchor; the PNR is the TMC’s native record id (unique only within its owning supplier).');
BUL('TA (authorisationNumber) → one or more PNRs (a multi-city trip is commonly split for fares, and a re-issue adds a new PNR under the same TA).');
BUL('PNR → segments: each segment carries segmentRef, pnr, and (air) segmentStatus, ticketNumber, couponNumber.');
BUL('Charge → fulfilment: an InboundCharge carries pnr, and for air the ticketNumber + couponNumber; a hotel charge carries the segmentRef / confirmation. So charge → coupon/segment → PNR → TA is fully walkable.');
P('Retrieval is TA-keyed: bookingsForAuthorisation(req) returns the full set { authorisationNo, pnrCount, bookings[], totalFareSgd }. A self-booked trip returns an empty set (the claimant enters actuals manually).');
H2('5A After approval (confirmed business rules)');
P('NTU Finance has confirmed how changes and deviations are handled after a Travel Request is approved. In plain language:');
BUL('1. Before approval the TR can be edited and re-approved in the system (send back, amend, resubmit). The approval snapshot (approvedBreakdownJson) is written once, at final approval.');
BUL('2. After approval the TR is locked. The TA is issued and sent to the TMC. There is no in-system re-approval after this point.');
BUL('3. Online booking: only dates can change, within a configurable limit (allowedDateShift). Route, cabin class and all other approved details cannot change; hotel nights may follow the date change.');
BUL('4. Agent-assisted booking: any exception the TMC agent makes, and any approval it needs, is handled offline.');
BUL('5. The fare is based on the actual booking and can differ from the approved amount. Bookings are NOT blocked by the approved amount.');
BUL('6. The deviation between booked and approved is reviewed at CLAIM approval, not re-approved on the TR.');
BUL('7. Where a deviation needs offline approval, the traveller attaches the offline-approval evidence before the claim can be submitted (claim-stage control, §8).');
BUL('8. Recall: until a segment is ticketed, the traveller may recall the TA. ECS withdraws the pending instruction from the TMC, clears the approval snapshot and reverts the TR to an editable Draft; the TA number is retained and re-issued on re-approval (one TR = one TA). This replaces in-system post-approval amendment.');
H2('5.5 Booking deviation record (§6.4)');
P('Each deviation is persisted as a BookingDeviation row scoped so a category, segment, PNR, class, route or date variance can be told apart, not only a free-text label. level + scopeRef + pnr carry the scope; material + action carry how it is handled at claim (see Materiality above).');
TBL(T(['Field', 'Type', 'Notes'], [2600, 3400, 9398], [
  ['field', 'string', 'Human-readable label, e.g. "Airfare" or "Airfare segment (PNR ...: SIN-HND, HND-KIX)".'],
  ['approvedValue / bookedValue', 'string', 'Approved (from the frozen snapshot) vs booked (from the feed): SGD for amounts, class names for a class deviation, ISO dates for a date deviation, routes for a route deviation.'],
  ['level', "'TOTAL'|'CATEGORY'|'SEGMENT'", 'The scope level that deviated.'],
  ['scopeRef', 'string', 'The exact scope: AIRFARE | ACCOMMODATION | DATES (category); AIR:SIN-HND[,HND-KIX] | CLASS:SIN-HND | ROUTE:SIN-HND (segment).'],
  ['pnr', 'string | null', 'The booked PNR a SEGMENT deviation is on; null at CATEGORY / TOTAL level.'],
  ['material', 'boolean', 'Material (reviewed at claim) vs logged for the record only. A segment-only airfare breach is non-material unless the airfare category is also over threshold; class, route and date deviations are always material.'],
  ['action', "'ReviewAtClaim'|'LogOnly'|'UpdateBooking'", 'ReviewAtClaim (material, flagged to the claim approver), LogOnly (non-material segment breach), or UpdateBooking.'],
  ['requiresEvidence', 'boolean', '§8 set when the deviation type is in ModuleSettings.evidenceRequiredFor (CLASS | DATES | ROUTE | CATEGORY_AMOUNT). Claim submission is blocked (te.evidence) until the evidence is attached or waived.'],
  ['evidenceAttachmentId', 'string | null', 'The linked OFFLINE_APPROVAL_EVIDENCE attachment once the traveller uploads it against the request.'],
  ['waivedBy / waivedAt / waiverReason', 'string? / date? / string?', 'Set when the claim approver waives the evidence requirement, with a mandatory reason (audited).'],
], { mono: true }));

// ===== 6 CTA CHARGES =====
H1('6 · CTA charges feed & SAP posting (DD-30 / DD-31)');
P('For centrally-settled (CTA) charges, charges[] is the authoritative posting basis, not the fare/taxes/fees aggregate. The Pre-Trip module posts the CTA charges directly to SAP: one debit expense line per charge against the credit (clearing) GL of the CTA account (Dr expense ⇄ Cr CTA clearing), producing a CtaPostingDocument (one per booking + charge type, idempotent). A charge posts only once the feed reports it settled (ticketed/charged). ECS does not post CTA charges. CTA charges carried into the expense claim are for reference only (§8.2).');
H2('6.1 InboundCharge');
TBL(T(['Field', 'Type', 'Notes'], [2600, 3200, 9598], [
  ['type', "'AIRFARE'|'ACCOMMODATION'|'FEE'|'CAR'|'VISA'|'ANCILLARY'", 'Feed charge type → its own posting line.'],
  ['expenseTypeId', 'string', 'ECS expense-type master id → debit GL + default SAP tax code.'],
  ['amountSgd', 'number', 'Gross, GST-inclusive (the SGD posting basis).'],
  ['gstCode', 'string', 'SAP tax code: IZ zero-rated / IO out-of-scope / I9 claimable / P9 non-claimable.'],
  ['gstAmountSgd', 'number', 'External tax amount (0 for IZ / IO).'],
  ['gstClaimable', 'boolean?', 'Fee lines only: drives I9 (true) vs P9 (false), per the charging account.'],
  ['currency / foreignAmount / fxRate', 'string? / number? / number?', 'Audit only, source currency + FX so finance can reconcile a foreign-currency booking.'],
  ['pnr / ticketNumber / couponNumber / segmentRef', 'string? / string? / number? / string?', 'The §7.3 trace keys tying the charge to its fulfilment.'],
], { mono: true }));
P([new TextRun({ text: 'GST resolution. ', bold: true, size: 19, color: NAVY }), new TextRun({ text: 'Each charge is resolved through the shared GST logic (src/data/gstCodes.ts) off the expense-type master, so the feed’s asserted tax code and amount agree with ECS’s (store-and-validate). The agency fee is always its OWN line (I9 9% claimable), never folded into the zero-rated (IZ) airfare.', size: 19, color: '333333' })]);
H2('6.2 Posting output, CtaPostingDocument');
P('One row per (bookingId, chargeType): sapDocNo, postingDate, status Posted|Failed|Reversed, grossSgd, clearingGlAccount, and on cancellation reversalSapDocNo / reversedDate / retainedSgd (penalty retained; refund = gross − retained). Posting is triggered from the Pre-Trip module when the charge is booked to the CTA (ctaPostingTiming = ON_RECEIPT). The AT_CLAIM option is not used, as ECS does not post CTA charges.');

// ===== 7 CANCELLATION =====
H1('7 · Cancellation, refund & change');
P('Lifecycle events after confirmation. A cancellation drives the auto-reversal of the CTA posting: the refund credits back and the non-refundable penalty stays a charge (retainedSgd). A reissue carries the change fee and the new PNR / e-ticket, reconciled against the approved request as a booking deviation (§6.4).');
H2('Cancellation reasons (CANCEL_REASON)');
TBL(T(['Value', 'Value'], [7699, 7699], [
  ['TRAVELLER_REQUEST', 'SCHEDULE_CHANGE'],
  ['SUPPLIER_CANCELLED', 'POLICY_DECLINED'],
  ['APPROVAL_REJECTED', 'DUPLICATE'],
  ['NO_LONGER_REQUIRED', 'FARE_EXPIRED'],
  ['FORCE_MAJEURE', '-'],
], { boldFirst: false }));
H2('Recall / withdraw (before booking)');
P('Until a segment is ticketed the traveller may RECALL an approved TR (§5A rule 8). ECS emits an outbound withdraw message to the TMC: IntegrationMessage kind TMC_RECALL, payload { meta, mode:"WITHDRAW", authorisationNumber, reason }, so the agent does not book the withdrawn instruction, then reverts the TR to an editable Draft and clears the approval snapshot. The TA number is retained and re-issued on re-approval. Any inbound confirmation that arrives after a recall is rejected by the inbound guard, since the booking status is no longer "sent". A recall differs from a cancellation: a cancellation reverses a booking that was already made (fees / refund); a recall withdraws an instruction before any booking exists.');

// ===== 8 TE SYNC =====
H1('8 · Sync to expense claim (TE, §13.8)');
P('When a claim is created from an approved request, each contract field pre-populates with a treatment: LOCKED (read-only), EDITABLE (claimant may change), REFERENCE (shown, not a claim figure), EXCLUDED (not carried). Admin overrides (IntegrationFieldSetting.teTreatment) win over these defaults.');
H2('8.1 Claim header fields');
TBL(T(['Field', 'Source', 'Default treatment'], [3200, 4600, 7598], [
  ['Traveller / Entity / Department', 'employee master', 'LOCKED'],
  ['Travel Request no. / Travel Authorisation no.', 'req.requestNumber / authorisationNo', 'LOCKED'],
  ['Travel purpose / Description / Main destination', 'req.purposeId / description / destCity', 'LOCKED'],
  ['Official travel dates', 'req.startDate / endDate', 'EDITABLE (trim to actual)'],
  ['Travel class (approved)', 'req.travelClassId', 'REFERENCE'],
  ['Charging & cost allocation', 'req.allocations[]', 'LOCKED (CC/WBS, never sent to the TMC)'],
  ['Booking reference (PNR / ticket)', 'booking.pnr / ticketNo', 'REFERENCE'],
], { boldFirst: false }));
H2('8.2 Claim lines (by expense category)');
TBL(T(['Line', 'Default treatment', 'Rule'], [2600, 2600, 10198], [
  ['Airfare', 'REFERENCE', 'DD-19: TMC-booked airfare is central (CTA) → Reference (not reimbursed); self-booked airfare is employee-paid → Editable.'],
  ['Accommodation', 'EDITABLE', 'DD-19: individual hotel is employee-paid → Editable; CTA hotel is central-billed → Reference. Driven by the hotel payment channel.'],
  ['Overseas Daily Allowance', 'EDITABLE', '-'],
  ['Conference / registration', 'EDITABLE', '-'],
  ['Other', 'EDITABLE', '-'],
  ['Booked amounts (TMC feed)', 'REFERENCE', 'Inbound actuals for estimate-to-actual; set Excluded for self-booked trips.'],
], { boldFirst: false }));
H2('8.3 Offline-approval evidence at claim submission (§6.4 / §8)');
P('A booked-vs-approved deviation is reviewed at claim approval, not re-approved on the TR (§5A). Where a material deviation is of a type that needs offline approval, the traveller must attach the offline-approval evidence before the claim can be submitted. This is the claim-stage control that pairs with the booking-stage deviation check.');
BUL('Configuration: ModuleSettings.evidenceRequiredFor is a comma-list of deviation types that need evidence. Default: CLASS, DATES, ROUTE, CATEGORY_AMOUNT (a material airfare / accommodation amount). Empty disables the gate.');
BUL('Flag: when an inbound booking raises a material deviation of a listed type, ECS sets BookingDeviation.requiresEvidence and notifies the traveller. Upload is allowed straight away and blocks nothing at this stage.');
BUL('Evidence: the traveller uploads an OFFLINE_APPROVAL_EVIDENCE attachment against the request; it links to the specific deviation (BookingDeviation.evidenceAttachmentId). A traveller may also attach evidence voluntarily when nothing was flagged.');
BUL('Submission gate: the te.evidence guard (§3) blocks submitClaim until every requiresEvidence deviation has a linked attachment OR an approved waiver. Self-booked trips have no TMC booking to compare, so they are never gated.');
BUL('Waiver: the claim approver (or a Travel / System Administrator) may waive the requirement for a deviation, only with a MANDATORY reason. ECS records waivedBy / waivedAt / waiverReason and logs an AuditEvent; a waiver without a reason is rejected.');
BUL('Claim approval screen: shows approved vs booked, the deviation scope, and the linked evidence or waiver for each deviation.');

// ===== 9 OVERRIDES =====
H1('9 · Admin overrides & resolution');
P('Both boundaries are config-driven so a toggle actually changes the payload (a working prototype, not a diagram).');
BUL('getContractSettings() overlays IntegrationFieldSetting rows on CONTRACT_FIELDS: a core TMC field is always included; a toggled field falls back to defaultTmc; an unset TE treatment falls back to defaultTe (else EXCLUDED).');
BUL('tmcEnabledSet() yields the included outbound keys; prepopContract() yields the per-field / per-line claim treatments.');
BUL('getGuardSettings() overlays IntegrationGuardSetting (enabled + editable value) on CONTRACT_GUARDS; a stale value that cannot form a usable set for an “in” guard falls back to the catalogue default so a guard never silently blocks the flow.');

// ===== 10 ADAPTER =====
H1('10 · Provider adapter layer');
P('The canonical model is provider-neutral; each TMC has its own mapping to/from the wire format in the adapter layer, the ONLY layer that changes when the TMC changes. In the prototype the outbound build is shared (the canonical payload) and providers differ by their booking-reference prefix. The adapter keys and provider names below, and the provider values in the payload examples (e.g. "tmc": "ctc"), are fictitious seed data used only to demonstrate multi-TMC routing in the prototype. They do not indicate any shortlisted or preferred TMC.');
TBL(T(['Adapter key', 'PNR prefix', 'Notes'], [3000, 3000, 9398], [
  ['fcm', 'FCM', 'Default adapter (adapterFor falls back to fcm).'],
  ['ctc', 'CTC', 'CTC Travel (Asia-Pacific).'],
  ['crisis24', 'C24', 'Crisis24.'],
], { boldFirst: false }));
P('The handoff/receive actions pick the adapter by the resolved provider’s adapterKey (TravelRequest.tmcProviderId / TravelBooking.tmcProviderId). In production, a provider adapter maps the canonical outbound to the provider’s API and the provider’s response back to CanonicalInbound; the workflow, canonical model and TE linkage stay unchanged.');

// ===== 11 CHANGE LOG =====
H1('11 · Change log (1.2 to 1.3)');
P('This section lists what changed from contract version ecs-pretrip-contract/1.2 to 1.3. The overall shape is backward compatible: the new fields are additive and each is gated by its own contract toggle (default on).');
TBL(T(['Area', 'Change'], [4200, 11198], [
  ['Cost ceiling', 'Added the toggleable field costCeilingBreakdown: per-category ceilings (approvedAirfareCeilingSgd, approvedAccommodationCeilingSgd) and a payment-channel split (ceilingByBillTo: ctaSgd, travellerSgd). approvedCostCeilingSgd is unchanged.'],
  ['Segments', 'AIR segments now carry approvedAmountSgd (airfare apportioned across legs by leg duration); HOTEL segments now carry approvedTotalSgd (the approved funded total for the stay). Both reconcile to their category ceiling.'],
  ['Classification', 'Added the toggleable field tripType (ROUND_TRIP, ONE_WAY, MULTI_CITY), sourced from TravelRequest.tripType.'],
  ['Group fan-out', 'The GroupFanoutOutbound envelope now carries groupType (STAFF, STUDENT, MIXED). Each traveller instruction carries its own costCeilingBreakdown and approvedCostCeilingSgd. bookingFor is set per traveller (EMPLOYEE, STUDENT, GUEST).'],
  ['Booking deviation', 'The inbound deviation check now runs at category and segment / PNR level (match each booked PNR to the approved legs it fulfils), not only against the combined total.'],
  ['CTA posting', 'Confirmed: the Pre-Trip module posts CTA charges to SAP on receipt (ctaPostingTiming = ON_RECEIPT). ECS does not post CTA charges; the claim carries them for reference only. The AT_CLAIM option is retired.'],
  ['TE sync', 'No change to treatments. CTA amounts remain Reference in the claim; traveller-paid hotel remains Editable.'],
  ['Approval snapshot (B2)', 'The approved breakdown and itinerary are now frozen at final approval (TravelRequest.approvedBreakdownJson). The outbound instruction and the booking-deviation check read this snapshot rather than recomputing from the live request. The approved request cannot change: at booking only the dates and the actual fare flex; a route that cannot be fulfilled as approved is returned not booked and needs a fresh TR/TA.'],
  ['Deviation scope', 'A BookingDeviation now records level (TOTAL / CATEGORY / SEGMENT), scopeRef (AIRFARE, ACCOMMODATION, DATES, AIR:SIN-HND, CLASS:SIN-HND, ROUTE:SIN-HND) and pnr. A segment-only airfare breach is LogOnly (non-material); it becomes material (ReviewAtClaim) only when the airfare category is also over threshold.'],
  ['Per-leg apportionment', 'Documented as a prototype assumption (§4.2, §5) for the vendor to confirm: approvedAmountSgd per AIR leg is a duration-weighted split for governance only, and the airfare category ceiling is the primary control.'],
  ['Post-approval model', 'NTU Finance confirmed: the TR is locked after approval, with no in-system re-approval. The approved amount is a REFERENCE, not a booking limit, so bookings are never blocked (costCeiling / costCeilingBreakdown / per-segment amounts are reference amounts). A material booked-vs-approved deviation is reviewed at CLAIM approval (§5A).'],
  ['Deviation actions', 'The booking-deviation action is now ReviewAtClaim for a material deviation and LogOnly for a non-material one (the former in-system re-approval action is retired). The approval snapshot is final after approval; the "material amendment re-approves and re-snapshots" wording applies only before approval.'],
  ['Date-shift limit', 'Added ModuleSettings.maxDateShiftDaysBefore / maxDateShiftDaysAfter and the toggleable outbound field allowedDateShift { daysBefore, daysAfter }. A booked date outside approved ± the limit, or outside the approval validity, is a material DATES deviation (level CATEGORY).'],
  ['Amount threshold', 'Added ModuleSettings.deviationThresholdPct / deviationThresholdAbsSgd. A category amount is material only when the booked amount exceeds the approved reference by more than BOTH the % and the SGD threshold. Distinct gate from teAutoGrantTolerance* (claim DOA auto-grant); defaults aligned (10% / SGD 500).'],
  ['Class & route checks', 'A booked cabin above the approved class without a matching approved exception is a material deviation (scopeRef CLASS:<route>); a booked route not in the approved itinerary is a material deviation (scopeRef ROUTE:<route>). The class check was restored after the earlier rewording dropped it.'],
  ['Recall', 'An approved TR may be recalled (reverted to an editable Draft) until a segment is ticketed. ECS emits a TMC_RECALL withdraw, clears the approval snapshot, and re-issues on the same TA at re-approval. Replaces in-system post-approval amendment (§5A rule 8, §7).'],
  ['Offline-approval evidence', 'Added the claim-submission evidence gate (§8.3). ModuleSettings.evidenceRequiredFor lists the deviation types that need offline-approval evidence; a material deviation of a listed type sets BookingDeviation.requiresEvidence. A new te.evidence guard (TE_SUBMIT flow) blocks submitClaim until each such deviation has a linked OFFLINE_APPROVAL_EVIDENCE attachment or an approved waiver (waivedBy / waivedAt / waiverReason, mandatory reason). Self-booked trips are exempt.'],
]));

// ===== BUILD =====
const doc = new Document({
  styles: { default: {
    document: { run: { font: 'Calibri', size: 19, color: '222222' } },
    title: { run: { font: 'Calibri', size: 56, bold: true, color: NAVY }, paragraph: { spacing: { before: 0, after: 120 } } },
    heading1: { run: { font: 'Calibri', size: 28, bold: true, color: NAVY }, paragraph: { spacing: { before: 240, after: 120 }, keepNext: true } },
    heading2: { run: { font: 'Calibri', size: 21, bold: true, color: RED }, paragraph: { spacing: { before: 220, after: 60 }, keepNext: true } },
  } },
  sections: [{
    properties: { page: { size: { orientation: PageOrientation.LANDSCAPE, width: 11906, height: 16838 }, margin: { top: 720, bottom: 720, left: 720, right: 720 } } },
    children: out,
  }],
});
Packer.toBuffer(doc).then((buf) => { const p = process.argv[2] || 'NTU-Travel-Request-Integration-Contract.docx'; fs.writeFileSync(p, buf); console.log('wrote', p, (buf.length / 1024).toFixed(0) + ' KB'); });
