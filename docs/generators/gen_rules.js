// NTU Travel Request: Validation & Business Rules (.docx) generator.
// A build-ready catalogue of every validation and business rule in the Pre-Trip prototype,
// each with a catalogue row and a detailed entry (behaviour, enforcement, configurability, source).
// Source of truth: src/modules/pretrip/*, src/modules/te/*, src/shared/ecs/services.ts,
// src/config/{decisions,workflowScenario,integrationContracts}.ts, prisma/schema.prisma.
const fs = require('fs');
const { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType, BorderStyle, ShadingType, AlignmentType, TableLayoutType } = require('docx');

const NAVY = '1B1C62', RED = 'D71440', MUTE = '6b6f82', HEAD = 'EDEFF7', ZEBRA = 'F7F8FC', OKG = '2a7d4f', WARN = 'B26A00';
const out = [];

// Sanitiser: decode the entities the source notes may carry, and strip em/en dashes (house style).
const S = (t) => String(t)
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/[—–]/g, '-');

const cell = (text, { w, bold, color, shade, align, size, font } = {}) => new TableCell({
  width: { size: w, type: WidthType.DXA }, shading: shade ? { type: ShadingType.CLEAR, color: 'auto', fill: shade } : undefined,
  margins: { top: 40, bottom: 40, left: 90, right: 90 },
  children: [new Paragraph({ alignment: align, children: (Array.isArray(text) ? text : [text]).map((t) => new TextRun({ text: S(t), bold: !!bold, color: color || '222222', size: size || 15, font: font || 'Calibri' })) })],
});
function T(headers, widths, rows, opts = {}) {
  const hr = new TableRow({ tableHeader: true, children: headers.map((h, i) => cell(h, { w: widths[i], bold: true, color: NAVY, shade: HEAD, size: 15 })) });
  const rr = rows.map((r, idx) => new TableRow({ children: r.map((c, i) => cell(c, { w: widths[i], shade: idx % 2 ? ZEBRA : undefined, bold: i === 0 && opts.boldFirst !== false, color: i === 0 ? '2a2d40' : '333333', font: opts.mono && i === 0 ? 'Consolas' : 'Calibri' })) }));
  return new Table({ columnWidths: widths, width: { size: widths.reduce((a, b) => a + b, 0), type: WidthType.DXA }, layout: TableLayoutType.FIXED, rows: [hr, ...rr] });
}
const H1 = (t) => out.push(new Paragraph({ heading: HeadingLevel.HEADING_1, pageBreakBefore: true, children: [new TextRun({ text: S(t) })] }));
const H2 = (t) => out.push(new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 220, after: 50 }, children: [new TextRun({ text: S(t) })] }));
const P = (t) => out.push(new Paragraph({ spacing: { after: 100 }, children: typeof t === 'string' ? [new TextRun({ text: S(t), size: 19, color: '333333' })] : t }));
const BUL = (t) => out.push(new Paragraph({ bullet: { level: 0 }, spacing: { after: 20 }, children: [new TextRun({ text: S(t), size: 18, color: '333333' })] }));
const TBL = (x) => out.push(x);
const GAP = () => out.push(new Paragraph({ spacing: { after: 120 }, children: [] }));
const boxP = (t, b) => new Paragraph({ spacing: { after: 60 }, shading: { type: ShadingType.CLEAR, color: 'auto', fill: 'FBF8EF' }, border: { left: { style: BorderStyle.SINGLE, size: 18, color: 'C8A24A' } }, indent: { left: 140 }, children: [new TextRun({ text: S(t), bold: !!b, size: b ? 19 : 16, color: b ? '7A5A00' : '444444' })] });

// label: body paragraph
function LB(label, body, { color } = {}) {
  out.push(new Paragraph({ spacing: { after: 30 }, children: [
    new TextRun({ text: S(label) + ': ', bold: true, size: 16, color: NAVY }),
    new TextRun({ text: S(body), size: 16, color: color || '333333' }),
  ] }));
}

// Behaviour colour cue
const behColor = (b) => /hard block/i.test(b) ? RED : /warn/i.test(b) ? WARN : /auto-grant|routing/i.test(b) ? NAVY : OKG;

// Render one rule section: intro, a catalogue table, then detailed entries.
function section(code, title, intro, rules) {
  H1(`${code} · ${title}`);
  if (intro) P(intro);
  // Catalogue
  H2('Rule catalogue');
  TBL(T(['ID', 'Rule', 'Behaviour', 'Configurable', 'Source'], [1500, 6400, 2600, 2700, 2200],
    rules.map((r) => [r.id, r.t, r.b, r.c, r.s]), { boldFirst: true, mono: true }));
  // Details
  H2('Rule detail');
  rules.forEach((r) => {
    out.push(new Paragraph({ heading: HeadingLevel.HEADING_3, spacing: { before: 160, after: 20 }, children: [
      new TextRun({ text: r.id + '  ', bold: true, color: NAVY, font: 'Consolas', size: 18 }),
      new TextRun({ text: S(r.t), bold: true, color: '2a2d40', size: 20 }),
    ] }));
    out.push(new Paragraph({ spacing: { after: 40 }, children: [
      new TextRun({ text: r.ty, bold: true, size: 15, color: r.ty === 'Validation' ? RED : NAVY }),
      new TextRun({ text: '   ·   ', size: 15, color: MUTE }),
      new TextRun({ text: S(r.b), bold: true, size: 15, color: behColor(r.b) }),
      new TextRun({ text: '   ·   Config: ', size: 15, color: MUTE }),
      new TextRun({ text: S(r.c), size: 15, color: '444444' }),
      new TextRun({ text: '   ·   Source: ', size: 15, color: MUTE }),
      new TextRun({ text: S(r.s), size: 15, color: '444444' }),
    ] }));
    LB('Enforcement', r.en);
    if (r.w) LB('Why', r.w);
    if (r.e) LB('Example', r.e);
    if (r.d) LB('Detail', r.d);
  });
}

// ======================================================================= COVER
out.push(new Paragraph({ spacing: { before: 1800 }, children: [new TextRun({ text: 'NTU Travel & Expense Claim System', bold: true, color: RED, size: 26 })] }));
out.push(new Paragraph({ spacing: { before: 120 }, children: [new TextRun({ text: 'Travel Request: Validation & Business Rules', bold: true, color: NAVY, size: 52 })] }));
out.push(new Paragraph({ spacing: { before: 160 }, children: [new TextRun({ text: 'A build-ready catalogue of the validation and business rules that govern the Pre-Trip Travel Request flow: request creation, trip and itinerary, cost estimates, charging, approval routing, booking hand-off and deviation, and the expense-claim link. Every rule states where it fires, whether it blocks or warns, whether it is configurable, and a source reference.', color: '4a4e63', size: 23 })] }));
out.push(new Paragraph({ spacing: { before: 500, after: 160 }, border: { top: { style: BorderStyle.SINGLE, size: 12, color: 'eceaf3' } }, children: [new TextRun({ text: 'Prototype build reference · derived from the Pre-Trip prototype source · 10 November 2026', color: MUTE, size: 18 })] }));
out.push(boxP('Note to readers: prototype reference, not the target design', true));
out.push(boxP('This document catalogues the rules the Pre-Trip prototype enforces today, so the vendor can reproduce the same behaviour. Code references (file names and function names) describe the prototype implementation. The prototype uses mock ECS/HR, charging and TMC services; transport, authentication, error handling and other non-functional concerns are out of scope and for the vendor to design.', false));
out.push(boxP('References such as paragraph 13.9 or DD-23 point to the Pre-Trip prototype build pack shared alongside this document. Settings named ModuleSettings.<key> are runtime switches on the Pre-Trip Module Settings screen (TR-19); their defaults are listed in the Configuration catalogue.', false));

// ======================================================================= 1 HOW TO READ
H1('1 · How to read this document');
P('Each rule carries an ID, a one-line statement, and a detailed entry. Rules are grouped by the stage of the flow they govern. Every section opens with a scannable catalogue table, then repeats each rule in full.');
H2('Rule ID scheme');
P('An ID is <AREA>-<n>, e.g. TRP-03. The area codes follow the section order: CRT creation and authority, GRP group composition, TRP trip and dates, ITN itinerary and destination, DUP duplicate and overlap, CLS travel class, M6 upgrade differential, EST cost estimates, CHG charging and settlement, RTE approval routing, EXC policy exceptions, NTR non-term research, EMG emergency lane, PSA PI self-approval, AMT approval amount, HOF TMC hand-off, DEV booking deviation, PAL post-approval and recall, CLM expense claim.');
H2('Field legend');
TBL(T(['Field', 'Meaning'], [3200, 12200], [
  ['Type', 'Validation = a correctness gate on user input or state. Business rule = a derivation, routing or behaviour the system applies.'],
  ['Behaviour', 'Hard block = the action is refused until fixed. Soft warning = surfaced, not blocking. Auto-correct / derive = the system computes or adjusts a value. Routing = selects approvers / channels / posting. Auto-grant = a step is approved with no click.'],
  ['Enforcement', 'Where the rule runs: client (browser, a first gate only), server (the authority), or both (client mirror plus server re-check). Names the file and function.'],
  ['Configurable', 'Fixed = hard-wired in the prototype. ModuleSettings.<key> = driven by a runtime switch (see the Configuration catalogue). Some routing is additionally editable in the stored Workflow scenario.'],
  ['Source', 'The paragraph / design-decision reference in the build pack where the intent is recorded.'],
]));
out.push(boxP('Authority: for every rule the SERVER enforcement is the authority. Client-side checks (disabled buttons, live validation panels) are a first gate for usability and can be bypassed; the server re-validates on save, submit and every state change.', false));
out.push(boxP('Draft deferral: completeness and cross-field validations are deferred when a step is saved as a draft. They are enforced when the user advances a step or submits. A draft may be parked in a partial, invalid state on purpose.', false));

// ======================================================================= 2 CONFIG CATALOGUE
const CONFIG = [
  ['roRequirement', 'INDIVIDUAL_ONLY', 'RO decision point: ALWAYS (every request) / INDIVIDUAL_ONLY (individual only, dropped for a group) / NEVER. DOA is always required. (Fact is available to the engine; the seeded scenario hard-wires the INDIVIDUAL_ONLY behaviour, see RTE.)'],
  ['exceptionApproverRequired', 'true', 'On: a policy exception that needs approval inserts an Exception Approver step before the DOA. Off: the exception is surfaced to the DOA to decide. Applies to the TR and the claim workflow.'],
  ['approvalAmountBasis', 'NET_NTU', 'Amount used for DOA tiering: GROSS / NET_NTU (gross less sponsorship and self-funded upgrade) / MAJOR_COST / ALLOCATION.'],
  ['selfApprovalLimitSgd', '5000', 'PI self-approval band; 0 = never. A research trip raised for a PI at or below this amount can be self-approved.'],
  ['researchPiSelfApproval', 'true', 'On: a research-WBS individual request raised for a PI within the limit is self-approved (the PI is the DOA).'],
  ['nonTermAutoApprove', 'true', 'On: a research-WBS trip in non-term time, with the offline-approval e-mail attached and no open exception, is auto-approved on submission (approvers remain named for audit).'],
  ['sameRouteResearch', 'false', 'Off: research-charged requests route to the Research DOA line. On: research uses the normal DOA line.'],
  ['guestUpgradeProvostId', 'E-PROVOST', 'Who the Provost is for a guest travel-class upgrade. Whether the step applies is a workflow decision point (guest + upgrade).'],
  ['guestUpgradeDeanStep', 'false', 'On: a guest travel-class upgrade routes through a Dean recommendation step before the Provost (the Dean is selected on Review, required to submit).'],
  ['groupTravelEnabled', 'true', 'Enables one-request-many-travellers group requests.'],
  ['groupMaxTravellers', '10', 'Maximum members in a group (including guests/students); mirrors the TMC group-fare limit. Create is blocked above this count.'],
  ['groupGuestMixAllowed', 'true', 'On: a group may include guests alongside employees and/or students, and students+guests may form a group with no staff. Off: guests use a separate guest request.'],
  ['mixedGroupEnabled', 'true', 'On: one group may combine staff and students. Off: a group is staff-only or student-only.'],
  ['groupSubItineraries', 'false', 'On: a group traveller may deviate from the shared itinerary with their own legs; their ODA, accommodation and class are costed on their own itinerary. Off: one shared itinerary.'],
  ['purposeDrivenItems', 'true', 'On: selecting a travel purpose pre-populates its full declarable cost-item set (staff) as editable placeholders on Estimates. Off: ODA and accommodation only.'],
  ['expenseScope', 'ALL', 'Which expense types are available: MAJOR_ONLY (major-cost types only) or ALL.'],
  ['hotelEstimateBasis', 'LOWER', 'Accommodation budget basis: QUOTED, CAP, or LOWER (of quoted and cap).'],
  ['airfareTreatment', 'IN_TE', 'Claim-stage handling of a central airfare: DIRECT_SAP / IN_TE / REFERENCE.'],
  ['teLinkageMandatory', 'CONDITIONAL', 'Whether a claim must select an approved Travel Request. (Exposed in settings/UI; not read by any runtime path - linkage is implicit in the create-from-TR flow. Flagged in the Appendix.)'],
  ['chargingSplitMode', 'PERCENT', 'Request-level charging entry mode: PERCENT or AMOUNT (normalised to percentages either way).'],
  ['upgradeDeltaRoutingEnabled', 'true', 'On: the NTU-funded travel-class upgrade differential is charged to a separate M6 account for the governing BA. Off: the whole NTU fare charges the normal allocation.'],
  ['upgradeDeltaSelectionRequired', 'false', 'On: when the BA has several M6 accounts the traveller must pick one (hard stop). Off: the BA default (or first) is applied, re-selectable.'],
  ['deviationThresholdPct', '10', 'A booked category amount (airfare/accommodation) is a material deviation only when it exceeds the approved category amount by more than this % AND more than the SGD amount below. The approved amount is a reference, never a booking limit.'],
  ['deviationThresholdAbsSgd', '500', 'The absolute arm of the booking-deviation threshold; both this and the % must be exceeded.'],
  ['maxDateShiftDaysBefore', '3', 'A booked travel date may move up to this many days earlier than approved (and within approval validity). Beyond this is a material DATES deviation.'],
  ['maxDateShiftDaysAfter', '3', 'A booked travel date may move up to this many days later than approved. Beyond this is a material DATES deviation.'],
  ['evidenceRequiredFor', 'CLASS,DATES,ROUTE,CATEGORY_AMOUNT', 'Deviation types that require offline-approval evidence before the claim can be submitted. Empty = no gate.'],
  ['teAutoGrantTolerancePct', '10', 'TE claim DOA auto-grant tolerance: the claim DOA is auto-granted from the approved TR when the claim total is within this % over the approved amount (and within the SGD cap), with no new exception or expense type.'],
  ['teAutoGrantToleranceAbsSgd', '500', 'Absolute SGD cap for the TE claim DOA auto-grant tolerance.'],
  ['selfBookingEnabled', 'true', 'Allows the Self-Booked method and Travel Request selection at claim.'],
  ['authorisationValidityDays', '30', 'Travel Authorisation validity: endDate + this many days, set at final approval.'],
  ['bookingDeadlineDays', '14', 'Booking deadline: startDate less this many days, set at final approval.'],
  ['emergencyLeadDays', '14', 'Emergency-lane lead-time window: a trip departing within this many days, booked via a book-ahead method, auto-qualifies for the emergency lane.'],
  ['emergencyEvidenceRequired', 'true', 'Mode A (on): the approving DOA authorising e-mail must be attached when a trip auto-qualifies for the emergency lane. Mode B (off): no extra evidence.'],
  ['attachmentMaxMb', '7', 'Maximum upload size per file (MB).'],
];
H1('2 · Configuration catalogue (Module Settings, TR-19)');
P('These runtime switches change behaviour without a rebuild. A rule marked ModuleSettings.<key> is governed by the matching switch below. Defaults are the prototype seed values (src/config/decisions.ts). Where a value is a threshold (percent, SGD, days), it is the exact figure the rule compares against.');
TBL(T(['Setting (key)', 'Default', 'Effect'], [3600, 2400, 9400], CONFIG.map((c) => [c[0], c[1], c[2]]), { mono: true }));

// ======================================================================= SECTIONS
section('CRT', 'Request creation and authority (separation of duties)',
  'Who may originate and edit a request is an explicit allow-set, with no catch-all fallback, so an approver cannot raise then approve its own request.', [
  { id: 'CRT-1', t: 'Only a traveller, their delegate, a department Travel Requestor, or the Travel Administrator may originate a request', ty: 'Business rule', b: 'Hard block', c: 'Fixed', s: '13.13 / DD-24',
    en: 'both - guards.ts:creatableTravellerIds (client mirror in requests/new/page.tsx; server re-check in actions.ts:createDraft / createGuestDraft / createGroupDraft)',
    w: 'Separation of duties: approver-only roles must not be able to raise a request they may later approve.',
    e: 'A DOA-only persona opens Create and gets an empty traveller set; the create action returns or redirects with a no-authority message.',
    d: 'Allowed originators: the persona if isTraveller; anyone who delegated to them; a Travel Requestor for every traveller in their own department; the Travel Admin for every traveller. No fallback: DOA / Research DOA / Exception / System Admin / Finance get an empty set. canCreateTravelRequest = size > 0.' },
  { id: 'CRT-2', t: 'The posted traveller id is re-validated against the originator remit on the server', ty: 'Validation', b: 'Hard block', c: 'Fixed', s: '13.13',
    en: 'server - actions.ts:createDraft (canCreateFor(requestorId, travellerId))',
    w: 'The server must not trust the posted id even though the UI gates it.',
    e: 'A requestor posts a traveller id outside their department: create aborts without creating.',
    d: 'travellerId = posted || requestorId, and must be in creatableTravellerIds(requestorId).' },
  { id: 'CRT-3', t: 'Editing or submitting a draft is limited to a stricter set than creation', ty: 'Business rule', b: 'Hard block', c: 'Fixed', s: '13.1',
    en: 'server - guards.ts:canEditRequest via actions.ts:requireEdit on every draft mutation, and submitRequest',
    w: 'Read-only roles and approvers must not edit; uses explicit remit, not the permissive create fallback.',
    e: 'An Exception Approver opening a draft Trip step: requireEdit returns false, audit records Edit blocked.',
    d: 'Allowed editors: Travel Admin or System Admin; the requestor; the traveller themselves; a delegate for the traveller; a Travel Requestor whose department matches the traveller. Everyone else false.' },
  { id: 'CRT-4', t: 'Only the step assigned approver may act on an approval step; admins get no bypass', ty: 'Business rule', b: 'Hard block', c: 'Fixed', s: 'AC14 / AC22',
    en: 'server - guards.ts:canActOnStep, used in actions.ts:approveStep / sendBack',
    w: 'Approval is a delegated financial authority; an admin may approve only when they independently hold the role and are the assigned approver.',
    e: 'A Travel Admin tries to approve a step assigned to the RO: canActOnStep false, no-op.',
    d: 'Requires approverId && approverId === persona. A null-approver step is not open to arbitrary personas.' },
  { id: 'CRT-5', t: 'The requestor and every traveller are excluded from approving their own request', ty: 'Business rule', b: 'Routing', c: 'Fixed', s: '13.5',
    en: 'server - route.ts:selfApprovalSet, applied through resolveRoStep / pickDoa / doaCandidatesFor and the excluded filter',
    w: 'No one approves a request they travel on or raised; a dual-role persona is routed to an alternate.',
    e: 'A traveller who is also their department DOA-1: pickDoa steps to the next-higher DOA tier (self-approval prevention).',
    d: 'selfApprovalSet = all traveller ids (group) or [travellerId], plus requestorId. RO walks up to 12 reporting hops to the first officer not in the set; DOA increments past any excluded holder. The one sanctioned exception is PI self-approval (see PSA).' },
  { id: 'CRT-6', t: 'One person never approves two steps on the same request (later same-approver steps auto-approve)', ty: 'Business rule', b: 'Auto-grant', c: 'Fixed', s: 'decision 4',
    en: 'server - actions.ts:approveStep',
    w: 'When the same approver holds a later step (for example RO = DOA), approving the first auto-approves the later; both stay on the route for audit.',
    e: 'RO and DOA resolve to the same person: approving as RO auto-approves the DOA step.',
    d: 'On approve, every later Pending step with the same approverId is stamped Approved.' },
]);

section('GRP', 'Group composition',
  'A group is a single request with many travellers on one shared TA. Membership may mix employees, students (uploaded, unvalidated) and guests in any combination of two or more categories, each gated by its own switch.', [
  { id: 'GRP-1', t: 'A group has at least two and at most groupMaxTravellers members', ty: 'Validation', b: 'Hard block', c: 'ModuleSettings.groupMaxTravellers (gated by groupTravelEnabled)', s: '13.14',
    en: 'both - NewRequestForm.tsx (client disables submit) and actions.ts:createGroupDraft',
    w: 'Mirrors the TMC group-booking size limit.',
    e: '11 selected with a limit of 10: blocked. One member: blocked (a group needs at least two).',
    d: 'total = staff + students + guests. The count includes guest and student members. addGroupTraveller refuses at the limit; removeGroupTraveller keeps at least two.' },
  { id: 'GRP-2', t: 'Any mix of two or more member categories is allowed; each category is gated by its own setting', ty: 'Validation', b: 'Hard block', c: 'ModuleSettings.studentGroupEnabled / groupGuestMixAllowed / mixedGroupEnabled', s: '13.14 / 8',
    en: 'both - NewRequestForm.tsx (card gating) and actions.ts:createGroupDraft',
    w: 'Groups may combine employees, students and guests, including students+guests with no staff.',
    e: 'A staff+student group with mixedGroupEnabled off: blocked, raise a staff-only or student-only group.',
    d: 'hasStudent && !studentGroupEnabled blocked; guests present && !groupGuestMixAllowed blocked; hasStaff && hasStudent && !mixedGroupEnabled blocked. Students+guests with no staff is permitted.' },
  { id: 'GRP-3', t: 'Employee members must be valid travellers; cross-department members are allowed', ty: 'Validation', b: 'Hard block', c: 'Fixed', s: '13.14 / 13.13',
    en: 'server - actions.ts:createGroupDraft',
    w: 'A group may name any employee traveller; cross-department routing and per-member inclusion confirmation are the controls, so the per-member creation-remit check is deliberately not applied here.',
    e: 'A selected employee whose isTraveller is false: blocked, one or more selected members are not valid travellers.',
    d: 'invalidMembers = travellerIds.filter(t => !employee(t).isTraveller).' },
  { id: 'GRP-4', t: 'groupType is derived from composition and drives display only', ty: 'Business rule', b: 'Auto-derive', c: 'Fixed', s: '13.14 / 8',
    en: 'server - actions.ts:createGroupDraft',
    w: 'Every runtime rule keys off the per-member traveller type, not the group label.',
    e: 'employee+guest -> MIXED; students only -> STUDENT.',
    d: 'cats = count of {hasStaff,hasStudent,hasGuest}; MIXED if cats >= 2, else STUDENT / GUEST / STAFF. Even split sharePct = round(100/total,2). Student rows keyed S-..., guests G-..., both confirmed true (coordinator/host confirms offline); employee rows confirmed false. Routing anchors on travellerIds[0] ?? requestorId.' },
  { id: 'GRP-5', t: 'Students and guests carry no cost share, no claim, no ODA, and travel Economy', ty: 'Business rule', b: 'Auto-derive + Hard block (attribution safety net)', c: 'Fixed', s: '8 / 13.14 (AC7)',
    en: 'server - traveller.ts:isNonEmployeeMember; saveTrip (guest member -> TC-ECO); submitRequest (guestAttributionViolations)',
    w: 'Non-employee members have no entitlement profile or HR identity.',
    e: 'Any estimate line attributing shared-incidental or ODA cost to a guest: submission blocked with the first violation.',
    d: 'isNonEmployeeMember = isGuest || isStudent (by travellerType or synthetic G-/S- id prefix). Group guest/student members default to Economy; employees get the register-derived entitlement. A lone guest request requires name, email and organisation all present.' },
]);

section('TRP', 'Trip details and dates',
  'Cross-field date validation on the Trip step. Mirrored live in the browser and re-checked on the server (the authority). All are deferred when saving as a draft.', [
  { id: 'TRP-1', t: 'Official end date must be on or after the official start date', ty: 'Validation', b: 'Hard block', c: 'Fixed', s: '4.4 / 4.5',
    en: 'both - TripPlanner.tsx (errors) and actions.ts:saveTrip', w: 'A negative travel window is incoherent.',
    e: 'start 2026-05-10, end 2026-05-08: blocked.', d: 'end < start. Deferred on Save as draft.' },
  { id: 'TRP-2', t: 'The official start date cannot be in the past', ty: 'Validation', b: 'Hard block', c: 'Fixed', s: '4.4',
    en: 'server - actions.ts:saveTrip (not in the client mirror)', w: 'A pre-trip request cannot be raised for a trip that has already departed (catches a mis-keyed year or month).',
    e: 'today 2026-11-10, start 2026-10-01: blocked.', d: 'Compared against start-of-today, so a same-day departure passes. Draft-exempt.' },
  { id: 'TRP-3', t: 'The event window must sit inside the official travel window', ty: 'Validation', b: 'Hard block', c: 'Fixed', s: '10',
    en: 'both - TripPlanner.tsx and actions.ts:saveTrip', w: 'The event is a segment within the official trip.',
    e: 'official 10-15 May, event start 8 May: event start is outside the official travel dates.', d: 'eventEnd < eventStart invalid; event start and event end must both fall within [start, end].' },
  { id: 'TRP-4', t: 'A personal extension must not overlap the official travel dates', ty: 'Validation', b: 'Hard block', c: 'Fixed', s: '4.5 / AC18',
    en: 'both - TripPlanner.tsx and actions.ts:saveTrip', w: 'Personal days extend before or after official business and are excluded from ODA and accommodation, so they must be disjoint.',
    e: 'official 10-15 May, personal 13-17 May: overlap error.', d: 'personalEnd < personalStart invalid. Valid only if personalEnd <= start OR personalStart >= end (a one-sided date is backfilled). The extension must fall wholly before start or wholly after end.' },
  { id: 'TRP-5', t: 'Mandatory Trip fields are enforced on advance; deferred on Save as draft', ty: 'Validation', b: 'Hard block', c: 'Fixed', s: '6.1 / 13.1',
    en: 'both - browser required attributes plus actions.ts:saveTrip', w: 'A partial step may be parked as a draft; completeness is enforced only on advancing.',
    e: 'No purpose and no legs: Please provide travel purpose, at least one itinerary leg with a destination.',
    d: 'Required: purposeId, at least one leg with a destination, start and end, booking arrangement. draft (saveMode) skips the checks.' },
  { id: 'TRP-6', t: 'A group with differing per-traveller itineraries is forced off TMC-online to agent-assisted', ty: 'Business rule', b: 'Auto-correct', c: 'Fixed (per-traveller path gated by groupSubItineraries)', s: '13.20',
    en: 'server - actions.ts:saveTrip and saveTravellerItinerary', w: 'The travel management system cannot book a group online when travellers fly their own legs.',
    e: 'Group submitted as TMC Online; one traveller holds their own itinerary: method stored as agent-assisted, audited, Trip step warns.',
    d: 'If the request is a group, any leg has a travellerId, and the submitted method is TMC Online, the stored method becomes agent-assisted. Also fired live when a per-traveller itinerary is saved while the method is TMC Online.' },
]);

section('ITN', 'Itinerary and destination',
  'Leg validation and the values derived from the legs: main destination, nights, and the travel-class entitlement.', [
  { id: 'ITN-1', t: 'A leg arrival cannot be before its departure', ty: 'Validation', b: 'Hard block', c: 'Fixed', s: '4.4 / 4.5',
    en: 'both - TripPlanner.tsx and actions.ts:saveTrip', w: 'Negative leg duration is impossible.', e: 'leg 1 depart 05-10, arrive 05-09: blocked.', d: 'Per-leg arrive < depart, only when both dates are present.' },
  { id: 'ITN-2', t: 'Each leg must depart within the travel window', ty: 'Validation', b: 'Hard block', c: 'Fixed', s: '4.4 / 4.5',
    en: 'both - TripPlanner.tsx and actions.ts:saveTrip', w: 'A leg outside the (personal-widened) window is out of scope.',
    e: 'window 08-17 May, leg departs 20 May: leg departs outside the travel window.', d: 'Window = min(personalStart, start) to max(personalEnd, end). Check dDep < winStart || dDep > winEnd.' },
  { id: 'ITN-3', t: 'Legs must run in chronological departure order', ty: 'Validation', b: 'Hard block', c: 'Fixed', s: '4.4 / 13.20',
    en: 'both - TripPlanner.tsx and actions.ts:saveTrip', w: 'An itinerary is an ordered sequence of movements.', e: 'leg 2 departs before leg 1 departed: blocked.', d: 'dDep < previous leg departure.' },
  { id: 'ITN-4', t: 'A leg cannot depart a city before you arrive there', ty: 'Validation', b: 'Hard block', c: 'Fixed', s: '4.4 / 13.20',
    en: 'server - actions.ts:saveTrip (not in the client mirror)', w: 'Physical presence: you cannot leave before arriving on the previous leg.',
    e: 'prev leg arrives 05-14, next departs 05-13: blocked.', d: 'dDep < previous leg arrival, only when that arrival date is present; otherwise the depart-order check is the floor.' },
  { id: 'ITN-5', t: 'Nights per leg are auto-computed from the dates, never hand-keyed', ty: 'Business rule', b: 'Auto-derive', c: 'Fixed', s: '4.5 / 13.20',
    en: 'both - TripPlanner.tsx:computeLegNights (display and submitted value); server recomputes in syncAutoEstimates', w: 'The nights column, main destination and budget all agree instead of a manual value drifting.',
    e: 'arrive city A 05-10, next leg departs 05-13: 3 nights.', d: 'nights = max(round((nextDepart - thisArrive)/day), 0); from = arrive ?? depart; to = next.depart ?? next.arrive. The home leg has no onward departure, so 0. The posted value is recomputed server-side.' },
  { id: 'ITN-6', t: 'Main destination = the longest-stay country, then the longest-stay city within it', ty: 'Business rule', b: 'Auto-derive', c: 'Fixed', s: '4.4 / 13.14',
    en: 'both - destination.ts:mainDestination (server save) and TripPlanner.tsx (display)', w: 'One consistent main country/city of travel on Trip save and on Review.',
    e: 'legs BKK 2 nights, TYO 4 nights, OSA 1 night: country JP wins (5 nights), then city TYO (4).', d: 'Nights summed by destination country across non-personal legs; pick max country, then max city within it. Ties broken alphabetically by name (server). Fallback when no nights: the first non-personal leg destination.' },
  { id: 'ITN-7', t: 'Travel class is derived across the whole itinerary; the highest-duration leg wins', ty: 'Business rule', b: 'Auto-derive', c: 'Fixed', s: '13.19',
    en: 'server - actions.ts:saveTrip (entitledForItinerary over the legs)', w: 'Entitlement follows the longest flown leg, not merely the main destination.',
    e: 'an itinerary with a 13-hour and a 4-hour leg: entitlement from the 13-hour leg.', d: 'Each non-personal leg flight duration (from the destination city, not trusted from the form) feeds entitledForItinerary, which takes the highest. Falls back to main-destination hours when no leg carries a duration. See CLS for the duration-to-class tiers.' },
  { id: 'ITN-8', t: 'Contiguous-itinerary origin chaining, preserving a deliberate open-jaw', ty: 'Business rule', b: 'Auto-correct (prefill)', c: 'Fixed', s: '13.14',
    en: 'client - TripPlanner.tsx:setLeg / setStart / setEnd (server backstop for round-trip/one-way)', w: 'The next leg defaults to flying onward from the prior destination, without overwriting a deliberate open-jaw origin.',
    e: 'change leg 1 destination BKK to HKG: leg 2 origin follows to HKG only if it was still the old chained default.', d: 'The next leg origin follows only while empty, equal to this leg previous destination, or the untouched home default. Preset legs track official-date changes only when empty or still on the previous official date.' },
]);

section('DUP', 'Duplicate and overlap detection',
  'The same traveller cannot be on two live trips at once. The check runs live as the itinerary is typed, at the Trip-step gate, and again at submit.', [
  { id: 'DUP-1', t: 'The overlap window is the itinerary footprint (first departure to last arrival), else the official dates', ty: 'Business rule', b: 'Auto-derive', c: 'Fixed', s: '13.x / 25 / 40',
    en: 'both - duplicates.ts:travelWindow and TripPlanner.tsx:dup', w: 'Duty-of-care and double-booking key on where the traveller is physically present (PNR dates), not administrative dates.',
    e: 'official 10-15 May but legs span 09-16 May: window is 09-16 May.', d: 'min/max of all trip-level legs depart+arrive dates, falling back to official start/end when legs carry no dates.' },
  { id: 'DUP-2', t: 'A conflict is a shared employee traveller plus overlapping windows among LIVE requests', ty: 'Business rule', b: 'Auto-derive', c: 'Fixed', s: '13.x',
    en: 'server - duplicates.ts:findDuplicateRequests / findTravellerConflicts', w: 'A person cannot be on two trips at once; non-employees may legitimately appear on multiple hosts trips.',
    e: 'traveller on an Approved TR 10-15 May and a new TR 12-18 May: conflict.', d: 'LIVE statuses: Submitted, Pending RO/Additional/Exception/DOA, Approved, Amendment In Progress. Terminal and plain Drafts excluded. Only employee members anchor the check (guests/students excluded). Overlap test: myStart <= cEnd && cStart <= myEnd.' },
  { id: 'DUP-3', t: 'Same-destination overlap is a true duplicate (hard block); different-destination is a soft warning', ty: 'Validation', b: 'Hard block (same destination) / Soft warning (different)', c: 'Fixed (policy-check row gated by rule DUPLICATE)', s: '13.x / 25 / 40',
    en: 'both - duplicates.ts:findBlockingDuplicates and TripPlanner.tsx:dup; Trip-step gate in actions.ts:saveTrip', w: 'Same traveller, same place, overlapping dates is a re-raise; a different place is a scheduling clash.',
    e: 'two active TRs to Tokyo overlapping: blocked (cancel/amend the original). Tokyo plus London overlapping: amber double-booking notice.',
    d: 'sameDestination = sameCountry && (missing city on either side counts as same). The Trip-step continue gate blocks on ANY overlap (a traveller cannot be on two trips at once); Save as draft stays allowed. The hard submit block is the same-destination subset.' },
]);

section('CLS', 'Travel-class entitlement',
  'An employee entitlement is derived from their effective-dated Travel Policy Group and the flight duration. A class above entitlement is a policy exception.', [
  { id: 'CLS-1', t: 'Entitlement is derived from the effective-dated Travel Policy Group, never a standalone per-employee class', ty: 'Business rule', b: 'Auto-derive', c: 'Fixed', s: '13.7 / 13.19',
    en: 'server - services.ts (EcsTravelClassRegister.entitledForDuration / policyGroup)', w: 'The group is the single source of truth.',
    e: 'an employee maps to group C20 in the register; entitlement derives from C20 tiers.', d: 'The register row where effectiveFrom <= date <= effectiveTo gives the group. Absent from the register: group null, Economy (TC-ECO).' },
  { id: 'CLS-2', t: 'A leg entitled class is the highest policy-group tier whose minimum hours the leg meets, else Economy', ty: 'Business rule', b: 'Auto-derive', c: 'Fixed (tier tables)', s: '13.19',
    en: 'server - services.ts (entitledForDuration)', w: 'Structured duration bands replace free-text class entry.',
    e: 'group B40 on a 5h leg: Premium Economy (meets 4h, not 6h); on a 7h leg: Business.',
    d: 'Picks the tier with hours >= minHours and the largest minHours. Class ranks: Economy 1, Premium Economy 2, Business 3. Example tiers: E10 Economy (no tiers); C-groups Premium Economy from 6h; B-groups Business from 6h (B40 Premium Economy from 4h / Business from 6h; B30 Business from 4h; B20 from 2h; B10/A10 Business from 0h).' },
  { id: 'CLS-3', t: 'Across a mixed itinerary, overall entitlement is the highest per-leg entitled class', ty: 'Business rule', b: 'Auto-derive', c: 'Fixed', s: '13.19 / 13.20',
    en: 'server - services.ts:entitledForItinerary', w: 'The longest-duration leg drives the whole-trip class, not the main destination.',
    e: 'legs of 4h (Premium Economy) and 7h (Business): overall Business.', d: 'Only non-personal legs count. Per-leg hours from the destination city (default 12 when unknown), class from the register; overall = max by rank, seeded at Economy.' },
  { id: 'CLS-4', t: 'In a group every traveller is booked at their own entitled class; no shared chosen class or upgrade justification', ty: 'Business rule', b: 'Auto-derive', c: 'Fixed (gated by groupTravelEnabled)', s: '13.14 / 13.19',
    en: 'server - actions.ts:saveTrip', w: 'The requestor cannot justify an upgrade on a traveller behalf; a per-traveller upgrade requires splitting that person to their own request.',
    e: 'a group of 3 to a 7h destination: each gets their own register-derived class; a C20 member Premium Economy, others Economy.', d: 'For a group, the request-level class = derived entitlement and classJustification is nulled; each traveller chosenClassId = entitledClassId = their own entitlement; guest/non-employee members Economy.' },
  { id: 'CLS-5', t: 'A class above entitlement is a policy exception requiring a justification', ty: 'Validation + Business rule', b: 'Exception (routing) + Hard block if justification missing', c: 'Rule CLASS active; exception step via exceptionApproverRequired', s: '13.19 / AC39',
    en: 'server - policy.ts (CLASS / CLASS_JUSTIFY); also enforced at actions.ts:addAirfare / updateAirfare for an individual line',
    w: 'An upgrade needs a written justification carried to the approver.', e: 'Business requested, entitlement Economy, empty justification: hard stop until a reason is entered.',
    d: 'Exception when rank(chosen) > rank(entitled); evaluated per traveller for groups. Missing classJustification is a hard stop. No M6 split on an exception (M6 is entitlement-based). Routing: see EXC.' },
]);

section('M6', 'M6 travel-class upgrade differential (entitlement split)',
  'When a traveller flies their entitlement, their policy group attracts M6, and the entitlement is above Economy, the entitled fare splits into an Economy base and an M6 differential funded from a separate account. M6 is automatic, not a requested upgrade.', [
  { id: 'M6-1', t: 'An entitled fare above Economy for an M6 group splits into an Economy base plus an M6 differential', ty: 'Business rule', b: 'Auto-derive', c: 'ModuleSettings.upgradeDeltaRoutingEnabled; attracting groups via the PolicyGroupM6 master', s: '13.19',
    en: 'server - upgradeConfig.ts:m6EconomyBaseSgd, captured per line in actions.ts:addAirfare',
    w: 'The Economy-to-entitled premium is funded centrally, separate from the base cost object.',
    e: 'a C20 traveller flies Premium Economy, fare 1500; economy base 1500/(1+0.5)=1000; M6 differential 500.',
    d: 'The economy base is stored on the line as entitlementFareSgd; differential = fare - base. Returns no split when fare <= 0, entitlement at or below Economy, a class above entitlement is set (that is an exception), or the group is null / not in the live M6 set.' },
  { id: 'M6-2', t: 'Economy base = fare / (1 + upliftPct(Economy to entitled)); differential = fare - base (Model B)', ty: 'Business rule', b: 'Auto-derive', c: 'Uplift schedule is a runtime master (UpgradeUpliftRate)', s: '13.19',
    en: 'server - upgradeConfig.ts:deriveEntitlementSgd / upliftPctFrom',
    w: 'Derive the entitlement base from the quoted entitled-class fare using the published class cost indices.',
    e: 'upliftPct(Economy to Business) = 1.2; fare 2200: base 2200/2.2 = 1000; differential 1200.',
    d: 'Returns null when pct is null or <= 0 or fare <= 0. Default schedule = to.costIndex/from.costIndex - 1 (Economy to Premium Economy 0.5, Economy to Business 1.2). Rounded to 2 dp.' },
  { id: 'M6-3', t: 'Only a policy group flagged m6 attracts the differential', ty: 'Business rule', b: 'Auto-derive', c: 'Runtime master PolicyGroupM6 (toggle via setPolicyGroupM6)', s: '13.19',
    en: 'server - services.ts (attractsM6); live set via policyGroups.ts:m6GroupCodes',
    w: 'Only certain groups premiums are M6-funded; the flag lives on the group master.', e: 'in the seed only group C20 is m6:true.', d: 'm6GroupCodes returns the codes with m6:true, passed into the split at capture so it reflects the live master.' },
  { id: 'M6-4', t: 'The NTU-funded differential is reallocated to a separate M6 account (BA-mastered); the base stays on the original allocation', ty: 'Business rule', b: 'Auto-derive', c: 'ModuleSettings.upgradeDeltaRoutingEnabled', s: '13.19 (#14)',
    en: 'server - upgradeConfig.ts:applyDefaultDeltaCodes; CTA posting split in ctaPosting.ts; UI charging/page.tsx',
    w: 'The premium portion is funded from a per-BA M6 pool, keeping the base on the traveller cost object.',
    e: 'base 1000 to the main allocation; differential 500 to the governing BA M6 account.',
    d: 'Governing BA = the main charging allocation business area. In CTA posting the base portion posts across the allocation (Economy base) and the differential posts as a single line to the M6 cost centre (M6 differential).' },
  { id: 'M6-5', t: 'The M6 account auto-fills from the BA default/sole account; a choice is forced only when several exist and selection is required', ty: 'Business rule', b: 'Auto-derive', c: 'ModuleSettings.upgradeDeltaSelectionRequired / upgradeDeltaRoutingEnabled', s: '13.19 (#14)',
    en: 'server - upgradeConfig.ts:effectiveDeltaCode / applyDefaultDeltaCodes',
    w: 'Minimise traveller input; prompt only when genuinely ambiguous.', e: 'a BA with one M6 account auto-picks; a BA with two and selection required stays null until a pick.',
    d: 'Keep a valid existing choice; if the pool has one, use it; if selection is not required, use the BA default (flagged, else first); else null to force a pick. Only NTU-funded upgrade airfare lines are touched.' },
  { id: 'M6-6', t: 'An NTU-funded differential with no valid routable account blocks submission', ty: 'Validation', b: 'Hard block', c: 'Rule UPGRADE_M6 active and upgradeDeltaRoutingEnabled (third branch also upgradeDeltaSelectionRequired)', s: '13.19 (#14)',
    en: 'server - policy.ts (UPGRADE_M6 check)', w: 'The differential cannot be left unroutable.',
    e: 'the governing BA has no active M6 account: hard stop, no active M6 account configured for the BA.',
    d: 'Three branches: pool empty; the chosen account not in the active BA pool; no account chosen with pool > 1 and selection required.' },
  { id: 'M6-7', t: 'Upgrade funding is always NTU for M6; a legacy SELF branch survives only for backward data safety', ty: 'Business rule', b: 'Auto-derive', c: 'Fixed', s: '13.19',
    en: 'server - upgrade.ts:airfareUpgrade; CTA treatment in ctaPosting.ts',
    w: 'M6 is an org-funded entitlement, so funding is always NTU; the SELF branch is only for legacy rows.',
    e: 'NTU-funded upgrade: whole fare is NTU, traveller pays 0. A legacy SELF row: NTU pays the entitlement base, traveller pays the delta.',
    d: 'isUpgrade = entitlement > 0 and fare > entitlement. A self-funded delta is excluded from the approval amount (see AMT) and reduces the central charge to the entitlement.' },
]);

section('EST', 'Cost estimates',
  'Accommodation, ODA and airfare lines are derived from the itinerary and policy, then editable. Airfare can be seeded from a Trip-step amount. FX is locked at submission.', [
  { id: 'EST-1', t: 'The budgeted nightly rate follows the hotel estimate basis', ty: 'Business rule', b: 'Auto-derive', c: 'ModuleSettings.hotelEstimateBasis (QUOTED / CAP / LOWER)', s: '4.5',
    en: 'server - pricing.ts:computeAccommodation', w: 'A policy-configurable choice between the quoted rate, the city cap, or the lower of the two.',
    e: 'quoted 300, cap 250: LOWER 250, CAP 250, QUOTED 300.', d: 'capNightly = city cap, else country cap. LOWER = min(quoted, cap || quoted).' },
  { id: 'EST-2', t: 'Accommodation cost = budgeted nightly times chargeable nights (personal nights excluded)', ty: 'Business rule', b: 'Auto-derive', c: 'Fixed', s: '4.5 / AC18',
    en: 'server - pricing.ts:computeAccommodation', w: 'Personal nights are not NTU-funded.', e: '5 nights, 1 personal, budgeted 200: 4 x 200 = 800.', d: 'chargeableNights = max(nights - personalNights, 0).' },
  { id: 'EST-3', t: 'A nightly rate above the city cap is an exception needing a justification or a conference-hotel flag', ty: 'Validation', b: 'Hard block at the point of adding/editing the line', c: 'Fixed', s: '4.5',
    en: 'server - computeAccommodation outcome, enforced in actions.ts:addAccommodation / updateAccommodationRate', w: 'Above-cap spend is a policy exception; a conference hotel is self-justifying.',
    e: 'Tokyo cap 250, enter 400 with no note and conference unticked: blocked.', d: 'overCap = quoted > cap. Blocked unless conferenceHotel is ticked or a justification note is present. Also hard-stopped at submit by the HOTEL_CAP / HOTEL_JUSTIFY policy check (see EXC).' },
  { id: 'EST-4', t: 'One hotel line is auto-derived per overnight non-personal stop (home SIN excluded)', ty: 'Business rule', b: 'Auto-derive (re-derived on every dates/legs change)', c: 'ModuleSettings.hotelEstimateBasis (rate)', s: '4.5',
    en: 'server - actions.ts:syncAutoEstimates', w: 'The full expected hotel set is on Estimates without manual entry.',
    e: 'legs SIN to TYO (4 nights) to SIN: one auto hotel line, TYO, 4 nights at cap.', d: 'One line per stop x traveller. A stop = a destination city that is not home with nights > 0. A dates/legs change resets an edited nightly rate to the city cap; an unrelated edit keeps it. Manual lines are never touched.' },
  { id: 'EST-5', t: 'ODA is duration-tiered: days 1-15 at 100%, 16-31 at 75%, 32+ at the monthly rate over 30', ty: 'Business rule', b: 'Auto-derive', c: 'Fixed (tier constants)', s: '13.7',
    en: 'server - pricing.ts:computeOdaTiered, used by syncAutoEstimates', w: 'Long-stay ODA steps down.',
    e: '40 days, daily 120, monthly 2200: 15x120x100% + 16x120x75% + 9x(2200/30) = 1800 + 1440 + 660 = 3900.', d: 't1 = min(days,15); t2 = max(0, min(days,31)-15); t3 = max(0, days-31). Trips of 15 days or fewer are unaffected (full daily rate).' },
  { id: 'EST-6', t: 'One ODA line is auto-derived per stop per employee traveller; guests are excluded; a no-rate country yields no line', ty: 'Business rule', b: 'Auto-derive (+ hard block on a guest ODA pick in the manual form)', c: 'Fixed', s: '8 / 13.7',
    en: 'server - actions.ts:syncAutoEstimates; manual addOda rejects a guest; group.ts:guestAttributionViolations', w: 'ODA is an employee entitlement with no guest settlement path.',
    e: 'a group of 2 employees + 1 guest to Tokyo: 2 ODA lines, none for the guest.', d: 'Group ODA travellers = non-guest members; an individual guest request gets none. A country with no configured ODA rate yields no line.' },
  { id: 'EST-7', t: 'A Trip-step airfare estimate seeds the Estimates airfare line(s)', ty: 'Business rule', b: 'Auto-derive (seed/refresh)', c: 'Fixed', s: '4.5 / 13.20',
    en: 'server - actions.ts:saveTrip and syncItineraryAirfare', w: 'One fare per journey, pre-seeded so Estimates is not empty.',
    e: 'Trip airfare 1200: one Airfare line (individual) at the entitled class; a group gets one per traveller.',
    d: 'Individual gets one line; a group gets one per traveller seeded with the traveller own figure, else the shared figure. Origin = first non-personal leg origin; destination = first non-home leg destination. The line is editable/removable (marked itinerary-sourced via itinerarySgd); lines fly the entitlement with the M6 split applied.' },
  { id: 'EST-8', t: 'The Trip-step airfare amount is the master; it overwrites a manual Estimates edit and raises an alert', ty: 'Business rule', b: 'Auto-correct (overwrite) + alert', c: 'Fixed', s: '4.5 / 13.20',
    en: 'server - actions.ts:syncItineraryAirfare', w: 'The Trip-step figure governs the airfare line; a divergence means an Estimates edit to replace.',
    e: 'Trip 1200, Estimates edited to 1500, re-save Trip: line reset to 1200, alert that the 1500 figure was replaced.',
    d: 'Re-applied on every trip save. Alert raised only when the stored amount differs from the last synced amount and from the new amount. A removed line is re-created on the next save. A sole pre-existing manual airfare line is adopted rather than duplicated; clearing the Trip field drops a still-untouched line.' },
  { id: 'EST-9', t: 'Every estimate amount must be greater than zero', ty: 'Validation', b: 'Hard block', c: 'Fixed', s: '4.5',
    en: 'server - add/update actions for airfare, per-leg airfare, accommodation, hotel rate, ODA, other', w: 'A zero or negative estimate line is meaningless.',
    e: 'airfare amount 0: Airfare amount must be greater than 0.', d: 'Airfare/Other: foreign > 0. Accommodation: city and nights > 0 and nightly > 0. ODA: country, arrive, depart with depart >= arrive. Per-leg airfare: each leg needs amount, origin and destination (blanks skipped); at least one valid leg.' },
  { id: 'EST-10', t: 'Foreign-currency lines are converted at the entry-date rate and re-locked at submission', ty: 'Business rule', b: 'Auto-derive', c: 'Fixed', s: '13.4',
    en: 'server - add/update actions (EcsFx.toSgd) and actions.ts:relockFx at submission', w: 'The SGD value is fixed at submission for approval certainty.',
    e: 'USD 1000 at 1.34: SGD 1340; at submit the rate is 1.36: re-locked to SGD 1360.', d: 'At submission every non-SGD line with a foreign amount is recomputed at the submission-date rate. SGD lines are untouched.' },
  { id: 'EST-11', t: 'A travel purpose pre-seeds its declarable cost items for staff as editable placeholders', ty: 'Business rule', b: 'Auto-derive (additive, idempotent)', c: 'ModuleSettings.purposeDrivenItems; ModuleSettings.expenseScope', s: '4.4',
    en: 'server - actions.ts:syncPurposeItems (from saveTrip)', w: 'The full expected cost-item set is present without relying on the traveller to remember each one.',
    e: 'a Conference purpose with registration and per-diem items: placeholder lines pre-created at standard cost.',
    d: 'Skips airfare/accommodation/ODA (own flows), a guest request, and all non-employee members. MAJOR_ONLY limits to major-cost types. Never touches an existing line and never re-adds a type the traveller deleted.' },
  { id: 'EST-12', t: 'Airfare and ODA are always individual; accommodation is per-traveller; other lines can be shared', ty: 'Business rule', b: 'Auto-derive', c: 'Fixed', s: '13.14',
    en: 'server - add actions (travellerFanout / isShared)', w: 'Each traveller books, pays and claims their own airfare, room and per-diem.',
    e: 'an All-travellers airfare pick: one airfare line per traveller.', d: 'The All-travellers sentinel fans out one line per traveller. A shared Other line is a single line (travellerId null, isShared true).' },
  { id: 'EST-13', t: 'A shared line is split across employee members only; guests carry no slice', ty: 'Validation + Business rule', b: 'Auto-derive (+ data safety net)', c: 'Fixed', s: '8 / 13.14',
    en: 'server - group.ts:sharingMembers / computeTravellerShares / guestAttributionViolations', w: 'A guest or student has no claim, so their slice of a shared incidental would be unsettleable.',
    e: '2 employees + 1 guest, shared taxi 300: split 150/150, guest 0.', d: 'n = employee members (non-employees excluded). guestAttributionViolations flags a shared line whose share map names a guest, or an ODA line attributed to a guest.' },
  { id: 'EST-14', t: 'Shared accommodation is date-aware: each traveller room = nightly times their own nights at that city', ty: 'Business rule', b: 'Auto-derive', c: 'Fixed', s: '13.20',
    en: 'server - group.ts:travellerNightsAtCity / travellerAccommodationSgd; recomputeSharedAccommodation', w: 'A traveller who extends their stay bears the extra room cost; others inherit shared dates.',
    e: 'shared Tokyo hotel 200/night, A 4 nights, B 6 nights: total 200x10 = 2000; A share 800, B share 1200.', d: 'Nights from each traveller effective sub-itinerary (own legs if any, else shared); personal legs excluded.' },
  { id: 'EST-15', t: 'A per-traveller sub-itinerary is gated by groupSubItineraries; an empty one reverts to shared', ty: 'Business rule', b: 'Auto-derive', c: 'ModuleSettings.groupSubItineraries', s: '13.20',
    en: 'server - actions.ts:saveTravellerItinerary; effectiveLegs', w: 'A traveller may deviate with their own legs; off = one shared itinerary only.',
    e: 'with the toggle on, traveller B sets their own return date: B ODA/hotel re-derive on B route; clearing B legs reverts B to shared.', d: 'Returns early when the toggle is off. Posted legs replace the traveller own legs; empty reverts. Own airfare is cleared on revert. Then estimates are re-derived.' },
]);

section('CHG', 'Charging, allocation and settlement',
  'Funding is captured in one of three entry modes, must fully account for the cost, and resolves to a canonical allocation that drives DOA routing. Settlement channel decides what is central-billed versus claimed.', [
  { id: 'CHG-1', t: 'The request-level charging allocation must total exactly 100%', ty: 'Validation', b: 'Hard block', c: 'Fixed', s: '6.3 / 13.14',
    en: 'server - policy.ts (ALLOC check)', w: 'Funding must fully account for the cost; the effective split drives DOA routing.',
    e: 'two rows 60% + 30% = 90%: Allocations total 90.0%; must equal 100%.', d: 'abs(total - 100) > 0.001 is a hard stop; zero allocations is a hard stop. A draft is seeded with a single 100% main allocation at create.' },
  { id: 'CHG-2', t: 'Charging is captured as MAIN (single 100%), CLAIM (request split) or ITEM (per-line split), all rolled up identically', ty: 'Business rule', b: 'Auto-derive', c: 'ModuleSettings.chargingSplitMode (CLAIM rows)', s: '17',
    en: 'server - chargingRollup.ts:resolveChargingRows / rollupByCode; actions.ts:saveCharging', w: 'Whatever the entry mode, the canonical effective split that drives routing and review is produced identically.',
    e: 'ITEM mode: airfare to WBS-A, hotel to CC-B, rolled up to request-level percentages.', d: 'MAIN: one 100% row. CLAIM: up to 50 request-level rows. ITEM: each expense net split across its line allocations, rolled up by code. Per-line splits are stored only when a genuine multi-account split exists.' },
  { id: 'CHG-3', t: 'Percent mode is a percentage of NTU-funded; amount mode is SGD normalised to percentages', ty: 'Business rule', b: 'Auto-derive', c: 'ModuleSettings.chargingSplitMode', s: '17',
    en: 'server/client - chargingRollup.ts:rollupRequestRows', w: 'Either basis yields the same normalised split.', e: 'amount mode rows 3000 + 1000: 75% / 25%.', d: 'Amount: percent = amount / total x 100. Percent: amount = percent/100 x ntuFunded.' },
  { id: 'CHG-4', t: 'Every allocation code must resolve to a known, active charging master; unknown or closed codes hard-stop', ty: 'Validation', b: 'Hard block', c: 'FUNDING always on; FUNDING_INACTIVE gated by its rule', s: '25',
    en: 'both - policy.ts (FUNDING / FUNDING_INACTIVE); create-screen validates against the active master', w: 'You cannot charge to a non-existent or closed cost object.',
    e: 'an allocation to a closed WBS: the account is closed, select an active account.', d: 'FUNDING: an unknown code hard-stops. FUNDING_INACTIVE: an inactive master hard-stops. TR-02 create falls back to the profile default when the chosen code is absent or inactive.' },
  { id: 'CHG-5', t: 'The charging account isResearch flag sets the research classification, which drives routing, PI self-approval and non-term eligibility', ty: 'Business rule', b: 'Auto-derive', c: 'Feeds researchPiSelfApproval / selfApprovalLimitSgd / nonTermAutoApprove / sameRouteResearch', s: '13.x (#1)',
    en: 'server - seedDefaultCharging / saveCharging copy master.isResearch onto the allocation', w: 'Research funding is a property of the chosen cost object, not a separate flag.',
    e: 'a research WBS raised by a PI within the limit: self-approved (the PI is the DOA).', d: 'allocation.isResearch = master.isResearch. Changing charging to a non-research account while a non-term declaration stands is a submit-blocking validation (see NTR-3).' },
  { id: 'CHG-6', t: 'Accommodation is central-billed (CTA) only on a TMC arrangement and only when the requestor chose CTA; otherwise INDIVIDUAL', ty: 'Validation / Business rule', b: 'Auto-correct (CTA downgraded to INDIVIDUAL when not TMC)', c: 'Fixed (channel per DD-19; depends on booking arrangement)', s: '8 / DD-19',
    en: 'server - actions.ts:setHotelSettlement; settlement.ts:lineSettlement / hotelCtaAvailable', w: 'You cannot central-bill a room the traveller self-arranges.',
    e: 'a self-booked trip with CTA selected: stored as INDIVIDUAL.', d: 'CTA only when posted CTA and the arrangement is a TMC one. Applies whole-trip to all hotel lines. Airfare is always central under a TMC arrangement (EMPLOYEE when self-booked); ODA/other always EMPLOYEE. A central line is reference-only, not reimbursable.' },
  { id: 'CHG-7', t: 'A guest cost is settled centrally and charged to the host (requestor) department; guests carry no share of shared lines', ty: 'Business rule', b: 'Auto-derive', c: 'guestSettlementMethod constant (default CTA)', s: '8',
    en: 'server - settlement.ts:guestSettlements / hostCostObject; shared-line exclusion in charging/page.tsx', w: 'Guests have no profile, no login and file no claim.',
    e: 'guest airfare direct-billed to the designated CTA, cleared to the host default charging code.', d: 'Guest cost object = an explicitly charged guest line, else the host cost object. Direct-billable categories: airfare and accommodation only. The auto-by-department split excludes guest ids.' },
  { id: 'CHG-8', t: 'Settled CTA charges post to SAP on receipt from the TMC, idempotently, driven by the feed breakdown', ty: 'Business rule', b: 'Routing (SAP posting)', c: 'Fixed (settlement gate; CTA-to-GL is a maintainable master)', s: 'DD-30 / DD-31',
    en: 'server - ctaPosting.ts:postCtaChargesForRequest / computeCtaPostings / chargesOf', w: 'Central-settled charges post at receipt, not at claim; the feed figures are authoritative.',
    e: 'an airfare charge: Dr expense GL (split across the approved allocation) + Dr input GST + Cr CTA clearing GL.', d: 'Eligible when booking status is Booked or Travel Completed and ctaCharged. One posting per booking+charge type (idempotent). An NTU M6 upgrade posts the base across the allocation and the differential to the M6 cost centre. ECS re-derives the tax and flags a mismatch but posts the feed figures. An unmapped clearing GL fails the posting.' },
  { id: 'CHG-9', t: 'On cancellation/refund only the refunded amount reverses; a non-refundable penalty stays posted', ty: 'Business rule', b: 'Routing (auto-reversal)', c: 'Fixed', s: 'DD-31',
    en: 'server - ctaPosting.ts:reverseCtaChargesForRequest', w: 'A retained penalty is a real cost and must stay on the books.',
    e: 'airfare SGD 1000 refunded less a SGD 75 penalty: reverse 925, retain 75 against airfare.', d: 'The penalty is retained against charges in order airfare, fee, car, visa, accommodation. The reversing entry flips Dr/Cr scaled by refunded/gross; no penalty reverses the whole gross.' },
]);

section('RTE', 'Approval routing and the workflow engine',
  'Routing is a stored, effective-dated decision tree (amount tiers plus decision points) evaluated over request facts, then resolved to named approvers. The seeded TR_STANDARD scenario reproduces the hard-coded route and is editable at runtime.', [
  { id: 'RTE-1', t: 'Routing is a data-driven, runtime-editable decision tree', ty: 'Business rule', b: 'Routing', c: 'ModuleSettings facts; the scenario is DB-stored and editable', s: '2.3 / 6.2',
    en: 'server - workflowScenario.ts:evaluateScenario over route.ts:gatherWorkflowFacts; resolver route.ts:resolveSpecs; buildRoute', w: 'A new condition or step is a tree edit, not a code change.',
    e: 'evaluate picks the amount tier, applies SKIP/ADD/REPLACE/AUTO_GRANT decision points, sorts by canonical order, then resolves each spec to a person.',
    d: 'Canonical order: Additional 10, RO 20, Exception 50, Dean 55, Provost 60, DOA/ResearchDOA 70. The active scenario is the first enabled stored TRAVEL_REQUEST scenario, else the TR_STANDARD constant.' },
  { id: 'RTE-2', t: 'The base route is RO then DOA at tier 1', ty: 'Business rule', b: 'Routing', c: 'ModuleSettings decision points; tiers editable', s: '6.2',
    en: 'server - workflowScenario.ts:TR_STANDARD_SCENARIO.tiers', w: 'RO is the reporting-officer check; DOA is the delegation of authority.',
    e: 'individual employee, SGD 3000: RO then DOA.', d: 'A single amount tier (0 to infinity) with levels RO and DOA.' },
  { id: 'RTE-3', t: 'DOA is always required; its tier is picked from the amount band', ty: 'Business rule', b: 'Routing', c: 'ModuleSettings.approvalAmountBasis (amount); bands in data/workflow.ts', s: '13.7 / 51',
    en: 'server - resolveSpecs BAND_DOA; data/workflow.ts:bandForAmount', w: 'The DOA tier scales with the amount.',
    e: 'approval amount SGD 12,000: DOA-2 of the highest-charging department line.', d: 'Bands: 0 to 5,000 DOA-1; 5,000.01 to 20,000 DOA-2; over 20,000 DOA-3. DOA line = the highest-charging department doaLine (tie-break to the requestor department). A traveller-selected DOA overrides. Cross-charge authority belongs to this DOA; there is no separate Funding-Owner step.' },
  { id: 'RTE-4', t: 'The DOA is defaulted when exactly one candidate exists, otherwise the traveller must pick', ty: 'Validation', b: 'Hard block', c: 'ModuleSettings.sameRouteResearch (research line)', s: '13.14 / decision 1',
    en: 'server - actions.ts:submitRequest using route.ts:doaCandidatesFor', w: 'The DOA system may return several people; the traveller chooses, self excluded.',
    e: 'two eligible DOAs and none chosen: submission blocked until one is selected.', d: 'effectiveDoa = selected || (one candidate ? that : none). Candidates = the DOA line from the band tier upward, excluding travellers and requestor.' },
  { id: 'RTE-5', t: 'RO is dropped for a group and for a guest request', ty: 'Business rule', b: 'Routing (SKIP RO)', c: 'Intrinsic facts; editable', s: '6.2',
    en: 'server - workflowScenario.ts decision points', w: 'A group is one request; an external guest has no NTU reporting officer.',
    e: 'a group request: RO skipped, straight to DOA.', d: 'isGroup -> SKIP RO; isGuest -> SKIP RO.' },
  { id: 'RTE-6', t: 'RO is the first reporting-line officer not in the self-approval set', ty: 'Business rule', b: 'Routing', c: 'Fixed', s: '13.5',
    en: 'server - route.ts:resolveRoStep', w: 'Walk up the reporting line so the traveller own manager-self is skipped.',
    e: 'the RO is the traveller themselves: escalate to the next manager up.', d: 'Up to 12 hops via reportingOfficerId; no RO step if the chain is exhausted.' },
  { id: 'RTE-7', t: 'DOA is skipped for a senior-manager (EXECUTIVE) traveller, re-added if the trip is research', ty: 'Business rule', b: 'Routing (SKIP then conditional ADD)', c: 'Fixed (ECS-mirrored); editable', s: '6.2',
    en: 'server - workflowScenario.ts decision points', w: 'Ports the ECS expense-claim rules to the Travel Request.',
    e: 'an executive traveller, non-research: DOA skipped; the same traveller on a research WBS: DOA added back.', d: 'seniorManager = workerType EXECUTIVE.' },
  { id: 'RTE-8', t: 'DOA is skipped when charging the traveller own default account and the amount is 500 or less', ty: 'Business rule', b: 'Routing (SKIP DOA)', c: 'Fixed threshold 500; editable', s: '6.2',
    en: 'server - workflowScenario.ts decision point; fact chargingIsDefaultAccount', w: 'A small spend on one own Workday default account needs no DOA.',
    e: 'SGD 400 on the traveller Workday default account: DOA skipped.', d: 'main allocation code equals the employee default charging code, and approval amount <= 500.' },
  { id: 'RTE-9', t: 'Research-WBS trips route to the Research DOA line and skip RO', ty: 'Business rule', b: 'Routing', c: 'ModuleSettings.sameRouteResearch (on = normal line, no diversion)', s: '6.2 / 13.14',
    en: 'server - route.ts:isResearchRequest; research-line resolution; workflowScenario.ts (skip RO)', w: 'Research funding has its own DOA authority line.',
    e: 'a research WBS with sameRouteResearch off: ResearchDOA on the department research line; RO skipped.', d: 'researchRoute = isResearchRequest && !sameRouteResearch. isResearchRequest = any allocation isResearch, or req.isResearch. The research line falls back to the normal DOA line when none is configured.' },
  { id: 'RTE-10', t: 'An optional requestor-selected additional approver is added first at submission', ty: 'Business rule', b: 'Routing (ADD, order 10)', c: 'Present only when selected', s: '23',
    en: 'server - workflowScenario.ts decision point; submitRequest', w: 'The requestor may add any approver, never the traveller.',
    e: 'the requestor picks an additional approver: inserted first.', d: 'Dropped if the selected id equals the traveller.' },
  { id: 'RTE-11', t: 'The first pending step sets the request Pending-* status', ty: 'Business rule', b: 'Routing (status derivation)', c: 'Fixed', s: '13.1',
    en: 'server - route.ts:statusForStep', w: 'The umbrella status reflects whose decision is outstanding.',
    e: 'first pending step Exception: status Pending Exception Approval.', d: 'RO -> Pending RO; Additional -> Pending Additional; Exception -> Pending Exception; Dean -> Pending Dean Recommendation; Provost -> Pending Provost; else Pending DOA.' },
]);

section('EXC', 'Policy exceptions',
  'Policy outcomes are Pass, Warning, Exception or Hard stop. A hard stop blocks submission; an exception is allowed through exception approval; a warning is informational. Rule activity and thresholds are configurable.', [
  { id: 'EXC-1', t: 'A hard-stop policy outcome blocks submission; an exception routes through exception approval', ty: 'Validation', b: 'Hard block (hard stop) / Routing (exception)', c: 'Rule activity via policyRules; data-driven rules via Policy Configuration', s: '6.3 (AC06)',
    en: 'server - policy.ts:evaluatePolicies + policyConfigEval.ts; persistPolicy / submitRequest', w: 'A hard stop blocks; an exception is allowed with approval; a warning is informational.',
    e: 'allocations not 100%: hard stop. Hotel above cap: exception.', d: 'Structural hard stops include missing/invalid dates, past departure, leg overlap, allocation not 100%, unknown/inactive charging code, no estimate line, an unresolved M6 account, and the two justification hard stops (CLS-5, EXC-3).' },
  { id: 'EXC-2', t: 'A class above entitlement is an exception requiring a justification', ty: 'Validation + Business rule', b: 'Exception + Hard block if justification missing', c: 'Rule CLASS active; exception step via exceptionApproverRequired', s: '13.19 / AC39',
    en: 'server - policy.ts (CLASS / CLASS_JUSTIFY); also at airfare add', w: 'An upgrade needs a written justification and approval.', e: 'Business over Economy with no comment: CLASS_JUSTIFY hard stop.', d: 'Per traveller for groups. See CLS-5 for the entitlement derivation.' },
  { id: 'EXC-3', t: 'Accommodation above cap is an exception; a written justification is required unless it is a conference hotel', ty: 'Validation + Business rule', b: 'Exception + Hard block if justification missing', c: 'Rule HOTEL_CAP active', s: '4.5',
    en: 'server - policy.ts (HOTEL_CAP / HOTEL_JUSTIFY)', w: 'An above-cap rate must be justified; a conference hotel is self-justifying.',
    e: 'a rate above the city cap with an empty note: HOTEL_JUSTIFY hard stop; the same line flagged conference hotel routes as an exception with no written justification.', d: 'overCap = quoted > cap (see EST-3).' },
  { id: 'EXC-4', t: 'An exception that needs approval inserts an Exception Approver before the DOA; otherwise it surfaces to the DOA', ty: 'Business rule', b: 'Routing (ADD Exception, order 50) or surface-to-DOA', c: 'ModuleSettings.exceptionApproverRequired; per-code map', s: '6.2 / 26',
    en: 'server - workflowScenario.ts decision point; submitRequest via policyThresholds.exceptionNeedsApproval', w: 'Some exceptions need a dedicated reviewer; others are justification-only and ride to the DOA.',
    e: 'a hotel-cap exception with the setting on: an Exception Approver step is added; with it off: no step, the justification is on file for the DOA.', d: 'Fires when there is a policy exception and the setting is on. CLASS and HOTEL_CAP need approval by default.' },
  { id: 'EXC-5', t: 'A guest travel-class upgrade routes to the Provost ahead of the DOA', ty: 'Business rule', b: 'Routing (ADD Provost, order 60)', c: 'ModuleSettings.guestUpgradeProvostId; applicability is a workflow decision', s: '8 / DD-25',
    en: 'server - workflowScenario.ts decision point; resolveSpecs (Provost)', w: 'A guest upgrade is the Provost to authorise; who the Provost is comes from the setting, whether it applies is a workflow decision.',
    e: 'a guest in Business above Economy: Provost step added; the CLASS exception is excluded from the generic Exception step.', d: 'Fires on guest + a CLASS exception. Dropped if the configured Provost is a traveller.' },
  { id: 'EXC-6', t: 'An optional Dean recommendation step precedes the Provost on a guest upgrade', ty: 'Validation + Business rule', b: 'Routing (ADD Dean, order 55) + Hard block if not selected', c: 'ModuleSettings.guestUpgradeDeanStep', s: '8 / DD-25',
    en: 'server - workflowScenario.ts decision point; submitRequest (selection); resolveSpecs (Dean)', w: 'A Dean recommends the upgrade before the Provost sees it.',
    e: 'the Dean step on, a guest upgrade, no Dean selected: Select the recommending Dean before submitting.', d: 'Fires on guest + a CLASS exception + the setting on. The requestor selects any staff member as the Dean.' },
]);

section('NTR', 'Non-term research',
  'Research-funded trips in non-teaching time can be fast-tracked: the non-term flag is derived from the teaching calendar, and with offline-approval evidence and no open exception the approvers are auto-granted.', [
  { id: 'NTR-1', t: 'The non-term lane is offered only on research-funded trips', ty: 'Business rule', b: 'Routing (gates availability)', c: 'Fixed (driven by charging isResearch)', s: '13.x',
    en: 'server - nonTerm.ts:nonTermResearchEligible', w: 'Offline approval already exists only for research-funded travel.',
    e: 'a research WBS allocation: lane available; switch to a non-research account: lane removed.', d: 'Any allocation code isResearch, or before charging the traveller Workday default is research.' },
  { id: 'NTR-2', t: 'Non-term time is derived from the teaching calendar; manual attestation is only an out-of-calendar fallback', ty: 'Business rule', b: 'Auto-derive', c: 'Fixed (calendar data)', s: '13.x',
    en: 'server - academicCalendar.ts:deriveNonTermTime; applied in saveTrip / submitRequest', w: 'The flag is objective when the window is inside the loaded calendar.',
    e: 'the whole travel window inside a recess week: non-term true; the window overlaps any teaching or exam day: false.', d: 'Non-term iff the window is within the loaded terms and has zero teaching/exam days (a break day overrides an overlapping teaching span). Outside coverage, the posted attestation checkbox is the fallback.' },
  { id: 'NTR-3', t: 'A standing non-term declaration on a now-non-research trip blocks submission', ty: 'Validation', b: 'Hard block', c: 'Fixed', s: '13.x',
    en: 'server - actions.ts:submitRequest', w: 'The declaration is not silently cleared when the charging changes.',
    e: 'non-term declared, then charging moved to a non-research account: blocked until the declaration is cleared.', d: 'Blocks when nonTermDeclared && !nonTermResearchEligible.' },
  { id: 'NTR-4', t: 'Approvers stay named but their steps are auto-granted for a research non-term trip with offline-approval evidence', ty: 'Business rule', b: 'Auto-grant', c: 'ModuleSettings.nonTermAutoApprove', s: '13.x',
    en: 'server - workflowScenario.ts AUTO_GRANT decision point; submitRequest', w: 'Offline approval is already obtained; the pre-trip is fast-tracked, but approvers remain on the route for audit.',
    e: 'research WBS, non-term derived true, offline-approval e-mail attached, no exception: RO/DOA/ResearchDOA auto-granted; the TA issues immediately.', d: 'Requires nonTermAutoApprove, a research request, nonTermDeclared, a non-term offline-approval attachment, and no exception. The AUTO_GRANT verb stamps the named steps Approved on submission.' },
]);

section('EMG', 'Emergency lane',
  'The emergency (book-first) lane is determined by the system at submit from lead time and a book-ahead method. It is never a traveller opt-in. The full approval route still runs retrospectively while the booking is handed off concurrently.', [
  { id: 'EMG-1', t: 'The emergency lane is auto-set at submit from short lead time AND a book-ahead method', ty: 'Business rule', b: 'Routing (lane assignment)', c: 'ModuleSettings.emergencyLeadDays', s: '13.x / DD-23',
    en: 'server - emergency.ts:qualifiesForEmergency; submitRequest', w: 'The system, not the traveller, decides urgency; only a channel that can place a booking ahead of approval qualifies.',
    e: 'earliest departure 9 days out, method agent-assisted: emergency lane; the same lead time but TMC-online: not on the lane.', d: 'leadTimeDays <= emergencyLeadDays AND the method is agent-assisted or offline. An undated request never qualifies. leadTimeDays = floor((earliest departure - now)/day).' },
  { id: 'EMG-2', t: 'Mode A requires the approving DOA authorising e-mail before submit; Mode B does not', ty: 'Validation', b: 'Hard block (Mode A) / none (Mode B)', c: 'ModuleSettings.emergencyEvidenceRequired', s: 'DD-23',
    en: 'server - submitRequest using emergency.ts:hasEmergencyApproval', w: 'The DOA is the authoriser for a book-first trip; Mode A captures the go-ahead e-mail.',
    e: 'auto-qualifies for emergency, Mode A, no e-mail attached: attach the approving DOA authorising e-mail before submitting.', d: 'Blocks when on the emergency lane, Mode A, and no emergency-approval attachment. Mode B floats through the normal approval.' },
  { id: 'EMG-3', t: 'The full approval route still runs retrospectively; only the TMC hand-off goes out concurrently on submit', ty: 'Business rule', b: 'Routing + concurrent hand-off', c: 'Fixed', s: '13.x / DD-23',
    en: 'server - route.ts:resolveSpecs (emergency note); submitRequest fires handoffToTmc on submit', w: 'Book-first, raise-later; the DOA ratifies retrospectively.',
    e: 'an emergency trip submitted: every step flagged retrospective ratification; the booking is handed off immediately.', d: 'emergencyAuthoriserId = the PI (if PI self-approval) else the effective DOA. The hand-off emergency branch relaxes the must-be-approved gate.' },
  { id: 'EMG-4', t: 'An urgent TMC-online trip can be switched inline to a book-ahead method on Review', ty: 'Business rule', b: 'Auto-correct (method switch)', c: 'Fixed', s: 'DD-23',
    en: 'server - actions.ts:updateBookingMethod; emergency.ts:urgentButNotBookAhead', w: 'Lets an urgent request join the emergency lane without returning to the Trip step.',
    e: 'urgent, TMC-online: the requestor picks agent-assisted on Review, and the lane becomes available.', d: 'Only Draft status, only a TMC arrangement, only agent-assisted or offline accepted; the itinerary and provider are untouched.' },
]);

section('PSA', 'PI self-approval',
  'A research Principal Investigator who is an eligible DOA, within the self-approval band, becomes their own DOA. This is the one sanctioned exception to self-approval prevention.', [
  { id: 'PSA-1', t: 'A research PI who is an eligible DOA, within the limit, is assigned as their own DOA', ty: 'Business rule', b: 'Routing (REPLACE DOA with the traveller)', c: 'ModuleSettings.researchPiSelfApproval / selfApprovalLimitSgd / sameRouteResearch', s: '13.x / #1 / 43',
    en: 'server - workflowScenario.ts PI_SELF_APPROVAL conditions + REPLACE DOA->SELF; submitRequest; resolveSpecs (SELF); route.ts:travellerIsEligibleDoa', w: 'A PI with sufficient DOA authority can self-approve small research trips.',
    e: 'research WBS, non-group, the traveller is a PI in the research DOA line at the required tier, amount SGD 4000 <= 5000: the DOA step is assigned to the PI.',
    d: 'Requires: research route, not a group, researchPiSelfApproval on, the traveller is a PI, the traveller is in the (research) DOA line at the band tier upward, the limit > 0, and the amount <= the limit. If any condition fails, the PI picks a DOA (self excluded).' },
  { id: 'PSA-2', t: 'A PI-raised self-approval is auto-granted on submit; a delegate-raised one waits in the PI queue', ty: 'Business rule', b: 'Auto-grant (PI-raised) / Pending (delegate-raised)', c: 'Same keys as PSA-1', s: '#1 / 6.2',
    en: 'server - actions.ts:submitRequest', w: 'The PI need not click to approve their own just-submitted request, but a delegate-raised one still needs the PI decision.',
    e: 'the PI raises and submits their own research trip within the limit: the self step is stamped Approved and the TA issues; a PA submits on the PI behalf: the step stays Pending.',
    d: 'Auto-grant when the requestor is the traveller and the step is the PI self-approval ResearchDOA step.' },
]);

section('AMT', 'Approval amount basis',
  'The amount used to size DOA authority is computed from the estimate lines per the configured basis, excluding sponsorship and self-funded upgrades.', [
  { id: 'AMT-1', t: 'The DOA-tiering amount is computed per approvalAmountBasis', ty: 'Business rule', b: 'Auto-derive', c: 'ModuleSettings.approvalAmountBasis (GROSS / NET_NTU / MAJOR_COST / ALLOCATION)', s: '2.2 / 4.6',
    en: 'server - pricing.ts:computeSummary; consumed by route band selection and submitRequest', w: 'The basis the organisation uses to size DOA authority.',
    e: 'gross 10,000, sponsorship 3000, self-funded upgrade 1000, NET_NTU basis: approval amount 6000, DOA-2.',
    d: 'GROSS = sum of all lines; MAJOR_COST = sum of major-cost lines; NET_NTU / ALLOCATION / default = gross less sponsorship less traveller-funded. Traveller-funded = a self-funded class-upgrade delta (excluded like sponsorship). The booking ceiling (airfare + accommodation) is a separate figure. The amount is frozen to approvalAmountSgd with the rebuilt route at submission.' },
]);

section('HOF', 'TMC hand-off (outbound and inbound)',
  'Message guards gate what is sent to and accepted from the TMC. Every enabled guard for a flow must pass. The outbound channel is re-derived deterministically, and the payload is built from the frozen approval snapshot. The approved cost ceiling is a reference, never a booking limit.', [
  { id: 'HOF-1', t: 'A request must be Approved before any booking instruction is sent', ty: 'Validation', b: 'Hard block', c: 'Guard out.approved (admin-toggleable)', s: '13.9',
    en: 'both - integration.ts:evaluateFlow (OUTBOUND); actions.ts:handoffToTmc', w: 'The approved snapshot is the authority; nothing is booked before approval.',
    e: 'a Pending DOA request cannot be handed off.', d: 'All enabled OUTBOUND guards must pass. Exception: the emergency book-first lane bypasses the failed approval gate (audited, DD-23).' },
  { id: 'HOF-2', t: 'A request already handed off or booked is not re-sent', ty: 'Business rule', b: 'Hard block / skip', c: 'Guard out.unsent toggleable; idempotency check fixed', s: '13.9',
    en: 'both - integration.ts (out.unsent); hard idempotency check in handoffToTmc', w: 'Prevents orphan or duplicate bookings.',
    e: 'a request already Sent to TMC is skipped.', d: 'handoffToTmc unconditionally skips when the booking status is in flight or booked. A Failed booking is re-sent via resend (resets to Not Sent).' },
  { id: 'HOF-3', t: 'Only TMC-served booking methods are sent', ty: 'Business rule', b: 'Hard block', c: 'Guard out.tmcMethod (editable value list)', s: '13.9',
    en: 'both - integration.ts (out.tmcMethod); finalizeApproval only auto-hands-off a TMC arrangement', w: 'Self-booked and no-booking are never sent to the TMC.',
    e: 'a self-booked trip is never handed off.', d: 'Method in {TMC online, agent-assisted, offline, host-arranged}.' },
  { id: 'HOF-4', t: 'A Travel Authorisation number must exist before sending or accepting', ty: 'Validation', b: 'Hard block', c: 'Guards out.authorised / in.authorised (toggleable)', s: '13.9 / DD-17',
    en: 'both - integration.ts (isSet)', w: 'The exchange is keyed by the TA (one request to many PNRs).', e: 'a request with no TA is not sent.', d: 'The TA is issued at final approval (TR-... becomes TA-...).' },
  { id: 'HOF-5', t: 'The channel is re-derived deterministically at hand-off and overrides the stored method', ty: 'Business rule', b: 'Auto-correct', c: 'Fixed (handoffRouting)', s: '13.9 / DD-18',
    en: 'server - handoffRouting.ts:assessHandoffRouting via handoffToTmc', w: 'Only a simple single-traveller closed-loop no-personal itinerary is safely machine-bookable online.',
    e: 'a group block of 4: forced agent-assisted (group block booking).', d: 'Offline when offline method or an OFFLINE exception. Agent-assisted when a group of more than one, per-traveller dates/sub-itineraries, any personal extension, a complex multi-city/open-jaw, or a guest profile. Zero reasons: TMC online.' },
  { id: 'HOF-6', t: 'The outbound payload is built from the frozen approval snapshot, never recomputed', ty: 'Business rule', b: 'Auto-derive', c: 'Fixed', s: 'v1.3 / B2',
    en: 'server - handoffToTmc; tmcPayload.ts:outboundFromSnapshot', w: 'A post-approval edit cannot move what is sent; only the operational channel is overlaid.',
    e: 'an edit after approval does not change the sent itinerary or amounts.', d: 'When the snapshot is present, instructions are sent as approved with only the bookingMethod overlaid. A live build is used only when no snapshot exists (emergency book-first, or a pre-v1.3 request).' },
  { id: 'HOF-7', t: 'A group approval fans out to one booking instruction per traveller', ty: 'Business rule', b: 'Routing', c: 'Fixed; fields gated by the Integration Contract enabled set', s: '9.3 / AC15 / 13.14',
    en: 'server - tmcPayload.ts:assembleOutboundInstructions (GROUP_FANOUT)', w: 'Each traveller is booked individually under one correlation header.',
    e: 'a group of 3: three instructions, each with the traveller effective legs and class.', d: 'instructionSeq = the frozen group line number. Non-employee members default to Economy.' },
  { id: 'HOF-8', t: 'The approved cost ceiling is a reference carried to the TMC, never a booking limit', ty: 'Business rule', b: 'Reference only (never blocks a booking)', c: 'Field costCeiling toggleable', s: '6.4',
    en: 'server - tmcPayload.ts:ceilingBreakdown', w: 'The actual fare is charged; a material gap is reviewed at claim.', e: 'a booked fare above the ceiling is still booked.', d: 'approvedCostCeilingSgd = airfare + accommodation, split by category and bill-to. No code path blocks a booking on cost.' },
  { id: 'HOF-9', t: 'An inbound response is accepted only while a booking instruction is in flight, with a valid TA', ty: 'Validation', b: 'Hard block', c: 'Guards in.sent / in.authorised', s: '13.9 / 30 / 39',
    en: 'both - integration.ts:evaluateFlow (INBOUND); actions.ts:receiveBooking', w: 'Only process a response for a request actually awaiting one.',
    e: 'a response for a request not sent is rejected.', d: 'Booking status in {Sent, Received, In Progress, Traveller Action Required, Partially Booked}. A response for an already-Booked request is ignored (idempotent). A FAILED outcome is recorded and allows re-send.' },
]);

section('DEV', 'Booking deviation (booked versus approved)',
  'A material booked-versus-approved deviation is reviewed at claim approval. Nothing here ever blocks a booking: the approved amount is a reference. The baseline is read from the frozen approval snapshot.', [
  { id: 'DEV-1', t: 'Nothing blocks a booking; the approved amount is a reference', ty: 'Business rule', b: 'Routing only', c: 'Fixed', s: '6.4',
    en: 'server - bookingDeviation.ts:computeBookingDeviations', w: 'Finance confirmed the approved amount is a reference, not a limit.',
    e: 'a booked fare above the approved amount is still booked; any gap is recorded against the booking.', d: 'Deviations are recorded and surfaced at claim. Action is ReviewAtClaim, LogOnly or UpdateBooking.' },
  { id: 'DEV-2', t: 'A category amount is material only when the excess exceeds BOTH the % and the SGD threshold', ty: 'Business rule', b: 'Routing (material -> ReviewAtClaim)', c: 'ModuleSettings.deviationThresholdPct AND deviationThresholdAbsSgd', s: '6.4',
    en: 'server - bookingDeviation.ts:overBoth, applied in receiveBooking', w: 'A small overspend is tolerated; only a gap material on both measures is flagged.',
    e: 'approved airfare 4000, booked 4300: excess 300 < both (10% = 400 and 500): not material. Booked 5000: excess 1000 > both: material.',
    d: 'overBoth: excess = booked - approved; material iff excess > approved*pct/100 AND excess > absSgd. Applied to the airfare and accommodation categories. Booked airfare = sum of fare+taxes+fees across PNRs; booked hotel = sum of hotel segment amounts.' },
  { id: 'DEV-3', t: 'A per-leg (PNR) airfare breach alone is non-material (LogOnly); material only if the airfare category is also breached', ty: 'Business rule', b: 'Routing (LogOnly unless the category is breached)', c: 'ModuleSettings.deviationThresholdPct (per-PNR uses % only)', s: '6.4',
    en: 'server - bookingDeviation.ts', w: 'Per-leg apportionment is a prototype assumption, so a segment-only variance is recorded but not flagged.',
    e: 'one PNR over its matched approved amount but the airfare total within threshold: LogOnly.', d: 'Scope AIR:<routes>, level SEGMENT, pnr set. Material and ReviewAtClaim only when the airfare category is also breached.' },
  { id: 'DEV-4', t: 'A booked route with no approved match is always material', ty: 'Business rule', b: 'Routing (ReviewAtClaim, always material)', c: 'Fixed', s: '6.4',
    en: 'server - bookingDeviation.ts', w: 'A route change should not occur: the TMC returns NOT BOOKED and a fresh TR is raised; a received one is flagged.',
    e: 'a booked segment on a route not in the approved set: material.', d: 'Scope ROUTE:<k>, level SEGMENT.' },
  { id: 'DEV-5', t: 'A booked class above the approved class without an approved exception is always material', ty: 'Business rule', b: 'Routing (ReviewAtClaim, always material)', c: 'Fixed; suppressed by an approved CLASS exception', s: '6.4',
    en: 'server - bookingDeviation.ts', w: 'An unauthorised cabin upgrade at booking must be reviewed.',
    e: 'approved Economy, booked Business, no approved upgrade: material.', d: 'Skipped when an approved CLASS exception authorises the higher cabin. Scope CLASS:<k>, level SEGMENT.' },
  { id: 'DEV-6', t: 'A booked date beyond approved plus-or-minus the max shift, or beyond approval validity, is material', ty: 'Business rule', b: 'Routing (ReviewAtClaim, one aggregated DATES deviation)', c: 'ModuleSettings.maxDateShiftDaysBefore / After; approval validity (authorisationValidityDays)', s: '6.4',
    en: 'server - bookingDeviation.ts', w: 'At online booking a travel date may move within a tolerance; beyond it is reviewed.',
    e: 'approved depart 05-10, max shift +/-3; booked 05-15 (+5 days): material.', d: 'A booked date beyond the approval validity, or outside approved minus daysBefore to plus daysAfter, yields one DATES deviation per request (scope DATES).' },
  { id: 'DEV-7', t: 'The deviation evidence type maps from the deviation scope', ty: 'Business rule', b: 'Auto-derive', c: 'Consumed against ModuleSettings.evidenceRequiredFor', s: '8',
    en: 'server - bookingDeviation.ts:evidenceTypeFor', w: 'Decides which deviations require offline-approval evidence at claim.',
    e: 'a CLASS deviation maps to CLASS; an airfare category deviation maps to CATEGORY_AMOUNT.', d: 'CLASS:* -> CLASS; DATES -> DATES; ROUTE:* -> ROUTE; AIRFARE/ACCOMMODATION -> CATEGORY_AMOUNT; a segment airfare maps to null (it only ever accompanies a CATEGORY airfare deviation).' },
  { id: 'DEV-8', t: 'The approved breakdown and itinerary are frozen at final approval and drive both hand-off and the deviation baseline', ty: 'Business rule', b: 'Auto-derive (immutable after approval)', c: 'Fixed; date shift from the max-shift settings', s: 'v1.3 / B2',
    en: 'server - actions.ts:finalizeApproval (buildApprovedSnapshot); receiveBooking reads it', w: 'An edit after approval cannot move what is sent or the baseline it is compared against.',
    e: 'the deviation check compares the booked fare against the snapshot approved airfare, not the live request.', d: 'The snapshot holds the approved instructions and the approved airfare/accommodation totals (kept independently of the ceiling toggle). A pre-snapshot fallback uses the outbound segments plus live expenses (emergency book-first or pre-v1.3).' },
]);

section('PAL', 'Post-approval lock, amendment and recall',
  'An approved request is locked. A booking deviation is reviewed at claim, never re-approved in-system. A material change is a formal amendment; an approved, unbooked request can instead be recalled to a Draft.', [
  { id: 'PAL-1', t: 'An approved request is locked; there is no in-system re-approval of a booking deviation', ty: 'Business rule', b: 'Hard block on recompute', c: 'Fixed', s: '6.4 / v1.3 B2',
    en: 'server - bookingDeviation.ts (deviations never block); finalizeApproval freezes the snapshot', w: 'The approved amount is a reference, not a limit; deviations are reviewed at claim, not re-approved.',
    e: 'a booked fare above the approved amount is handled at claim review, not by re-approving the TR.', d: 'After approval the hand-off and deviation check read the snapshot, never recompute. A material change goes through amendment; cost ceiling is a reference.' },
  { id: 'PAL-2', t: 'A material amendment restarts re-approval and retains the same TA', ty: 'Business rule', b: 'Routing', c: 'Fixed', s: '13.18 / 33 / AC19',
    en: 'server - amend.ts:applyMaterialAmendment; finalizeApproval (retains the TA)', w: 'A material change re-approves and re-freezes the snapshot.',
    e: 'a route change after approval: status Amendment In Progress, a fresh route and a new immutable version.', d: 'Re-evaluates policy and re-derives the route. If a booking is already in flight, an amendment retransmit updates the TMC. Re-approval retains the TA and re-freezes the snapshot.' },
  { id: 'PAL-3', t: 'An approved, unbooked request can be recalled to an editable Draft', ty: 'Business rule', b: 'Routing + Hard block guard', c: 'Fixed', s: '13.x',
    en: 'server - actions.ts:recallRequest', w: 'Recall replaces in-system post-approval amendment for an un-ticketed trip; a ticketed booking is cancellation territory.',
    e: 'an Approved request Sent to TMC but not ticketed can be recalled; a Booked one cannot.',
    d: 'Requires Approved status and a recallable booking status (Not Sent, Sent, Received, In Progress, Traveller Action Required, Failed), and edit authority. On recall: if already sent, a TMC withdraw message goes out; status becomes Draft, booking Not Sent, the snapshot and validity/deadline are cleared. The TA number is retained (re-approval re-issues on the same TA).' },
  { id: 'PAL-4', t: 'A live or ticketed booking is cancelled via the TMC, not recalled', ty: 'Business rule', b: 'Routing (two-way lifecycle)', c: 'Fixed', s: '34 / DD-22',
    en: 'server - actions.ts:cancelRequest / receiveCancellation', w: 'A ticketed booking has fees and refunds the TMC must settle.',
    e: 'a Booked request cancelled: a cancel request goes to the TMC and the booking is held until the fee/refund settles.', d: 'A live booking sends a cancel request and holds at Cancellation Requested until settlement (ticketed: a mock penalty plus refund balance; un-ticketed: voided, no cost). A non-live one is cancelled locally. The authorisation is voided immediately (frees the duplicate guard) and the CTA charges reverse.' },
]);

section('CLM', 'Expense claim (TE link)',
  'An approved request pre-populates a linked expense claim. A material booking deviation of a configured type must carry offline-approval evidence (or an approved waiver) before the claim can be submitted. The claim DOA is auto-granted within tolerance.', [
  { id: 'CLM-1', t: 'A claim is pre-populated only when the request is claimable with a TA', ty: 'Validation', b: 'Hard block', c: 'Guards te.claimable / te.authorised (toggleable)', s: '13.8',
    en: 'server - te/actions.ts:createClaimFromRequest (evaluateFlow TE_SYNC)', w: 'A claim is raised only from an approved, authorised request.',
    e: 'a request not yet approved cannot pre-populate a claim.', d: 'te.claimable: status in {Approved, Closed}; te.authorised: a TA is set. An open draft claim for the same request+claimant is reused, not duplicated.' },
  { id: 'CLM-2', t: 'Offline-approval evidence blocks claim submission until every required deviation has evidence or an approved waiver', ty: 'Validation', b: 'Hard block', c: 'ModuleSettings.evidenceRequiredFor; guard te.evidence', s: '8',
    en: 'server - te/actions.ts:submitClaim (evaluateFlow TE_SUBMIT)', w: 'A material deviation of a listed type must be backed by the offline approval before the claim proceeds.',
    e: 'a material DATES deviation with no evidence attached: submission blocked, listing the pending deviations.',
    d: 'evidenceComplete = every deviation that requiresEvidence has an evidence attachment or a waiver. requiresEvidence is set at receive time as material AND the deviation type is in evidenceRequiredFor. A self-booked trip has no bookings, so it passes vacuously.' },
  { id: 'CLM-3', t: 'The claim approver may waive the evidence requirement, with a mandatory reason', ty: 'Validation', b: 'Hard block on empty reason', c: 'Fixed', s: '8',
    en: 'server - te/actions.ts:waiveEvidence', w: 'A waiver must be accountable.', e: 'a waiver with an empty reason is rejected.', d: 'A non-empty reason records waivedBy, waivedAt and the reason on the deviation, satisfying the evidence gate for it.' },
  { id: 'CLM-4', t: 'Deviation evidence must be PDF/PNG/JPEG within the size cap', ty: 'Validation', b: 'Hard block', c: 'ModuleSettings.attachmentMaxMb', s: '8 / 2',
    en: 'server - actions.ts:uploadDeviationEvidence', w: 'Only a readable document within the size limit is accepted.', e: 'a 20 MB TIFF: rejected.', d: 'Allowed types: PDF, PNG, JPEG; size <= attachmentMaxMb. On success the attachment is linked to the deviation.' },
  { id: 'CLM-5', t: 'The claim DOA is auto-granted from the approved TR when within tolerance, same charging DOA, no new type or exception', ty: 'Business rule', b: 'Routing (auto-granted) or route to DOA', c: 'ModuleSettings.teAutoGrantTolerancePct AND teAutoGrantToleranceAbsSgd', s: '51 / DD-08',
    en: 'server - te/workflow.ts:doaAutoGrant / buildClaimRoute', w: 'A claim close to the approved amount, on the same account, with nothing new, needs no fresh DOA decision.',
    e: 'a claim 6% over the approved amount, same DOA, no new expense type: the DOA step is auto-granted.',
    d: 'Requires: request Approved/Closed with a TA; the overspend within BOTH the % and the SGD cap; no new expense type; no new exception; the charging DOA unchanged. A changed charging account routes to the new account DOA (never auto-granted). Totals are reimbursable-only.' },
  { id: 'CLM-6', t: 'The claim route is Verifier, then optional Exception and RO, then DOA (always)', ty: 'Business rule', b: 'Routing', c: 'ModuleSettings.exceptionApproverRequired / roRequirement / sameRouteResearch', s: '51',
    en: 'server - te/workflow.ts:buildClaimRoute', w: 'The claim mirrors the request route with a Verifier first.',
    e: 'an individual claim with a new exception: Verifier, Exception, RO, DOA.', d: 'Verifier always first. Exception only if required and the claim has a new exception. RO only per roRequirement and when the RO is not the claimant. DOA always, from the claim charging department and amount band (research to ResearchDOA).' },
  { id: 'CLM-7', t: 'A line reimbursable-versus-reference is decided by its settlement channel', ty: 'Business rule', b: 'Auto-derive', c: 'Driven by booking arrangement and hotel settlement; airfareTreatment governs how a central airfare posts', s: 'DD-19',
    en: 'server - settlement.ts:lineSettlement / isReimbursable; te/prepopulate.ts', w: 'A centrally-settled line is reference-only on the claim; reimbursing it would double-pay.',
    e: 'a TMC-billed airfare: reference on the claim; a self-booked airfare: editable (reimbursable).', d: 'Airfare central under a TMC arrangement, else employee. Accommodation central only when CTA is available and selected. ODA/other always employee. Group claims are filtered to the claimant attributed/shared lines; each line is netted by prior-claimed amounts.' },
  { id: 'CLM-8', t: 'Each claim is linked to its Travel Request', ty: 'Business rule', b: 'Routing (link row + requestId)', c: 'ModuleSettings.teLinkageMandatory (defined but not enforced in code; linkage is implicit in the create path)', s: '13.8',
    en: 'server - te/actions.ts:createClaimFromRequest', w: 'A claim is always created from a request in the prototype, so linkage is effectively mandatory.',
    e: 'a claim created from TR-2026-000123 carries that requestId and a link row.', d: 'Submit requires the claim requestId. Cumulative follow-up claims net prior claimed amounts by category.' },
  { id: 'CLM-9', t: 'Merchant and Invoice No. on an expense line come from the TMC feed on a CTA line and are claimant-entered otherwise', ty: 'Business rule', b: 'Auto-derive (CTA) or claimant input (reimbursable)', c: 'Fixed', s: 'DD-19 / 2',
    en: 'server - app/claims/[id]/page.tsx:expenseView; te/actions.ts:addClaimExpense / updateClaimExpenseLine (TEExpenseLine.merchant, invoiceNo)',
    w: 'A centrally-billed charge already carries its supplier and document number in the feed, so they are displayed rather than retyped; an out-of-pocket charge is evidenced by the claimant.',
    e: 'a CTA airfare shows Merchant set to the booking TMC provider and Invoice No. set to the CTA posting document number, both read-only; a self-booked airfare takes a claimant-typed Merchant and Invoice No.',
    d: 'A REFERENCE (CTA) line derives Merchant from the booking TMC provider name (falling back to the default provider) and Invoice No. from the CtaPostingDocument.sapDocNo for the charge type; both are read-only and not stored on the line. A reimbursable line keeps both as editable text persisted to TEExpenseLine.merchant and invoiceNo, shown as entered by claimant. The per-line Edit modal renders only for non-reference lines, so a CTA line is never claimant-editable.' },
]);

// ======================================================================= APPENDIX
H1('Appendix A · Vendor notes and known caveats');
P('Precise points to carry into the build, observed in the prototype source:');
BUL('The workflow engine is data-driven and runtime-editable: the WorkflowScenario is stored in the database (seeded from TR_STANDARD) so every SKIP/ADD/REPLACE/AUTO_GRANT routing rule can be changed without code.');
BUL('roRequirement (ALWAYS/INDIVIDUAL_ONLY/NEVER) is exposed to the engine as a fact but the seeded scenario does not wire ALWAYS or NEVER: RO skips are hard-wired to group/guest/research, which matches INDIVIDUAL_ONLY. Changing the setting alone does not change routing under the seeded scenario; a decision point must be authored.');
BUL('teLinkageMandatory exists as a setting and an admin control but has no runtime enforcement site. Linkage is instead implicit in the create-from-request path, so a claim is always tied to a request.');
BUL('In the seeded scenario the Dean decision point and the non-term auto-grant decision point both carry sequence 12 (a duplicate sequence number). Both are evaluated today; the vendor should assign distinct sequence numbers.');
BUL('The per-PNR segment-airfare deviation check uses the percentage tolerance only, while the AND-of-percent-and-SGD rule governs the category check it depends on for materiality.');
BUL('The legacy departure/return ODA split (first and last day at the travel-day rate) is retained in code but is not used by the live per-city ODA, which uses the duration tiers (EST-5).');
BUL('All thresholds, caps, rates and the class register are mock masters in the prototype (charging accounts, hotel caps, ODA rates, policy groups, uplift rates, academic calendar). The vendor supplies the authoritative masters; the rules above reference them by role, not by seed value.');
GAP();
P('End of document.');

// ======================================================================= WRITE
const doc = new Document({
  creator: 'NTU ECS Pre-Trip prototype', title: 'Travel Request: Validation & Business Rules',
  styles: { default: {
    document: { run: { font: 'Calibri', size: 20, color: '333333' } },
    heading1: { run: { font: 'Calibri', size: 30, bold: true, color: NAVY }, paragraph: { spacing: { before: 260, after: 120 } } },
    heading2: { run: { font: 'Calibri', size: 23, bold: true, color: RED }, paragraph: { spacing: { before: 180, after: 60 } } },
    heading3: { run: { font: 'Calibri', size: 20, bold: true, color: '2a2d40' }, paragraph: { spacing: { before: 140, after: 30 } } },
  } },
  sections: [{ properties: { page: { margin: { top: 1000, bottom: 1000, left: 1000, right: 1000 } } }, children: out }],
});
const target = process.argv[2] || '../NTU-Travel-Request-Validation-Business-Rules.docx';
Packer.toBuffer(doc).then((buf) => { fs.writeFileSync(target, buf); console.log('Wrote ' + target + ' (' + (buf.length / 1024).toFixed(0) + ' KB)'); });
