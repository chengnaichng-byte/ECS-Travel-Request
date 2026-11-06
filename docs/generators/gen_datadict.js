// NTU Travel Request: Data Dictionary (.docx) generator. Source of truth: prisma/schema.prisma (33 models).
const fs = require('fs');
const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell,
  WidthType, BorderStyle, ShadingType, AlignmentType, PageOrientation, TableLayoutType, ImageRun,
} = require('docx');

const NAVY = '1B1C62', RED = 'D71440', MUTE = '6b6f82', HEAD = 'EDEFF7', ZEBRA = 'F7F8FC';
const COLS = [2500, 1700, 1250, 760, 2250, 6938]; // sum 15398 (A4 landscape usable @ .5" margins)
const COLH = ['Field', 'Type', 'Key', 'Null', 'Default', 'Description'];

const cell = (text, { w, bold, color, shade, align, size } = {}) => new TableCell({
  width: { size: w, type: WidthType.DXA },
  shading: shade ? { type: ShadingType.CLEAR, color: 'FFFFFF', fill: shade } : undefined,
  margins: { top: 40, bottom: 40, left: 90, right: 90 },
  children: [new Paragraph({
    alignment: align,
    children: (Array.isArray(text) ? text : [text]).map((t) =>
      new TextRun({ text: String(t), bold: !!bold, color: color || '222222', size: size || 15, font: 'Calibri' })),
  })],
});

function fieldTable(fields) {
  const header = new TableRow({
    tableHeader: true,
    children: COLH.map((h, i) => cell(h, { w: COLS[i], bold: true, color: NAVY, shade: HEAD, size: 15 })),
  });
  const rows = fields.map((f, idx) => {
    const [name, type, key, nul, def, desc] = f;
    const shade = idx % 2 ? ZEBRA : undefined;
    return new TableRow({
      children: [
        cell(name, { w: COLS[0], bold: true, color: '2a2d40', shade }),
        cell(type, { w: COLS[1], color: '335566', shade }),
        cell(key || '', { w: COLS[2], bold: !!key, color: key ? RED : '222222', shade, align: AlignmentType.CENTER }),
        cell(nul, { w: COLS[3], shade, align: AlignmentType.CENTER }),
        cell(def || '', { w: COLS[4], color: '555555', shade }),
        cell(desc, { w: COLS[5], shade }),
      ],
    });
  });
  return new Table({
    columnWidths: COLS,
    width: { size: COLS.reduce((a, b) => a + b, 0), type: WidthType.DXA },
    layout: TableLayoutType.FIXED,
    rows: [header, ...rows],
  });
}

// ---- content helpers ----
const out = [];
const H1 = (t) => out.push(new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun({ text: t })] }));
const H2 = (t, sub) => {
  out.push(new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 260, after: 40 }, children: [new TextRun({ text: t })] }));
  if (sub) out.push(new Paragraph({ spacing: { after: 90 }, children: [new TextRun({ text: sub, italics: true, color: MUTE, size: 17 })] }));
};
const P = (runs, opts = {}) => out.push(new Paragraph({ spacing: { after: 90, ...(opts.spacing || {}) }, children: (Array.isArray(runs) ? runs : [new TextRun({ text: runs, size: 19, color: '333333' })]) }));
const BUL = (t) => out.push(new Paragraph({ bullet: { level: 0 }, spacing: { after: 20 }, children: [new TextRun({ text: t, size: 18, color: '333333' })] }));
function model(name, desc, fields, notes) {
  H2(name, desc);
  out.push(fieldTable(fields));
  if (notes) notes.forEach((n) => out.push(new Paragraph({ spacing: { before: 60, after: 40 }, children: [new TextRun({ text: 'Note: ', bold: true, size: 16, color: NAVY }), new TextRun({ text: n, size: 16, color: '444444' })] })));
  out.push(new Paragraph({ spacing: { after: 120 }, children: [] }));
}

// ===== COVER =====
out.push(new Paragraph({ spacing: { before: 1800, after: 0 }, children: [new TextRun({ text: 'NTU Travel & Expense Claim System', bold: true, color: RED, size: 26 })] }));
out.push(new Paragraph({ spacing: { before: 120, after: 0 }, children: [new TextRun({ text: 'Travel Request: Data Dictionary', bold: true, color: NAVY, size: 60 })] }));
out.push(new Paragraph({ spacing: { before: 160, after: 0 }, children: [new TextRun({ text: 'Prototype reference: business objects, datapoints, keys and relationships. Not the target physical design.', color: '4a4e63', size: 24 })] }));
out.push(new Paragraph({ spacing: { before: 500 }, border: { top: { style: BorderStyle.SINGLE, size: 12, color: 'eceaf3' } }, children: [new TextRun({ text: `Generated from the prototype schema · 33 models · 6 November 2026`, color: MUTE, size: 18 })] }));
const boxP = (t, b) => new Paragraph({ spacing: { after: 60 }, shading: { type: ShadingType.CLEAR, color: 'auto', fill: 'FBF8EF' }, border: { left: { style: BorderStyle.SINGLE, size: 18, color: 'C8A24A' } }, indent: { left: 140 }, children: [new TextRun({ text: t, bold: !!b, size: b ? 19 : 16, color: b ? '7A5A00' : '444444' })] });
out.push(boxP('Note to readers: prototype reference only', true));
out.push(boxP('This document describes the data model of the Pre-Trip Travel Request prototype. It is shared as a reference for the business objects, datapoints and rules the module must support. It is not the target physical design.', false));
out.push(boxP('The prototype runs on SQLite with simulated (mock) ECS services. Fields marked "ref" and the claim-side objects (TravelExpenseClaim, ClaimApprovalStep, TEExpenseLine) stand in for ECS data and must be validated against the actual ECS data model. Many objects are expected to reuse or extend existing ECS entities rather than be created as new tables.', false));
out.push(boxP('The model has not been reviewed for performance, security, audit, data retention or integration robustness. The vendor is responsible for the final physical data design, including a mapping of each object to reuse an existing ECS entity, extend an existing ECS entity, or create a new entity, with rationale.', false));
out.push(boxP('References such as §13.8 or DD-31 point to sections and design decisions in the Pre-Trip prototype build pack, shared alongside this document.', false));
out.push(new Paragraph({ pageBreakBefore: true, children: [] }));

// ===== CONVENTIONS =====
H1('1 · How to read this document');
P('This data dictionary is generated from the Prisma schema that defines the transactional database (SQLite). Each object below is a database table (a Prisma model); each datapoint is a column. The reference / master data (expense types, hotel caps, ODA rates, workflow bands, FX rates, roles, employees) is NOT in this database. Per the build pack, it lives as read-only seed in src/data, consumed by the mock ECS services. Fields that hold such a value are marked “ref”.');
P([new TextRun({ text: 'Key column legend', bold: true, size: 20, color: NAVY })], { spacing: { before: 120, after: 40 } });
BUL('PK, primary key. All PKs are strings; unless noted they are generated cuid() surrogate keys.');
BUL('U, unique constraint (a natural/business key or a 1:1 link).');
BUL('FK, foreign key enforced by a Prisma relation (with the delete rule shown in the object note).');
BUL('FK*, logical foreign key: the column references another table by id but is NOT an enforced relation in the schema.');
BUL('ref, logical reference to a reference master in src/data (e.g. an employee id, expense-type id, charging code), not a row in this database.');
P([new TextRun({ text: 'Type & value conventions', bold: true, size: 20, color: NAVY })], { spacing: { before: 120, after: 40 } });
BUL('SQLite does not support Prisma enums, so status / type / mode fields are stored as Text (String) whose allowed values are listed in the field description (and centrally in src/shared/enums.ts).');
BUL('Text = String, Integer = Int, Decimal = Float, Boolean = Boolean, DateTime = timestamp, Binary = Bytes. A “Null = Y” field is optional (Prisma “?”).');
BUL('Money is SGD unless a currency column accompanies it; “…Sgd” columns are already converted to SGD.');
out.push(new Paragraph({ pageBreakBefore: true, children: [] }));

H1('2 · Objects');

// ===== MODELS =====
model('ModuleSettings',
  'Single-row module configuration (id is fixed to "SETTINGS"). Runtime-togglable switches and parameters that govern the whole module.',
  [
    ['id', 'Text', 'PK', 'N', '"SETTINGS"', 'Fixed single-row key; always "SETTINGS".'],
    ['sameRouteResearch', 'Boolean', '', 'N', 'false', 'Allow the same route for research and non-research travel (§3.4).'],
    ['expenseScope', 'Text', '', 'N', '"ALL"', 'Which cost items are estimated: MAJOR_ONLY | ALL.'],
    ['hotelEstimateBasis', 'Text', '', 'N', '"LOWER"', 'Basis for the hotel estimate: QUOTED | CAP | LOWER (lower of quote/cap).'],
    ['airfareTreatment', 'Text', '', 'N', '"IN_TE"', 'How airfare is treated downstream: DIRECT_SAP | IN_TE | REFERENCE.'],
    ['teLinkageMandatory', 'Text', '', 'N', '"CONDITIONAL"', 'Whether a TE claim must link to a pre-trip: YES | NO | CONDITIONAL.'],
    ['approvalAmountBasis', 'Text', '', 'N', '"NET_NTU"', 'Amount the approval routing is sized on: GROSS | NET_NTU | MAJOR_COST | ALLOCATION.'],
    ['groupTravelEnabled', 'Boolean', '', 'N', 'true', 'Master switch for group travel requests (§13.14).'],
    ['studentGroupEnabled', 'Boolean', '', 'N', 'true', 'Allow a STUDENT group (uploaded, non-validated student members).'],
    ['mixedGroupEnabled', 'Boolean', '', 'N', 'true', 'Allow ONE group to mix staff + students (+ guests); off = homogeneous groups.'],
    ['groupMaxTravellers', 'Integer', '', 'N', '10', 'Maximum travellers in one group booking (TMC group limit).'],
    ['groupGuestMixAllowed', 'Boolean', '', 'N', 'true', 'May a group booking mix employees and guests (§8).'],
    ['groupSubItineraries', 'Boolean', '', 'N', 'false', 'Allow per-traveller sub-itineraries (deviations) in a group (§13.20).'],
    ['purposeDrivenItems', 'Boolean', '', 'N', 'true', 'Travel purpose auto-populates its full cost-item set for staff (§4.4).'],
    ['exceptionApproverRequired', 'Boolean', '', 'N', 'true', 'Insert an Exception Approver step for policy exceptions (§26).'],
    ['roRequirement', 'Text', '', 'N', '"INDIVIDUAL_ONLY"', 'RO decision point: ALWAYS | INDIVIDUAL_ONLY | NEVER (§51).'],
    ['teAutoGrantTolerancePct', 'Integer', '', 'N', '10', 'TE-claim DOA auto-grant tolerance, % over the approved estimate (§51).'],
    ['teAutoGrantToleranceAbsSgd', 'Integer', '', 'N', '500', 'TE-claim DOA auto-grant tolerance, SGD over the approved estimate (§51).'],
    ['crossBaThresholdSgd', 'Integer', '', 'N', '500', 'DEPRECATED, retained column, no longer used.'],
    ['selfBookingEnabled', 'Boolean', '', 'N', 'true', 'Allow travellers to self-book (§13.17).'],
    ['selfApprovalLimitSgd', 'Integer', '', 'N', '0', 'Amount at/below which a traveller-approver self-approves (0 = never).'],
    ['researchPiSelfApproval', 'Boolean', '', 'N', 'true', 'A research-WBS trip for a PI traveller within the self-approval limit is self-approved.'],
    ['guestUpgradeProvostId', 'Text', 'ref', 'N', '"E-PROVOST"', 'Who the Provost is for a guest travel-class upgrade (approver id).'],
    ['guestUpgradeDeanStep', 'Boolean', '', 'N', 'false', 'Insert a Dean recommendation step before the Provost on a guest upgrade (§8/DD-25).'],
    ['nonTermAutoApprove', 'Boolean', '', 'N', 'false', 'Research-WBS trip in non-term time (attested + email) auto-approves.'],
    ['upgradeDeltaRoutingEnabled', 'Boolean', '', 'N', 'true', 'Route the NTU-funded upgrade differential to a separate M6 account (#14).'],
    ['upgradeDeltaSelectionRequired', 'Boolean', '', 'N', 'false', 'Force the M6-account pick when a BA has more than one (#14).'],
    ['attachmentMaxMb', 'Integer', '', 'N', '7', 'Maximum upload size per file (MB).'],
    ['chargingSplitMode', 'Text', '', 'N', '"PERCENT"', 'Charging entry mode: PERCENT | AMOUNT (§17).'],
    ['declarationText', 'Text', '', 'N', '(default text)', 'The traveller declaration shown on Review & Submit.'],
    ['coiText', 'Text', '', 'N', '(default text)', 'The conflict-of-interest declaration text.'],
    ['sftpConfig', 'Text', '', 'N', '(display)', 'TMC transport config string (display only).'],
    ['visaLetterHrOfficer', 'Text', '', 'N', '(default)', 'HR officer/team that receives the visa-letter notification (§4.13).'],
    ['visaLetterHrEmail', 'Text', '', 'N', '(default)', 'That HR officer’s email address.'],
    ['visaLetterBatchLastRunAt', 'DateTime', '', 'Y', '-', 'Last run of the daily visa-letter timer job (gates the once-per-day run).'],
    ['authorisationValidityDays', 'Integer', '', 'N', '30', 'Travel-authorisation validity window in days (§13.3).'],
    ['bookingDeadlineDays', 'Integer', '', 'N', '14', 'Days before departure by which booking must occur (§13.3).'],
    ['emergencyLeadDays', 'Integer', '', 'N', '14', 'Lead-time window that auto-triggers the emergency lane (DD-23).'],
    ['emergencyEvidenceRequired', 'Boolean', '', 'N', 'true', 'Mode A (true): capture authorising officer + email on auto-emergency; Mode B (false): none.'],
    ['ctaPostingTiming', 'Text', '', 'N', '"ON_RECEIPT"', 'Fixed to ON_RECEIPT (v1.3). CTA charges post from the Pre-Trip module when booked to the CTA; the AT_CLAIM option is retired (ECS does not post CTA charges, and the claim carries them for reference only). Retained column; not admin-editable (DD-31).'],
    ['updatedAt', 'DateTime', '', 'N', 'auto', 'Auto-updated on every change.'],
  ]);

model('IntegrationFieldSetting',
  'Admin-editable per-field decision on what is sent to the TMC and how it is treated when synced to the expense claim. Overlays the CONTRACT_FIELDS defaults.',
  [
    ['key', 'Text', 'PK', 'N', '-', 'Matches a ContractField.key (natural key, not surrogate).'],
    ['includeTmc', 'Boolean', '', 'N', 'false', 'Is this field sent in the TMC booking instruction?'],
    ['teTreatment', 'Text', '', 'N', '"EXCLUDED"', 'How the field is treated in the TE claim: LOCKED | EDITABLE | REFERENCE | EXCLUDED.'],
    ['updatedAt', 'DateTime', '', 'N', 'auto', 'Auto-updated on every change.'],
  ]);

model('IntegrationGuardSetting',
  'Admin-editable parameter filter deciding when an outbound booking instruction is sent / an inbound TMC response is accepted. Overlays the CONTRACT_GUARDS defaults.',
  [
    ['key', 'Text', 'PK', 'N', '-', 'Matches a ContractGuard.key.'],
    ['enabled', 'Boolean', '', 'N', 'true', 'Is the filter active?'],
    ['value', 'Text', '', 'N', '""', 'Overridden value for editable guards.'],
    ['updatedAt', 'DateTime', '', 'N', 'auto', 'Auto-updated on every change.'],
  ]);

model('TravelRequest',
  'The pre-trip Travel Request, header and lifecycle record. The central transactional object; most other objects hang off it.',
  [
    ['id', 'Text', 'PK', 'N', 'cuid()', 'Surrogate key.'],
    ['requestNumber', 'Text', 'U', 'N', '-', 'Business key, format TR-YYYY-NNNNNN.'],
    ['authorisationNo', 'Text', 'U', 'Y', '-', 'Travel-authorisation number TA-YYYY-NNNNNN, set on final approval.'],
    ['status', 'Text', '', 'N', '"Draft"', 'Approval state machine (Draft, Pending RO/DOA/…, Approved, Rejected, …). Values in enums.ts.'],
    ['bookingStatus', 'Text', '', 'N', '"Not Sent"', 'Booking lifecycle status (Not Sent, Sent to TMC, Booked, …).'],
    ['isGroup', 'Boolean', '', 'N', 'false', 'True when several travellers share one request / TA.'],
    ['groupType', 'Text', '', 'Y', '-', 'STAFF | STUDENT | MIXED; null = individual / guest.'],
    ['requestorId', 'Text', 'ref', 'N', '-', 'Creator (may differ from the traveller). Employee master id.'],
    ['travellerId', 'Text', 'ref', 'N', '-', 'Primary traveller; literal "GUEST" for a non-employee.'],
    ['travellerType', 'Text', '', 'N', '"EMPLOYEE"', 'EMPLOYEE | GUEST (non-employee, no ECS profile).'],
    ['guestName', 'Text', '', 'Y', '-', 'Guest identity capture (no HR record).'],
    ['guestEmail', 'Text', '', 'Y', '-', 'Guest email.'],
    ['guestOrg', 'Text', '', 'Y', '-', 'Guest’s home organisation / affiliation.'],
    ['additionalApproverId', 'Text', 'ref', 'Y', '-', 'Optional traveller-selected Additional Approver (§23).'],
    ['selectedDoaId', 'Text', 'ref', 'Y', '-', 'Traveller-selected DOA from the eligible candidates (§13.14).'],
    ['provostId', 'Text', 'ref', 'Y', '-', 'Selected Provost for a guest travel-class upgrade (§8/DD-25).'],
    ['selectedDeanId', 'Text', 'ref', 'Y', '-', 'Requestor-selected Dean who recommends a guest upgrade before the Provost.'],
    ['isEmergency', 'Boolean', '', 'N', 'false', 'Emergency lane: compressed route + book-first.'],
    ['isRetrospective', 'Boolean', '', 'N', 'false', 'Raised after the trip was booked / taken.'],
    ['emergencyJustification', 'Text', '', 'Y', '-', 'Why the emergency lane was used.'],
    ['emergencyAuthoriserId', 'Text', 'ref', 'Y', '-', 'Officer who authorised the emergency (recorded).'],
    ['emergencyRatified', 'Boolean', '', 'N', 'false', 'The DOA ratified the emergency after the fact.'],
    ['emergencyOutsideWindow', 'Boolean', '', 'N', 'false', 'Emergency raised outside the standard lead-time window (DD-23).'],
    ['nonTermDeclared', 'Boolean', '', 'N', 'false', 'Attestation/derivation: non-term research travel with offline approval.'],
    ['entityId', 'Text', 'ref', 'Y', '-', 'Employing entity id.'],
    ['departmentId', 'Text', 'ref', 'Y', '-', 'Department id (host dept for a guest).'],
    ['isResearch', 'Boolean', '', 'N', 'false', 'Research-funded trip (drives routing and non-term eligibility).'],
    ['dismissedCostItems', 'Text', '', 'Y', '-', 'JSON string[] of expenseTypeIds the traveller deleted from the purpose-seeded set.'],
    ['purposeId', 'Text', 'ref', 'Y', '-', 'Travel purpose id (TP-…).'],
    ['description', 'Text', '', 'Y', '-', 'Business justification / trip description.'],
    ['tripType', 'Text', '', 'N', '"ROUND_TRIP"', 'ROUND_TRIP | ONE_WAY | MULTI_CITY (§4.4).'],
    ['destCountry', 'Text', 'ref', 'Y', '-', 'Main destination country code.'],
    ['destCity', 'Text', 'ref', 'Y', '-', 'Main destination city code (longest-stay).'],
    ['startDate', 'DateTime', '', 'Y', '-', 'Official travel start.'],
    ['endDate', 'DateTime', '', 'Y', '-', 'Official travel end.'],
    ['personalStart', 'DateTime', '', 'Y', '-', 'Personal extension start (§13.18).'],
    ['personalEnd', 'DateTime', '', 'Y', '-', 'Personal extension end.'],
    ['personalAck', 'Boolean', '', 'N', 'false', 'Traveller acknowledges the personal portion is at own cost (§12).'],
    ['highRiskAck', 'Boolean', '', 'N', 'false', 'Traveller acknowledged the high-risk advisory before submission (§4.8).'],
    ['highRiskApproverAck', 'Boolean', '', 'N', 'false', 'An approver acknowledged the high-risk advisory during approval.'],
    ['visaLetterRequired', 'Boolean', '', 'N', 'false', 'Traveller indicated a visa letter is required (§4.13).'],
    ['visaLetterNotifiedAt', 'DateTime', '', 'Y', '-', 'Set when the daily visa-letter batch notified the office.'],
    ['tmcProviderId', 'Text', 'ref', 'Y', '-', 'Preferred TMC provider (null = auto by policy).'],
    ['eventStartDate', 'DateTime', '', 'Y', '-', 'Event/conference start (may differ from travel dates) (§10).'],
    ['eventEndDate', 'DateTime', '', 'Y', '-', 'Event/conference end.'],
    ['invitationRef', 'Text', '', 'Y', '-', 'Invitation / acceptance reference (§10).'],
    ['travelClassId', 'Text', 'ref', 'Y', '-', 'Proposed travel class id.'],
    ['entitledClassId', 'Text', 'ref', 'Y', '-', 'Derived entitlement class (individual) (§13.19).'],
    ['classBasis', 'Text', '', 'Y', '-', 'Text explaining how the class was derived.'],
    ['classJustification', 'Text', '', 'Y', '-', 'Required when the chosen class exceeds entitlement.'],
    ['bookingArrangement', 'Text', '', 'Y', '"AUTO"', 'AUTO | TMC-<id> | SELF_BOOKED | HOST_ARRANGED | NO_BOOKING (§2.2).'],
    ['bookingMethod', 'Text', '', 'Y', '-', 'TMC channel sub-method: TMC_ONLINE | AGENT_ASSISTED | OFFLINE.'],
    ['chargingMode', 'Text', '', 'N', '"REQUEST"', 'REQUEST (whole-request split) | LINE (per cost line) (§17).'],
    ['hotelSettlement', 'Text', '', 'N', '"INDIVIDUAL"', 'Hotel payment channel: INDIVIDUAL | CTA (central-billed) (DD-19).'],
    ['approvalAmountSgd', 'Decimal', '', 'Y', '-', 'Amount-basis result in SGD that routing is sized on (§13.4).'],
    ['bookingDeadline', 'DateTime', '', 'Y', '-', 'Deadline to book.'],
    ['authorisationExpiry', 'DateTime', '', 'Y', '-', 'Expiry of the travel authorisation.'],
    ['approvedBreakdownJson', 'Text', '', 'Y', '-', 'v1.3 / B2 immutable approved-breakdown snapshot (JSON), frozen at final approval. Holds the approved canonical booking instruction(s), one per traveller for a group, with the approved itinerary (routes + dates), per-segment approved amounts (approvedAmountSgd / approvedTotalSgd), the cost-ceiling breakdown (airfare / accommodation + ceilingByBillTo), and the frozen airfare / accommodation category totals. The outbound hand-off and the booking-deviation check read this snapshot; they never recompute from the live request. The approved request cannot change: at booking the traveller may shift dates (the TMC returns the actual dates and fare) but not the route; a route that cannot be fulfilled as approved is returned not booked and needs a fresh TR/TA. A material amendment re-approves and writes a fresh snapshot.'],
    ['currentVersion', 'Integer', '', 'N', '0', 'Latest snapshot version number.'],
    ['createdAt', 'DateTime', '', 'N', 'now()', 'Row creation timestamp.'],
    ['updatedAt', 'DateTime', '', 'N', 'auto', 'Auto-updated on every change.'],
  ],
  ['Children (all 1-to-many unless noted, cascade-delete): TravelRequestTraveller, TravelRequestVersion, ItineraryLeg, EstimatedExpense, ChargingAllocation, PolicyCheck, ApprovalStep, TravelBooking, BookingDeviation, TravelExpenseLink, IntegrationMessage, Attachment. TravelExpenseClaim and AuditEvent reference it with a nullable relation (no cascade).']);

model('CtaPostingDocument',
  'The SAP posting made for a settled CTA (Central Travel Account) charge, on receipt from the TMC (DD-31). One per booking + charge type; idempotent.',
  [
    ['id', 'Text', 'PK', 'N', 'cuid()', 'Surrogate key.'],
    ['bookingId', 'Text', 'FK*', 'N', '-', 'The TravelBooking this posting is for (logical link; see note).'],
    ['requestId', 'Text', 'FK*', 'N', '-', 'The TravelRequest the booking belongs to (logical link).'],
    ['chargeType', 'Text', '', 'N', '-', 'Airfare | Accommodation.'],
    ['sapDocNo', 'Text', 'U', 'N', '-', 'The SAP document number of the posting.'],
    ['postingDate', 'Text', '', 'N', '-', 'YYYY-MM-DD the charge posted to SAP.'],
    ['status', 'Text', '', 'N', '"Posted"', 'Posted | Failed | Reversed.'],
    ['grossSgd', 'Decimal', '', 'N', '-', 'Gross posted amount (SGD).'],
    ['clearingGlAccount', 'Text', '', 'N', '-', 'Credit (clearing) GL account.'],
    ['reversalSapDocNo', 'Text', '', 'Y', '-', 'The reversing SAP document, on auto-reversal.'],
    ['reversedDate', 'Text', '', 'Y', '-', 'Date the entry was reversed (cancellation/refund).'],
    ['retainedSgd', 'Decimal', '', 'N', '0', 'Penalty retained on cancellation (not reversed); refund = gross − retained.'],
    ['createdAt', 'DateTime', '', 'N', 'now()', 'Row creation timestamp.'],
  ],
  ['Composite unique: (bookingId, chargeType), one posting per booking per charge type. bookingId/requestId are plain columns, not enforced relations.']);

model('CtaAccount',
  'Central Travel Account master (CTA → credit-GL clearing). A maintainable reference master seeded idempotently from src/data/ctaAccounts.ts (DD-30).',
  [
    ['id', 'Text', 'PK', 'N', 'cuid()', 'Surrogate key.'],
    ['ctaAccountId', 'Text', 'U', 'N', '-', 'Feed key, the account id the card/TMC reports on each charge.'],
    ['label', 'Text', '', 'N', '-', 'Display label.'],
    ['provider', 'Text', '', 'N', '-', 'Card/travel provider.'],
    ['companyCode', 'Text', '', 'N', '-', 'SAP company code.'],
    ['currency', 'Text', '', 'N', '-', 'Account currency.'],
    ['clearingGlAccount', 'Text', '', 'N', '-', 'Credit (clearing) GL account the posting programme credits.'],
    ['active', 'Boolean', '', 'N', 'true', 'Is the account active?'],
    ['effectiveFrom', 'Text', '', 'N', '-', 'Effective-from date (YYYY-MM-DD).'],
    ['createdAt', 'DateTime', '', 'N', 'now()', 'Row creation timestamp.'],
  ]);

model('TravelRequestTraveller',
  'A traveller on a (group) request, one request, many travellers. Also carries per-traveller class and itinerary overrides.',
  [
    ['id', 'Text', 'PK', 'N', 'cuid()', 'Surrogate key.'],
    ['requestId', 'Text', 'FK', 'N', '-', '→ TravelRequest.id (cascade delete).'],
    ['employeeId', 'Text', 'ref', 'N', '-', 'Employee id, or a synthetic "G-…" (guest) / "S-…" (student) key for a non-employee.'],
    ['lineNo', 'Integer', '', 'Y', '-', 'Stable per-traveller line number within the group (TA/0n). Frozen at submission; lead = 01.'],
    ['travellerType', 'Text', '', 'N', '"EMPLOYEE"', 'EMPLOYEE | GUEST | STUDENT.'],
    ['guestName', 'Text', '', 'Y', '-', 'Guest/student identity (no ECS/HR profile).'],
    ['guestEmail', 'Text', '', 'Y', '-', 'Guest/student email.'],
    ['guestOrg', 'Text', '', 'Y', '-', 'Guest organisation.'],
    ['studentId', 'Text', '', 'Y', '-', 'Student group, matriculation / student number (uploaded, not validated).'],
    ['programme', 'Text', '', 'Y', '-', 'Student group, programme / school.'],
    ['confirmed', 'Boolean', '', 'N', 'false', 'Inclusion confirmation (§13.13).'],
    ['confirmedAt', 'DateTime', '', 'Y', '-', 'When inclusion was confirmed.'],
    ['sharePct', 'Decimal', '', 'N', '100', 'Derived share of NTU-funded cost.'],
    ['isRequestor', 'Boolean', '', 'N', 'false', 'This traveller is also the requestor/coordinator.'],
    ['entitledClassId', 'Text', 'ref', 'Y', '-', 'Per-traveller entitlement class (§13.19).'],
    ['chosenClassId', 'Text', 'ref', 'Y', '-', 'Per-traveller chosen class.'],
    ['classBasis', 'Text', '', 'Y', '-', 'Derivation basis text.'],
    ['classJustification', 'Text', '', 'Y', '-', 'Required when chosen > entitled.'],
    ['ownStartDate', 'DateTime', '', 'Y', '-', 'Per-traveller itinerary override, own start (§13.20).'],
    ['ownEndDate', 'DateTime', '', 'Y', '-', 'Per-traveller itinerary override, own end.'],
    ['legOverrideNote', 'Text', '', 'Y', '-', 'Note describing the itinerary deviation.'],
  ]);

model('TravelRequestVersion',
  'Immutable submitted/approved snapshots of the request and its lines (for audit and re-approval diffs).',
  [
    ['id', 'Text', 'PK', 'N', 'cuid()', 'Surrogate key.'],
    ['requestId', 'Text', 'FK', 'N', '-', '→ TravelRequest.id (cascade delete).'],
    ['version', 'Integer', '', 'N', '-', 'Monotonic version number.'],
    ['reason', 'Text', '', 'N', '-', 'SUBMISSION | REAPPROVAL.'],
    ['approved', 'Boolean', '', 'N', 'false', 'Whether this snapshot represents an approved state.'],
    ['snapshot', 'Text', '', 'N', '-', 'JSON snapshot of the request + lines.'],
    ['createdAt', 'DateTime', '', 'N', 'now()', 'Row creation timestamp.'],
  ]);

model('ItineraryLeg',
  'An ordered leg of the itinerary. travellerId distinguishes a shared group leg from a traveller’s own sub-itinerary.',
  [
    ['id', 'Text', 'PK', 'N', 'cuid()', 'Surrogate key.'],
    ['requestId', 'Text', 'FK', 'N', '-', '→ TravelRequest.id (cascade delete).'],
    ['travellerId', 'Text', 'ref', 'Y', '-', 'null = shared group leg; set = that traveller’s own sub-itinerary (§13.20).'],
    ['seq', 'Integer', '', 'N', '-', 'Leg order within the itinerary.'],
    ['originCode', 'Text', 'ref', 'N', '-', 'Origin IATA airport code (ECS Location master).'],
    ['destCode', 'Text', 'ref', 'N', '-', 'Destination IATA airport code.'],
    ['departDate', 'DateTime', '', 'Y', '-', 'Departure date.'],
    ['arriveDate', 'DateTime', '', 'Y', '-', 'Arrival date.'],
    ['transportMode', 'Text', '', 'N', '"AIR"', 'AIR | RAIL | OTHER (§13.20).'],
    ['durationHours', 'Decimal', '', 'Y', '-', 'Estimated flight/travel duration (drives class entitlement).'],
    ['departTime', 'Text', '', 'Y', '-', 'Indicative departure time HH:MM (§11).'],
    ['bookingRequired', 'Boolean', '', 'N', 'true', 'Does this leg need a TMC booking? (§11).'],
    ['isPersonal', 'Boolean', '', 'N', 'false', 'Personal-extension leg (excluded from ODA).'],
    ['nights', 'Integer', '', 'N', '0', 'Nights of stay at the destination (auto-computed).'],
    ['travelClassId', 'Text', 'ref', 'Y', '-', 'Travel class for the leg.'],
    ['entitledClassId', 'Text', 'ref', 'Y', '-', 'Per-leg entitlement, duration-conditioned (§13.19).'],
    ['chosenClassId', 'Text', 'ref', 'Y', '-', 'Per-leg chosen class.'],
  ]);

model('EstimatedExpense',
  'A single estimated cost line, aligned to the TE expense types. Has optional 1:1 children for accommodation and ODA detail.',
  [
    ['id', 'Text', 'PK', 'N', 'cuid()', 'Surrogate key.'],
    ['requestId', 'Text', 'FK', 'N', '-', '→ TravelRequest.id (cascade delete).'],
    ['travellerId', 'Text', 'ref', 'Y', '-', 'Attributed traveller (group); null = requestor/shared owner.'],
    ['category', 'Text', '', 'N', '-', 'AIRFARE | ACCOMMODATION | ODA | CONFERENCE | OTHER.'],
    ['expenseTypeId', 'Text', 'ref', 'N', '-', 'Shared ECS expense-type id (ET-…).'],
    ['currency', 'Text', '', 'N', '"SGD"', 'Line currency.'],
    ['foreignAmount', 'Decimal', '', 'N', '0', 'Amount in the line currency.'],
    ['sgdAmount', 'Decimal', '', 'N', '0', 'Amount converted to SGD.'],
    ['sponsorForeign', 'Decimal', '', 'N', '0', 'Sponsored portion in line currency.'],
    ['sponsorSgd', 'Decimal', '', 'N', '0', 'Sponsored portion in SGD (reduces NTU-funded).'],
    ['estimateBasis', 'Text', '', 'Y', '-', 'QUOTED | CAP | LOWER | RATE.'],
    ['expectedDate', 'DateTime', '', 'Y', '-', 'Expected date of the expense.'],
    ['autoDerived', 'Boolean', '', 'N', 'false', 'Policy-seeded line (ODA / per-stop hotel), re-derived on change.'],
    ['isPlaceholder', 'Boolean', '', 'N', 'false', 'Purpose-seeded declarable line; amount is a default/prompt until edited (§4.4).'],
    ['isShared', 'Boolean', '', 'N', 'false', 'Shared apportioned line (§13.14).'],
    ['shareMap', 'Text', '', 'Y', '-', 'JSON {employeeId: pct} apportionment.'],
    ['chargingCode', 'Text', 'ref', 'Y', '-', 'Per-line charging account (LINE mode); null = follows request split.'],
    ['allocJson', 'Text', '', 'Y', '-', 'Per-line multi-account split JSON [{code,pct,io}] summing to 100.'],
    ['notes', 'Text', '', 'Y', '-', 'Free-text note on the line.'],
    ['originCode', 'Text', 'ref', 'Y', '-', 'Airfare: origin airport.'],
    ['destCode', 'Text', 'ref', 'Y', '-', 'Airfare: destination airport.'],
    ['proposedClassId', 'Text', 'ref', 'Y', '-', 'Airfare: proposed travel class.'],
    ['fareCeiling', 'Decimal', '', 'Y', '-', 'Airfare: fare ceiling.'],
    ['handoffStatus', 'Text', '', 'Y', '-', 'Airfare: TMC hand-off status.'],
    ['entitlementFareSgd', 'Decimal', '', 'Y', '-', 'Derived entitlement-class fare; delta = sgdAmount − this (#7/#14).'],
    ['upgradeFunding', 'Text', '', 'Y', '-', 'NTU (delta → M6 account) | SELF (traveller pays the TMC).'],
    ['upgradeDeltaCode', 'Text', 'ref', 'Y', '-', 'Selected M6 (upgrade-differential) account for an NTU-funded delta (#14).'],
  ],
  ['1:1 children (cascade): AccommodationEstimate, ODAEstimate.']);

model('AccommodationEstimate',
  'Hotel estimate and cap result for an accommodation expense line (§4.5). 1:1 with EstimatedExpense.',
  [
    ['id', 'Text', 'PK', 'N', 'cuid()', 'Surrogate key.'],
    ['expenseId', 'Text', 'FK·U', 'N', '-', '→ EstimatedExpense.id (unique → 1:1; cascade delete).'],
    ['city', 'Text', 'ref', 'N', '-', 'City code the hotel is in.'],
    ['legSeq', 'Integer', '', 'Y', '-', 'Itinerary leg this auto per-stop line maps to (null = manual).'],
    ['checkIn', 'DateTime', '', 'Y', '-', 'Check-in date.'],
    ['checkOut', 'DateTime', '', 'Y', '-', 'Check-out date.'],
    ['nights', 'Integer', '', 'N', '0', 'Total nights.'],
    ['personalNights', 'Integer', '', 'N', '0', 'Personal nights (excluded from the funded budget).'],
    ['quotedNightly', 'Decimal', '', 'N', '0', 'Quoted nightly rate.'],
    ['capNightly', 'Decimal', '', 'N', '0', 'Policy cap nightly rate (§13.7).'],
    ['budgetedNightly', 'Decimal', '', 'N', '0', 'Budgeted nightly per the hotelEstimateBasis.'],
    ['capVariance', 'Decimal', '', 'N', '0', 'Quoted − cap variance.'],
    ['conferenceHotel', 'Boolean', '', 'N', 'false', 'Designated conference hotel (above-cap is self-justifying).'],
    ['exceptionOutcome', 'Text', '', 'Y', '-', 'PASS | EXCEPTION.'],
  ]);

model('ODAEstimate',
  'Indicative Overseas Daily Allowance by destination and dates (§4.5). 1:1 with EstimatedExpense.',
  [
    ['id', 'Text', 'PK', 'N', 'cuid()', 'Surrogate key.'],
    ['expenseId', 'Text', 'FK·U', 'N', '-', '→ EstimatedExpense.id (unique → 1:1; cascade delete).'],
    ['country', 'Text', 'ref', 'N', '-', 'Country code for the ODA rate.'],
    ['city', 'Text', 'ref', 'Y', '-', 'City code (optional).'],
    ['legSeq', 'Integer', '', 'Y', '-', 'Itinerary leg this auto per-city line maps to (null = manual).'],
    ['arrive', 'DateTime', '', 'Y', '-', 'Arrival date in country.'],
    ['depart', 'DateTime', '', 'Y', '-', 'Departure date from country.'],
    ['eligibleDays', 'Integer', '', 'N', '0', 'Eligible ODA days (personal excluded).'],
    ['personalDays', 'Integer', '', 'N', '0', 'Personal days (not eligible).'],
    ['dailyRate', 'Decimal', '', 'N', '0', 'Daily rate from the ECS ODA rate table.'],
    ['ratePct', 'Decimal', '', 'N', '100', 'Travel-period percentage applied to the rate.'],
  ]);

model('ChargingAllocation',
  'A funding-split line. The allocations for a request must total 100% (AC06).',
  [
    ['id', 'Text', 'PK', 'N', 'cuid()', 'Surrogate key.'],
    ['requestId', 'Text', 'FK', 'N', '-', '→ TravelRequest.id (cascade delete).'],
    ['companyCode', 'Text', 'ref', 'Y', '-', 'SAP company code.'],
    ['businessArea', 'Text', 'ref', 'Y', '-', 'Business area.'],
    ['chargingType', 'Text', '', 'N', '-', 'CC | WBS.'],
    ['chargingCode', 'Text', 'ref', 'N', '-', 'CC/WBS id (shared ECS master).'],
    ['isResearch', 'Boolean', '', 'N', 'false', 'This account is a research WBS (drives the research route).'],
    ['percent', 'Decimal', '', 'N', '0', 'Share percent of the NTU-funded amount.'],
    ['amountSgd', 'Decimal', '', 'Y', '-', 'Amount-split entry (converted to percent at save) (§17).'],
    ['internalOrder', 'Text', '', 'Y', '-', 'SAP Internal Order (optional) on this line.'],
    ['isMain', 'Boolean', '', 'N', 'false', 'The main charging account (ECS “main charging account flag”).'],
  ]);

model('UpgradeDeltaAccount',
  'Runtime-editable master of the M6 (upgrade-differential) accounts, grouped by Business Area. The NTU-funded upgrade differential posts to one of these (#14).',
  [
    ['id', 'Text', 'PK', 'N', 'cuid()', 'Surrogate key.'],
    ['code', 'Text', 'U', 'N', '-', 'Account code.'],
    ['name', 'Text', '', 'N', '-', 'Account name.'],
    ['companyCode', 'Text', '', 'N', '"1000"', 'SAP company code.'],
    ['businessArea', 'Text', '', 'N', '-', 'Business area the account serves.'],
    ['active', 'Boolean', '', 'N', 'true', 'Is the account active?'],
    ['isDefault', 'Boolean', '', 'N', 'false', 'Default pick for its BA (used when auto-selecting).'],
    ['createdAt', 'DateTime', '', 'N', 'now()', 'Row creation timestamp.'],
  ]);

model('UpgradeUpliftRate',
  'Runtime-editable uplift-% schedule (Model B). Derives the upgrade differential: entitlement = chosenFare / (1 + pct) (#14).',
  [
    ['id', 'Text', 'PK', 'N', 'cuid()', 'Surrogate key.'],
    ['fromClassId', 'Text', 'ref', 'N', '-', 'Entitlement class of the step.'],
    ['toClassId', 'Text', 'ref', 'N', '-', 'Chosen (upgraded) class of the step.'],
    ['pct', 'Decimal', '', 'N', '-', 'Uplift fraction over entitlement (e.g. 0.5 = 50%).'],
    ['active', 'Boolean', '', 'N', 'true', 'Is the rate active?'],
    ['createdAt', 'DateTime', '', 'N', 'now()', 'Row creation timestamp.'],
  ],
  ['Composite unique: (fromClassId, toClassId), one active row per class-step pair.']);

model('PolicyGroupM6',
  'The editable “attracts M6” flag per travel policy group (§13.19). Group definitions stay in the reference master; only this flag is runtime-editable.',
  [
    ['code', 'Text', 'PK', 'N', '-', 'Travel policy group code (e.g. C20); natural key.'],
    ['m6', 'Boolean', '', 'N', 'false', 'Does this group attract an M6 differential?'],
    ['updatedAt', 'DateTime', '', 'N', 'auto', 'Auto-updated on every change.'],
  ]);

model('AcademicTerm',
  'The single university-wide teaching calendar (admin-maintained per academic year). Each row is a dated TEACHING | EXAM | BREAK period; the non-term-research derivation checks a trip window against these.',
  [
    ['id', 'Text', 'PK', 'N', 'cuid()', 'Surrogate key.'],
    ['academicYear', 'Text', '', 'N', '-', 'Academic year, e.g. "2026/2027".'],
    ['name', 'Text', '', 'N', '-', 'Period name, e.g. "Semester 1, Teaching".'],
    ['type', 'Text', '', 'N', '-', 'TEACHING | EXAM | BREAK (teaching/exam = term; break = non-term).'],
    ['startDate', 'DateTime', '', 'N', '-', 'Period start.'],
    ['endDate', 'DateTime', '', 'N', '-', 'Period end.'],
    ['sortOrder', 'Integer', '', 'N', '0', 'Display order.'],
    ['updatedAt', 'DateTime', '', 'N', 'auto', 'Auto-updated on every change.'],
  ]);

model('PurposeCostItem',
  'Admin-editable per-travel-purpose cost-item profile. Each row says an expense type is a possible cost item for a purpose, with an optional standard cost that pre-fills the line (§4.4).',
  [
    ['id', 'Text', 'PK', 'N', 'cuid()', 'Surrogate key.'],
    ['purposeId', 'Text', 'ref', 'N', '-', 'Travel purpose id (TP-…).'],
    ['expenseTypeId', 'Text', 'ref', 'N', '-', 'Expense type id (ET-…).'],
    ['standardCostSgd', 'Decimal', '', 'Y', '-', 'Optional pre-fill for a declarable item (ignored for computed ODA/accommodation).'],
    ['sortOrder', 'Integer', '', 'N', '0', 'Display order.'],
    ['updatedAt', 'DateTime', '', 'N', 'auto', 'Auto-updated on every change.'],
  ],
  ['Composite unique: (purposeId, expenseTypeId), one row per purpose per expense type.']);

model('WorkflowScenario',
  'ECS-structured TR approval-workflow configuration. A named, effective-dated, enable-able scenario whose Approval Tiers + Levels are stored as JSON and compiled by the decision-tree engine (§6.2).',
  [
    ['id', 'Text', 'PK', 'N', 'cuid()', 'Surrogate key.'],
    ['code', 'Text', 'U', 'N', '-', 'Scenario code.'],
    ['name', 'Text', '', 'N', '-', 'Scenario name.'],
    ['documentType', 'Text', '', 'N', '"TRAVEL_REQUEST"', 'Scope: TRAVEL_REQUEST | EXPENSE_CLAIM.'],
    ['effectiveFrom', 'DateTime', '', 'N', '-', 'Effective from.'],
    ['effectiveTo', 'DateTime', '', 'N', '-', 'Effective to.'],
    ['enabled', 'Boolean', '', 'N', 'true', 'Is the scenario active?'],
    ['tiersJson', 'Text', '', 'N', '-', 'JSON ApprovalTier[] payload.'],
    ['decisionPointsJson', 'Text', '', 'N', '"[]"', 'JSON DecisionPoint[] payload.'],
    ['version', 'Integer', '', 'N', '1', 'Version number (“copy to new” bumps it).'],
    ['createdAt', 'DateTime', '', 'N', 'now()', 'Row creation timestamp.'],
    ['updatedAt', 'DateTime', '', 'N', 'auto', 'Auto-updated on every change.'],
  ]);

model('PolicyConfig',
  'ECS-structured TR policy configuration. A named, category/company-scoped, effective-dated Policy whose Rules are stored as JSON and evaluated by the configured-policy engine (§6.3).',
  [
    ['id', 'Text', 'PK', 'N', 'cuid()', 'Surrogate key.'],
    ['code', 'Text', 'U', 'N', '-', 'Policy code.'],
    ['name', 'Text', '', 'N', '-', 'Policy name.'],
    ['documentType', 'Text', '', 'N', '"TRAVEL_REQUEST"', 'Scope: TRAVEL_REQUEST | EXPENSE_CLAIM.'],
    ['category', 'Text', '', 'N', '-', 'Policy category.'],
    ['companyCode', 'Text', '', 'N', '"NTU"', 'Company scope.'],
    ['effectiveFrom', 'DateTime', '', 'N', '-', 'Effective from.'],
    ['effectiveTo', 'DateTime', '', 'N', '-', 'Effective to.'],
    ['enabled', 'Boolean', '', 'N', 'true', 'Is the policy active?'],
    ['rulesJson', 'Text', '', 'N', '-', 'JSON PolicyRuleCfg[] payload.'],
    ['version', 'Integer', '', 'N', '1', 'Version number.'],
    ['createdAt', 'DateTime', '', 'N', 'now()', 'Row creation timestamp.'],
    ['updatedAt', 'DateTime', '', 'N', 'auto', 'Auto-updated on every change.'],
  ]);

model('PolicyCheck',
  'The result of a common / pre-trip policy rule evaluation on a request (§6.3).',
  [
    ['id', 'Text', 'PK', 'N', 'cuid()', 'Surrogate key.'],
    ['requestId', 'Text', 'FK', 'N', '-', '→ TravelRequest.id (cascade delete).'],
    ['code', 'Text', '', 'N', '-', 'Rule code.'],
    ['label', 'Text', '', 'N', '-', 'Human-readable rule label.'],
    ['outcome', 'Text', '', 'N', '-', 'PASS | WARNING | EXCEPTION | HARD_STOP.'],
    ['detail', 'Text', '', 'Y', '-', 'Explanation / breach detail.'],
    ['travellerId', 'Text', 'ref', 'Y', '-', 'Per-traveller check (group) (§13.14).'],
    ['resolved', 'Boolean', '', 'N', 'false', 'The exception has been approved.'],
  ]);

model('ApprovalStep',
  'A step in the pre-trip approval workflow and its decision (§6.2, §13.1).',
  [
    ['id', 'Text', 'PK', 'N', 'cuid()', 'Surrogate key.'],
    ['requestId', 'Text', 'FK', 'N', '-', '→ TravelRequest.id (cascade delete).'],
    ['seq', 'Integer', '', 'N', '-', 'Step order.'],
    ['roleType', 'Text', '', 'N', '-', 'RO | DOA | RESEARCH_DOA | EXCEPTION | FUNDING_OWNER (and Provost/Dean via config).'],
    ['approverId', 'Text', 'ref', 'Y', '-', 'Assigned approver (employee id).'],
    ['onBehalfOf', 'Text', 'ref', 'Y', '-', 'Delegation principal (§13.5).'],
    ['status', 'Text', '', 'N', '"Pending"', 'Pending | Approved | Rejected | SentBack | Skipped.'],
    ['decidedAt', 'DateTime', '', 'Y', '-', 'When the decision was made.'],
    ['comments', 'Text', '', 'Y', '-', 'Approver comments.'],
  ]);

model('TravelBooking',
  'A booking header from the TMC or self-booking. Carries CTA settlement flags and has segment and charge children.',
  [
    ['id', 'Text', 'PK', 'N', 'cuid()', 'Surrogate key.'],
    ['requestId', 'Text', 'FK', 'N', '-', '→ TravelRequest.id (cascade delete).'],
    ['travellerId', 'Text', 'ref', 'Y', '-', 'Per-traveller booking in a group fan-out (AC15).'],
    ['tmcProviderId', 'Text', 'ref', 'Y', '-', 'The TMC provider that made this booking.'],
    ['pnr', 'Text', '', 'Y', '-', 'Passenger Name Record.'],
    ['invoiceNo', 'Text', '', 'Y', '-', 'Provider invoice number (feed); SAP posting reference (DD-31).'],
    ['ticketNo', 'Text', '', 'Y', '-', 'Air ticket number.'],
    ['channel', 'Text', '', 'Y', '-', 'TMC | SELF_BOOKED.'],
    ['fare', 'Decimal', '', 'Y', '-', 'Air fare.'],
    ['taxes', 'Decimal', '', 'Y', '-', 'Taxes.'],
    ['fees', 'Decimal', '', 'Y', '-', 'Fees.'],
    ['hotelRate', 'Decimal', '', 'Y', '-', 'Hotel rate.'],
    ['ctaAccountId', 'Text', 'ref', 'Y', '-', 'CTA account the central charges were lodged to (DD-30).'],
    ['ctaCharged', 'Boolean', '', 'N', 'false', 'Central charges have actually settled on the CTA.'],
    ['ctaChargeDate', 'DateTime', '', 'Y', '-', 'Date the charge posted to the CTA (feed).'],
    ['status', 'Text', '', 'N', '"Booked"', 'Booking status.'],
    ['travellerLineNo', 'Integer', '', 'Y', '-', 'The booked traveller’s group line number (TA/0n), denormalised.'],
  ],
  ['Children (cascade): BookingSegment, BookingCharge.']);

model('BookingCharge',
  'The per-charge CTA breakdown as reported by the TMC feed, the authoritative basis for the CTA → SAP posting (DD-31).',
  [
    ['id', 'Text', 'PK', 'N', 'cuid()', 'Surrogate key.'],
    ['bookingId', 'Text', 'FK', 'N', '-', '→ TravelBooking.id (cascade delete).'],
    ['type', 'Text', '', 'N', '-', 'AIRFARE | ACCOMMODATION | FEE | CAR | VISA (feed charge type).'],
    ['expenseTypeId', 'Text', 'ref', 'N', '-', 'ECS expense-type id → debit GL + default tax code.'],
    ['amountSgd', 'Decimal', '', 'N', '-', 'Gross, GST-inclusive amount.'],
    ['gstCode', 'Text', '', 'N', '-', 'SAP tax code asserted by the feed (IZ/IO/I9/P9).'],
    ['gstAmountSgd', 'Decimal', '', 'N', '0', 'External tax amount (0 for IZ/IO).'],
    ['gstClaimable', 'Boolean', '', 'N', 'true', 'Fee lines: drives I9 (true) vs P9 (false).'],
    ['pnr', 'Text', '', 'Y', '-', 'The PNR this charge settled under (§7.3 trace).'],
    ['ticketNumber', 'Text', '', 'Y', '-', 'Air: the e-ticket this charge was issued against.'],
    ['segmentRef', 'Text', '', 'Y', '-', 'The booked segment this charge maps to.'],
  ]);

model('BookingSegment',
  'A booked air or hotel segment, with the GDS trace fields that link segment → PNR → TA.',
  [
    ['id', 'Text', 'PK', 'N', 'cuid()', 'Surrogate key.'],
    ['bookingId', 'Text', 'FK', 'N', '-', '→ TravelBooking.id (cascade delete).'],
    ['type', 'Text', '', 'N', '-', 'AIR | HOTEL.'],
    ['originCode', 'Text', 'ref', 'Y', '-', 'Origin airport.'],
    ['destCode', 'Text', 'ref', 'Y', '-', 'Destination airport.'],
    ['bookedClassId', 'Text', 'ref', 'Y', '-', 'Booked travel class.'],
    ['departDate', 'DateTime', '', 'Y', '-', 'Departure date.'],
    ['arriveDate', 'DateTime', '', 'Y', '-', 'Arrival date.'],
    ['amount', 'Decimal', '', 'Y', '-', 'Segment amount.'],
    ['segmentRef', 'Text', '', 'Y', '-', 'Stable per-segment id within the feed (§7.3).'],
    ['pnr', 'Text', '', 'Y', '-', 'The PNR this segment sits under.'],
    ['segmentStatus', 'Text', '', 'Y', '-', 'Air: GDS segment status code (HK/UN/TK…).'],
    ['ticketNumber', 'Text', '', 'Y', '-', 'Air: the e-ticket covering this segment.'],
    ['couponNumber', 'Integer', '', 'Y', '-', 'Air: the coupon (flight sequence) on that ticket.'],
  ]);

model('BookingDeviation',
  'An approval-to-booking variance, used to decide whether re-approval is needed (§6.4, AC10). v1.3 the check runs at category and segment / PNR level, and each deviation records its scope (level, scopeRef, pnr). A segment-only airfare breach is non-material (LogOnly); it becomes material (Reapproval) only when the airfare category limit is also exceeded.',
  [
    ['id', 'Text', 'PK', 'N', 'cuid()', 'Surrogate key.'],
    ['requestId', 'Text', 'FK', 'N', '-', '→ TravelRequest.id (cascade delete).'],
    ['field', 'Text', '', 'N', '-', 'Human-readable label of what deviated (e.g. "Airfare", "Airfare segment (PNR ...: SIN-HND)").'],
    ['approvedValue', 'Text', '', 'Y', '-', 'The approved value (SGD, from the frozen approval snapshot).'],
    ['bookedValue', 'Text', '', 'Y', '-', 'The booked value (SGD, from the TMC feed).'],
    ['material', 'Boolean', '', 'N', 'false', 'Material (needs reapproval) vs logged for the record only. A segment-only airfare breach is non-material unless the airfare category is also breached (v1.3 item 1).'],
    ['action', 'Text', '', 'Y', '-', 'Reapproval | LogOnly | UpdateBooking.'],
    ['level', 'Text', '', 'Y', '-', 'v1.3 the scope level that breached: TOTAL | CATEGORY | SEGMENT.'],
    ['scopeRef', 'Text', '', 'Y', '-', 'v1.3 the exact scope: AIRFARE | ACCOMMODATION (category), or AIR:SIN-HND[,HND-KIX] (segment, by route).'],
    ['pnr', 'Text', '', 'Y', '-', 'v1.3 the booked PNR a SEGMENT deviation is on; null at CATEGORY / TOTAL level.'],
  ]);

model('TravelExpenseClaim',
  'A (mock) TE expense claim created from an approved request (§13.8). Carries the editable claim header and a charging snapshot.',
  [
    ['id', 'Text', 'PK', 'N', 'cuid()', 'Surrogate key.'],
    ['claimNumber', 'Text', 'U', 'N', '-', 'Business key (CLM-…).'],
    ['requestId', 'Text', 'FK', 'Y', '-', '→ TravelRequest.id (nullable; no cascade).'],
    ['claimantId', 'Text', 'ref', 'N', '-', 'The claimant (employee id).'],
    ['status', 'Text', '', 'N', '"Draft"', 'Draft | Submitted.'],
    ['reportType', 'Text', '', 'N', '"Travel expense"', 'Claim report type.'],
    ['trsNotBooked', 'Boolean', '', 'N', 'false', '“Booking not made on NTU’s TRS”.'],
    ['travelStart', 'DateTime', '', 'Y', '-', 'Claimed travel start.'],
    ['travelEnd', 'DateTime', '', 'Y', '-', 'Claimed travel end.'],
    ['additionalApprover1', 'Text', 'ref', 'Y', '-', 'Optional additional approver 1.'],
    ['additionalApprover2', 'Text', 'ref', 'Y', '-', 'Optional additional approver 2.'],
    ['lessCorpCard', 'Decimal', '', 'N', '0', 'Less NTU Corporate Card transaction amount.'],
    ['lessPersonal', 'Decimal', '', 'N', '0', 'Less personal expenses / sponsorship received.'],
    ['chargingMode', 'Text', '', 'N', '"MAIN"', 'MAIN | CLAIM | ITEM (§17).'],
    ['chargingMainCode', 'Text', 'ref', 'Y', '-', 'Main charging account for the claim.'],
    ['chargingJson', 'Text', '', 'Y', '-', 'JSON {rows:[…], lineMap:{}} charging snapshot.'],
    ['createdAt', 'DateTime', '', 'N', 'now()', 'Row creation timestamp.'],
  ],
  ['Children: TEExpenseLine (cascade), ClaimApprovalStep (cascade), TravelExpenseLink (1:1).']);

model('ClaimApprovalStep',
  'A step in the configurable TE-claim workflow: Verifier → (Exception) → (RO) → DOA (§51). The DOA step may be auto-granted.',
  [
    ['id', 'Text', 'PK', 'N', 'cuid()', 'Surrogate key.'],
    ['claimId', 'Text', 'FK', 'N', '-', '→ TravelExpenseClaim.id (cascade delete).'],
    ['seq', 'Integer', '', 'N', '-', 'Step order.'],
    ['roleType', 'Text', '', 'N', '-', 'VERIFIER | EXCEPTION | RO | DOA | RESEARCH_DOA.'],
    ['approverId', 'Text', 'ref', 'Y', '-', 'Assigned approver.'],
    ['status', 'Text', '', 'N', '"Pending"', 'Pending | Approved | SentBack | Skipped.'],
    ['autoGranted', 'Boolean', '', 'N', 'false', 'DOA auto-granted from the approved TR (§51).'],
    ['decidedAt', 'DateTime', '', 'Y', '-', 'When decided.'],
    ['comments', 'Text', '', 'Y', '-', 'Approver comments.'],
  ]);

model('TEExpenseLine',
  'A TE-claim expense line with approved/booked/actual amounts for estimate-to-actual tracking (TR-17).',
  [
    ['id', 'Text', 'PK', 'N', 'cuid()', 'Surrogate key.'],
    ['claimId', 'Text', 'FK', 'N', '-', '→ TravelExpenseClaim.id (cascade delete).'],
    ['category', 'Text', '', 'N', '-', 'Expense category.'],
    ['expenseTypeId', 'Text', 'ref', 'N', '-', 'ECS expense-type id.'],
    ['treatment', 'Text', '', 'N', '-', 'LOCKED | EDITABLE | REFERENCE | EXCLUDED (§13.8).'],
    ['approvedSgd', 'Decimal', '', 'N', '0', 'Approved estimate (SGD).'],
    ['bookedSgd', 'Decimal', '', 'Y', '-', 'Booked amount (null / self-booked = N/A).'],
    ['actualSgd', 'Decimal', '', 'N', '0', 'Actual claimed amount.'],
    ['varianceSgd', 'Decimal', '', 'N', '0', 'Actual − approved variance.'],
    ['receiptOk', 'Boolean', '', 'N', 'false', 'Receipt attached / valid.'],
    ['transactionDate', 'DateTime', '', 'Y', '-', 'Transaction date.'],
    ['reason', 'Text', '', 'Y', '-', 'Reason / description.'],
    ['receiptType', 'Text', '', 'N', '"LOCAL_GST"', 'LOCAL_GST | FOREIGN_NO_GST | NO_RECEIPT.'],
    ['currency', 'Text', '', 'N', '"SGD"', 'Line currency.'],
    ['foreignAmount', 'Decimal', '', 'Y', '-', 'Amount in line currency.'],
    ['sponsorSgd', 'Decimal', '', 'N', '0', 'Sponsored portion (SGD).'],
    ['chargingCode', 'Text', 'ref', 'Y', '-', 'Per-item claim allocation (ITEM mode).'],
    ['allocJson', 'Text', '', 'Y', '-', 'Per-item multi-account split JSON [{code,pct,io}].'],
  ]);

model('TravelExpenseLink',
  'Links a Travel Request to a TE claim (1:1 on the claim; a request may have several).',
  [
    ['id', 'Text', 'PK', 'N', 'cuid()', 'Surrogate key.'],
    ['requestId', 'Text', 'FK', 'N', '-', '→ TravelRequest.id (cascade delete).'],
    ['claimId', 'Text', 'FK·U', 'N', '-', '→ TravelExpenseClaim.id (unique → 1:1; cascade delete).'],
    ['travellerId', 'Text', 'ref', 'Y', '-', 'The traveller the claim is for (group).'],
    ['createdAt', 'DateTime', '', 'N', 'now()', 'Row creation timestamp.'],
  ]);

model('IntegrationMessage',
  'Outbound/inbound TMC payload tracking (§13.9), the audit of what was sent to and received from the TMC.',
  [
    ['id', 'Text', 'PK', 'N', 'cuid()', 'Surrogate key.'],
    ['requestId', 'Text', 'FK', 'N', '-', '→ TravelRequest.id (cascade delete).'],
    ['direction', 'Text', '', 'N', '-', 'OUTBOUND | INBOUND.'],
    ['kind', 'Text', '', 'N', '-', 'TMC_HANDOFF | TMC_RESPONSE.'],
    ['tmcProviderId', 'Text', 'ref', 'Y', '-', 'The TMC provider this message was exchanged with.'],
    ['payload', 'Text', '', 'N', '-', 'Canonical JSON payload.'],
    ['createdAt', 'DateTime', '', 'N', 'now()', 'Row creation timestamp.'],
  ]);

model('AuditEvent',
  'Field, workflow and integration history (AC13). User comments (§13.21) are stored here with kind = COMMENT so comments and audit are one stream.',
  [
    ['id', 'Text', 'PK', 'N', 'cuid()', 'Surrogate key.'],
    ['requestId', 'Text', 'FK', 'Y', '-', '→ TravelRequest.id (nullable; no cascade).'],
    ['actorId', 'Text', 'ref', 'Y', '-', 'Who performed the action.'],
    ['onBehalfOf', 'Text', 'ref', 'Y', '-', 'Delegation principal, if acting for another.'],
    ['kind', 'Text', '', 'N', '-', 'CREATE | SUBMIT | APPROVE | REJECT | SENDBACK | AMEND | INTEGRATION | TE_LINK | STATUS | COMMENT.'],
    ['summary', 'Text', '', 'N', '-', 'Human-readable event summary.'],
    ['createdAt', 'DateTime', '', 'N', 'now()', 'Row creation timestamp.'],
  ]);

model('Attachment',
  'Supporting-evidence file attached to a request (§13.21). The prototype stores bytes in-row; production would use file storage.',
  [
    ['id', 'Text', 'PK', 'N', 'cuid()', 'Surrogate key.'],
    ['requestId', 'Text', 'FK', 'N', '-', '→ TravelRequest.id (cascade delete).'],
    ['docType', 'Text', '', 'N', '-', 'Quotation | Conference Invitation | Approval Evidence | Other.'],
    ['fileName', 'Text', '', 'N', '-', 'Original file name.'],
    ['sizeKb', 'Integer', '', 'N', '0', 'File size (KB).'],
    ['contentType', 'Text', '', 'Y', '-', 'MIME type of the stored bytes.'],
    ['content', 'Binary', '', 'Y', '-', 'The file content (prototype stores in-row).'],
    ['uploadedById', 'Text', 'ref', 'Y', '-', 'Who uploaded it.'],
    ['createdAt', 'DateTime', '', 'N', 'now()', 'Row creation timestamp.'],
  ]);

// ===== APPENDIX A, ENUMERATIONS =====
function appxTable(headers, widths, rows) {
  const hr = new TableRow({ tableHeader: true, children: headers.map((h, i) => cell(h, { w: widths[i], bold: true, color: NAVY, shade: HEAD, size: 15 })) });
  const rr = rows.map((r, idx) => new TableRow({ children: r.map((c, i) => cell(c, { w: widths[i], shade: idx % 2 ? ZEBRA : undefined, bold: i === 0 && widths.length > 1, color: i === 0 ? '2a2d40' : '333333' })) }));
  return new Table({ columnWidths: widths, width: { size: widths.reduce((a, b) => a + b, 0), type: WidthType.DXA }, layout: TableLayoutType.FIXED, rows: [hr, ...rr] });
}
const EL = (t) => out.push(new Paragraph({ spacing: { before: 180, after: 40 }, children: [new TextRun({ text: t, bold: true, size: 19, color: NAVY })] }));
const push = (x) => out.push(x);

out.push(new Paragraph({ pageBreakBefore: true, children: [] }));
H1('3 · Appendix A: Enumerations');
P('SQLite has no native enums, so the status / type / mode columns are Text. These are their allowed values, central in src/shared/enums.ts. Values are stored exactly as shown (case-sensitive).');

EL('A1 · Travel Request status: TravelRequest.status');
push(appxTable(['Stored value', 'Meaning'], [3400, 11998], [
  ['Draft', 'Being prepared; not yet submitted.'],
  ['Submitted', 'Submitted; routing to the first approver.'],
  ['Pending RO Approval', 'Awaiting the Reporting Officer.'],
  ['Pending Additional Approval', 'Awaiting a traveller-added Additional Approver (§23).'],
  ['Pending Exception Approval', 'Awaiting the Exception Approver for a policy exception (§26).'],
  ['Pending Dean Recommendation', 'Guest class-upgrade: awaiting the Dean’s recommendation (§8/DD-25).'],
  ['Pending Provost Approval', 'Guest class-upgrade: awaiting the Provost (§8/DD-25).'],
  ['Pending DOA Approval', 'Awaiting the Delegated Officer of Authority.'],
  ['Approved', 'Fully approved; a travel authorisation (TA) is issued.'],
  ['Amendment In Progress', 'An approved request is being amended (re-approval pending).'],
  ['Sent Back', 'Returned by an approver for changes (→ Draft).'],
  ['Rejected', 'Legacy/compat value only, a TR is sent back, never rejected.'],
  ['Withdrawn', 'Withdrawn by the requestor before approval.'],
  ['Cancelled', 'Cancelled after approval.'],
  ['Expired', 'Authorisation lapsed before booking.'],
  ['Closed', 'Trip taken and closed out.'],
]));
EL('A1b · Allowed status transitions (AC24)');
push(appxTable(['From', 'To (allowed)'], [3400, 11998], [
  ['Draft', 'Submitted · Withdrawn'],
  ['Submitted', 'Pending Additional / DOA / Exception / Dean / Provost'],
  ['Pending RO Approval', 'Pending DOA / Exception / Dean / Provost · Sent Back'],
  ['Pending Additional Approval', 'Pending Exception / Dean / Provost / DOA · Sent Back'],
  ['Pending Exception Approval', 'Pending Dean / Provost / DOA · Sent Back'],
  ['Pending Dean Recommendation', 'Pending Provost / DOA · Sent Back'],
  ['Pending Provost Approval', 'Pending DOA · Sent Back'],
  ['Pending DOA Approval', 'Approved · Sent Back'],
  ['Approved', 'Amendment In Progress · Cancelled · Expired · Closed'],
  ['Amendment In Progress', 'Approved · Sent Back · Cancelled'],
  ['Sent Back', 'Draft · Withdrawn'],
  ['Expired', 'Pending RO / DOA · Cancelled'],
  ['Rejected / Withdrawn / Cancelled / Closed', '(terminal, no transitions)'],
]));

EL('A2 · Booking status: TravelRequest.bookingStatus (TravelBooking.status uses the booked subset)');
push(appxTable(['Stored value', 'Meaning'], [3400, 11998], [
  ['Not Sent', 'Approved but not yet handed to the TMC.'],
  ['Sent to TMC', 'Booking instruction sent.'],
  ['Received by TMC', 'TMC acknowledged the instruction.'],
  ['Booking In Progress', 'TMC is working the booking.'],
  ['Traveller Action Required', 'TMC needs traveller input.'],
  ['Partially Booked', 'Some segments/travellers booked.'],
  ['Booked', 'Fully booked.'],
  ['Travel Completed', 'Trip taken; ready to close/claim.'],
  ['Booking Failed', 'Booking could not be completed.'],
  ['Self-Booked', 'Booked outside the TMC by the traveller.'],
  ['Cancellation Requested', 'Cancel sent to the TMC; awaiting confirmation.'],
  ['Cancelled', 'Booking cancelled.'],
]));

EL('A3 · TE-claim approval status (claim workflow): header TravelExpenseClaim.status stores Draft | Submitted');
push(appxTable(['Value', 'Meaning'], [3400, 11998], [
  ['Draft', 'Claim being prepared.'],
  ['Pending Verification', 'Awaiting the claim Verifier (§51).'],
  ['Pending Exception Approval', 'Awaiting the Exception Approver.'],
  ['Pending RO Approval', 'Awaiting the Reporting Officer.'],
  ['Pending DOA Approval', 'Awaiting the DOA (may auto-grant within tolerance).'],
  ['Approved', 'Claim approved.'],
  ['Sent Back', 'Returned for changes.'],
]));

EL('A4 · Approver role: ApprovalStep.roleType, ClaimApprovalStep.roleType');
push(appxTable(['Value', 'Meaning'], [3400, 11998], [
  ['RO', 'Reporting Officer.'],
  ['ADDITIONAL_APPROVER', 'Traveller-selected additional approver (§23).'],
  ['DOA', 'Delegated Officer of Authority.'],
  ['RESEARCH_DOA', 'Research-WBS DOA (PI/research route).'],
  ['EXCEPTION', 'Exception Approver (policy exceptions).'],
  ['DEAN', 'Dean recommending a guest class-upgrade (§8/DD-25).'],
  ['PROVOST', 'Provost authorising a guest class-upgrade.'],
  ['VERIFIER', 'TE-claim verifier (claim stage only, §51).'],
]));

EL('A5 · Policy outcome & step status');
push(appxTable(['Column', 'Allowed values'], [4600, 10798], [
  ['PolicyCheck.outcome', 'PASS · WARNING · EXCEPTION · HARD_STOP'],
  ['AccommodationEstimate.exceptionOutcome', 'PASS · EXCEPTION'],
  ['ApprovalStep.status', 'Pending · Approved · Rejected · SentBack · Skipped'],
  ['ClaimApprovalStep.status', 'Pending · Approved · SentBack · Skipped'],
]));

EL('A6 · Booking arrangement & method');
push(appxTable(['Column', 'Allowed values'], [4600, 10798], [
  ['TravelRequest.bookingArrangement', 'AUTO · TMC-<providerId> · SELF_BOOKED · HOST_ARRANGED · NO_BOOKING'],
  ['TravelRequest.bookingMethod (TMC only)', 'TMC_ONLINE · AGENT_ASSISTED · OFFLINE'],
  ['TravelBooking.channel', 'TMC · SELF_BOOKED'],
]));

EL('A7 · Classification & treatment');
push(appxTable(['Column', 'Allowed values'], [4600, 10798], [
  ['EstimatedExpense.category / TEExpenseLine.category', 'AIRFARE · ACCOMMODATION · ODA · CONFERENCE · OTHER'],
  ['IntegrationFieldSetting.teTreatment / TEExpenseLine.treatment', 'LOCKED · EDITABLE · REFERENCE · EXCLUDED'],
  ['WorkflowScenario.documentType / PolicyConfig.documentType', 'TRAVEL_REQUEST · EXPENSE_CLAIM'],
  ['ECS roles (persona context)', 'TRAVELLER · TRAVEL_REQUESTOR · RO · DOA · RESEARCH_DOA · EXCEPTION_APPROVER · TRAVEL_ADMIN · SYSTEM_ADMIN · FINANCE_VIEWER'],
]));

EL('A8 · Field-local value sets (defined inline on the model, not in enums.ts)');
push(appxTable(['Column', 'Allowed values'], [4900, 10498], [
  ['ModuleSettings.expenseScope', 'MAJOR_ONLY · ALL'],
  ['ModuleSettings.hotelEstimateBasis', 'QUOTED · CAP · LOWER'],
  ['ModuleSettings.airfareTreatment', 'DIRECT_SAP · IN_TE · REFERENCE'],
  ['ModuleSettings.teLinkageMandatory', 'YES · NO · CONDITIONAL'],
  ['ModuleSettings.approvalAmountBasis', 'GROSS · NET_NTU · MAJOR_COST · ALLOCATION'],
  ['ModuleSettings.roRequirement', 'ALWAYS · INDIVIDUAL_ONLY · NEVER'],
  ['ModuleSettings.chargingSplitMode', 'PERCENT · AMOUNT'],
  ['ModuleSettings.ctaPostingTiming', 'ON_RECEIPT (fixed; AT_CLAIM retired)'],
  ['TravelRequest.groupType', 'STAFF · STUDENT · MIXED · (null = individual/guest)'],
  ['TravelRequest / TravelRequestTraveller.travellerType', 'EMPLOYEE · GUEST · STUDENT'],
  ['TravelRequest.tripType', 'ROUND_TRIP · ONE_WAY · MULTI_CITY'],
  ['TravelRequest.chargingMode', 'REQUEST · LINE'],
  ['TravelRequest.hotelSettlement', 'INDIVIDUAL · CTA'],
  ['ItineraryLeg.transportMode', 'AIR · RAIL · OTHER'],
  ['EstimatedExpense.estimateBasis', 'QUOTED · CAP · LOWER · RATE'],
  ['EstimatedExpense.upgradeFunding', 'NTU · SELF'],
  ['ChargingAllocation.chargingType', 'CC · WBS'],
  ['AcademicTerm.type', 'TEACHING · EXAM · BREAK'],
  ['CtaPostingDocument.status / chargeType', 'Posted · Failed · Reversed  /  Airfare · Accommodation'],
  ['BookingCharge.type', 'AIRFARE · ACCOMMODATION · FEE · CAR · VISA'],
  ['BookingCharge.gstCode', 'IZ · IO · I9 · P9 (SAP tax codes)'],
  ['BookingSegment.type / segmentStatus', 'AIR · HOTEL  /  GDS codes HK · UN · TK · …'],
  ['BookingDeviation.action', 'Reapproval · LogOnly · UpdateBooking'],
  ['TravelExpenseClaim.chargingMode', 'MAIN · CLAIM · ITEM'],
  ['TravelExpenseClaim.status', 'Draft · Submitted'],
  ['TEExpenseLine.receiptType', 'LOCAL_GST · FOREIGN_NO_GST · NO_RECEIPT'],
  ['IntegrationMessage.direction / kind', 'OUTBOUND · INBOUND  /  TMC_HANDOFF · TMC_RESPONSE'],
  ['AuditEvent.kind', 'CREATE · SUBMIT · APPROVE · REJECT · SENDBACK · AMEND · INTEGRATION · TE_LINK · STATUS · COMMENT'],
  ['Attachment.docType', 'Quotation · Conference Invitation · Approval Evidence · Other'],
]));

// ===== APPENDIX B, ERD =====
function erdImage(file, w) {
  const buf = fs.readFileSync(require('path').join(__dirname, file));
  const pw = buf.readUInt32BE(16), ph = buf.readUInt32BE(20);
  return new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 60, after: 20 }, children: [new ImageRun({ data: buf, type: 'png', transformation: { width: w, height: Math.round(w * ph / pw) } })] });
}
const CAP = (t) => out.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 160 }, children: [new TextRun({ text: t, italics: true, size: 16, color: MUTE })] }));

out.push(new Paragraph({ pageBreakBefore: true, children: [] }));
H1('4 · Appendix B: Entity-relationship diagram');
P('The relational core, shown as three connected views that share the TravelRequest hub. Crow’s-foot notation: a single bar (|) is “one”, a circle+fork (o{) is “zero-or-many”, and a single bar+circle (o|) is “zero-or-one” (the 1:1 estimate detail). A dashed line marks a logical link that is not an enforced foreign key. Every attribute appears in the object tables in Section 2.');
EL('B1 · Request, itinerary & estimates');
out.push(erdImage('erd-a.png', 1026));
CAP('TravelRequest and its direct children: travellers, versions, itinerary legs, estimated expenses (each with optional 1:1 accommodation and ODA detail), charging allocations and policy checks.');
EL('B2 · Approval, booking & integration');
out.push(erdImage('erd-b.png', 1026));
CAP('Approval steps; bookings with their segments and charges (and the logical CTA posting); booking deviations; TMC integration messages; attachments; and audit events.');
EL('B3 · Expense claim');
out.push(erdImage('erd-c.png', 640));
CAP('The approved request links to one or more TE claims; each claim has its expense lines and its own approval steps.');
EL('Standalone configuration & reference masters (no foreign keys)');
P('These objects are singletons or masters keyed by a natural/business key and are not joined by foreign keys, so they do not appear in the diagrams above: ModuleSettings, IntegrationFieldSetting, IntegrationGuardSetting, CtaAccount, UpgradeDeltaAccount, UpgradeUpliftRate, PolicyGroupM6, AcademicTerm, PurposeCostItem, WorkflowScenario and PolicyConfig. Their columns are documented in Section 2.');

// ===== BUILD =====
const doc = new Document({
  styles: {
    default: {
      document: { run: { font: 'Calibri', size: 19, color: '222222' } },
      title: { run: { font: 'Calibri', size: 60, bold: true, color: NAVY }, paragraph: { spacing: { before: 0, after: 120 } } },
      heading1: { run: { font: 'Calibri', size: 30, bold: true, color: NAVY }, paragraph: { spacing: { before: 260, after: 120 }, keepNext: true } },
      heading2: { run: { font: 'Calibri', size: 23, bold: true, color: RED }, paragraph: { spacing: { before: 240, after: 60 }, keepNext: true } },
    },
  },
  sections: [{
    properties: {
      page: {
        size: { orientation: PageOrientation.LANDSCAPE, width: 11906, height: 16838 },
        margin: { top: 720, bottom: 720, left: 720, right: 720 },
      },
    },
    children: out,
  }],
});

Packer.toBuffer(doc).then((buf) => {
  const p = process.argv[2] || 'NTU-Travel-Request-Data-Dictionary.docx';
  fs.writeFileSync(p, buf);
  console.log('wrote', p, (buf.length / 1024).toFixed(0) + ' KB');
});
