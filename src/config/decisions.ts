// §3.4 Configurable decisions + §13.18 build scope. These are the DEFAULT values
// used to seed the (runtime-togglable) Pre-Trip Module Settings row. The live values
// are read from the ModuleSettings table so a switch change persists and drives
// behaviour without a rebuild (AC03). Keeping the catalogue here — not hard-coded in
// logic — is the §11.3 directive so it maps to OutSystems site properties.

export const moduleSettingsDefaults = {
  sameRouteResearch: false,         // §3.4 same route for research and non-research
  expenseScope: 'ALL' as 'MAJOR_ONLY' | 'ALL',
  hotelEstimateBasis: 'LOWER' as 'QUOTED' | 'CAP' | 'LOWER',
  airfareTreatment: 'IN_TE' as 'DIRECT_SAP' | 'IN_TE' | 'REFERENCE',
  teLinkageMandatory: 'CONDITIONAL' as 'YES' | 'NO' | 'CONDITIONAL',
  approvalAmountBasis: 'NET_NTU' as 'GROSS' | 'NET_NTU' | 'MAJOR_COST' | 'ALLOCATION',
  groupTravelEnabled: true,         // §13.14
  groupMaxTravellers: 10,           // §13.14 TMC group-booking size limit (incl. guests)
  groupGuestMixAllowed: true,       // §8/§13.14 allow guests as members of a group (alongside employees and/or students). Off = guests must use a separate guest request.
  mixedGroupEnabled: true,          // §13.14 may ONE group mix staff + students (+ guests)? on by default
  groupSubItineraries: false,       // §13.20 allow per-traveller sub-itineraries (deviations) in a group; off = one shared itinerary
  purposeDrivenItems: true,         // §4.4 travel purpose auto-populates its full cost-item set (staff) on Estimates; off = ODA + accommodation only
  exceptionApproverRequired: true,  // §26 insert an Exception Approver step for exceptions (else surface to DOA)
  roRequirement: 'INDIVIDUAL_ONLY' as 'ALWAYS' | 'INDIVIDUAL_ONLY' | 'NEVER', // §51 RO decision point
  teAutoGrantTolerancePct: 10,      // §51 TE claim DOA auto-grant tolerance (% over approved)
  teAutoGrantToleranceAbsSgd: 500,  // §51 TE claim DOA auto-grant tolerance (SGD over approved)
  // §6.4 Post-approval booking-deviation materiality (admin-editable). The approved amount is a
  // REFERENCE, not a booking limit; a booked category amount (airfare / accommodation) is MATERIAL
  // (reviewed at CLAIM approval, never re-approved in-system) only when it exceeds the approved
  // category amount by MORE than BOTH the % and the SGD amount. Distinct gate from teAutoGrantTolerance*
  // (claim DOA auto-grant headroom); defaults aligned (10% / SGD 500). See the data dictionary.
  deviationThresholdPct: 10,
  deviationThresholdAbsSgd: 500,
  // §6.4 Online-booking date-shift limit: booked travel dates may move within approved ± these days
  // (and within the approval validity). Outside the window is a material DATES deviation.
  maxDateShiftDaysBefore: 3,
  maxDateShiftDaysAfter: 3,
  // §6.4/§8 Deviation types that require offline-approval evidence before the claim can be submitted.
  // CLASS, DATES, ROUTE and CATEGORY_AMOUNT (a material airfare/accommodation amount). Empty = no gate.
  evidenceRequiredFor: 'CLASS,DATES,ROUTE,CATEGORY_AMOUNT',
  selfBookingEnabled: true,         // §13.17
  selfApprovalLimitSgd: 5000,       // §43 self-approval limit (0 = never); the research PI self-approval band
  researchPiSelfApproval: true,     // #1 research WBS raised for a PI traveller ≤ limit → self-approved (PI is the DOA)
  guestUpgradeProvostId: 'E-PROVOST', // §8/DD-25 WHO the Provost is for a guest travel-class upgrade (WHETHER it is required is a workflow-config decision point)
  guestUpgradeDeanStep: false,      // §8/DD-25 insert a Dean recommendation step before the Provost on a guest travel-class upgrade (off by default)
  nonTermAutoApprove: true,         // §13.x research-WBS non-term travel (attested + approval e-mail) → auto-approved (on by default)
  upgradeDeltaRoutingEnabled: true,    // #14 route the NTU-funded travel-class upgrade differential to a separate M6 account
  upgradeDeltaSelectionRequired: false, // #14 default to the BA's default (or first) M6 account and let the traveller re-select; set true to force a pick when the BA has >1
  attachmentMaxMb: 7,               // §2 max upload size per file
  chargingSplitMode: 'PERCENT' as 'PERCENT' | 'AMOUNT', // §17 charging entry mode
  declarationText: 'I confirm that the trip is for official purposes, the estimated costs are reasonable, and the itinerary and personal travel days are accurate.',
  coiText: 'I declare no conflict of interest arising from this trip or its funding source.',
  sftpConfig: 'sftp://tmc-gateway.example:22 (key: ECS_TMC_2026)',
  visaLetterHrOfficer: 'HR Immigration & Passes Office',  // §4.13 HR officer/team notified for a visa letter
  visaLetterHrEmail: 'hr-immigration@ntu.edu.sg',          // §4.13 that HR officer's email
  authorisationValidityDays: 30,    // §13.3
  bookingDeadlineDays: 14,          // §13.3
  emergencyLeadDays: 14,            // §13.x/DD-23 emergency-lane standard lead-time window (days before departure)
  emergencyEvidenceRequired: true,  // §DD-23 Mode A (ON) = attach the approving DOA's authorising e-mail when a trip auto-qualifies for the emergency lane (the DOA is the authoriser); Mode B (OFF) = float through the normal approval, no extra evidence
};

/** §3.4 decision catalogue — drives the Module Settings screen (TR-19). */
export const decisionCatalogue = [
  { key: 'exceptionApproverRequired', label: 'Exception Approver step required', kind: 'boolean',
    effect: 'When on, a policy exception inserts an Exception Approver before DOA; when off, the exception is surfaced to the DOA to decide (§26). Applies to both the Travel Request and the TE claim workflows.' },
  { key: 'roRequirement', label: 'RO (Reporting Officer) decision point', kind: 'enum', options: ['ALWAYS', 'INDIVIDUAL_ONLY', 'NEVER'],
    effect: 'Workflow configuration for the RO step: ALWAYS = every request; INDIVIDUAL_ONLY = individual requests only, dropped for a group request; NEVER = no RO step. DOA is always required (§51).' },
  { key: 'teAutoGrantTolerancePct', label: 'TE claim DOA auto-grant tolerance (%)', kind: 'number',
    effect: 'On a TE claim, the DOA step is auto-granted from the approved Travel Request when the claim total is within this % over the approved amount (and within the SGD cap), with no new policy exception and no new expense type (§51).' },
  { key: 'teAutoGrantToleranceAbsSgd', label: 'TE claim DOA auto-grant tolerance (SGD)', kind: 'number',
    effect: 'Absolute SGD cap for the TE claim DOA auto-grant tolerance above (§51).' },
  { key: 'deviationThresholdPct', label: 'Booking deviation threshold (%)', kind: 'number',
    effect: 'A booked category amount (airfare or accommodation) is a material deviation — highlighted to the claim approver (ReviewAtClaim) — only when it exceeds the approved category amount by more than this % AND more than the SGD amount below. The approved amount is a reference, not a booking limit; bookings are never blocked (§6.4).' },
  { key: 'deviationThresholdAbsSgd', label: 'Booking deviation threshold (SGD)', kind: 'number',
    effect: 'The absolute arm of the booking-deviation threshold; both this and the % must be exceeded for a material category amount deviation. Distinct from the TE claim DOA auto-grant tolerance above (that governs auto-approval at claim; this governs materiality of the booked-vs-approved gap) (§6.4).' },
  { key: 'maxDateShiftDaysBefore', label: 'Max booking date shift before approved (days)', kind: 'number',
    effect: 'Online booking may move a travel date up to this many days earlier than approved (and within the approval validity). Beyond this is a material DATES deviation reviewed at claim (§6.4).' },
  { key: 'maxDateShiftDaysAfter', label: 'Max booking date shift after approved (days)', kind: 'number',
    effect: 'Online booking may move a travel date up to this many days later than approved (and within the approval validity). Beyond this is a material DATES deviation reviewed at claim (§6.4).' },
  { key: 'evidenceRequiredFor', label: 'Deviation types needing offline-approval evidence', kind: 'text',
    effect: 'Comma-separated deviation types (CLASS, DATES, ROUTE, CATEGORY_AMOUNT) that require the traveller to attach offline-approval evidence before the claim can be submitted. When a booking raises a material deviation of a listed type, the claim is blocked until evidence is attached or the claim approver records a waiver with a reason. Empty = no evidence gate (§6.4/§8).' },
  { key: 'sameRouteResearch', label: 'Same route for research & non-research', kind: 'boolean',
    effect: 'If off, research-charged requests route to the Research DOA line.' },
  { key: 'researchPiSelfApproval', label: 'Research PI self-approval', kind: 'boolean',
    effect: 'When on, a research-WBS request raised for a Principal Investigator (per the staff master PI flag), with an approval amount at/below the self-approval limit (below), is self-approved — the PI is the DOA. Applies to individual (non-group) requests; a PI-raised one is auto-granted on submission, a delegate-raised one waits in the PI’s approval queue.' },
  { key: 'nonTermAutoApprove', label: 'Non-term research travel auto-approve', kind: 'boolean',
    effect: 'When on, a research-WBS trip in non-term time is auto-approved on submission (no approval steps) once the traveller attests non-term travel and attaches the offline-approval e-mail, and the request has no unresolved policy exception. Offline approval already exists for research-funded travel, so the pre-trip is fast-tracked. The workflow rule that skips the approvers is in the TR scenario (visible in the Workflow Configuration viewer / simulator). Off by default.' },
  { key: 'upgradeDeltaRoutingEnabled', label: 'Travel-class upgrade differential → M6 routing', kind: 'boolean',
    effect: 'When on, the NTU-funded differential of a travel-class upgrade is charged to a separate M6 (upgrade-differential) account for the governing business area — selected on the Charging step — while the entitlement stays on the original WBS/CC. When off, the whole NTU-funded fare charges the normal allocation (#14).' },
  { key: 'upgradeDeltaSelectionRequired', label: 'Require M6 account selection when the BA has several', kind: 'boolean',
    effect: 'When on, if the governing business area offers more than one M6 account the traveller must pick which the upgrade differential charges (a hard stop until set); a BA with a single account auto-selects. When off (default), the BA\'s default (or first) M6 account is applied automatically and the traveller may still re-select (#14).' },
  { key: 'expenseScope', label: 'Expense scope', kind: 'enum', options: ['MAJOR_ONLY', 'ALL'],
    effect: 'Controls which expense types are available (major only vs all travel expenses).' },
  { key: 'purposeDrivenItems', label: 'Purpose-driven cost items', kind: 'boolean',
    effect: 'When on (default), selecting a travel purpose auto-populates its full configured cost-item set for staff on the Estimates step — ODA and accommodation stay policy-computed, the declarable items (airfare and incidentals) appear as pre-created lines defaulted to their configured standard cost (or 0, ready to fill). Deleted items are not re-added. Guests and students always get airfare and accommodation only. When off, only ODA and accommodation auto-derive. The per-purpose item set and standard costs are maintained on the Purpose Cost Items setup screen (§4.4).' },
  { key: 'hotelEstimateBasis', label: 'Hotel estimate basis', kind: 'enum', options: ['QUOTED', 'CAP', 'LOWER'],
    effect: 'Controls the accommodation budget: quoted amount, hotel cap, or the lower of both.' },
  { key: 'airfareTreatment', label: 'Airfare treatment', kind: 'enum', options: ['DIRECT_SAP', 'IN_TE', 'REFERENCE'],
    effect: 'Controls downstream handling of airfare at the claim stage (§13.8).' },
  { key: 'teLinkageMandatory', label: 'TE linkage mandatory', kind: 'enum', options: ['YES', 'NO', 'CONDITIONAL'],
    effect: 'Controls whether a claim must select an approved Travel Request (§13.8).' },
  { key: 'approvalAmountBasis', label: 'Approval amount basis', kind: 'enum', options: ['GROSS', 'NET_NTU', 'MAJOR_COST', 'ALLOCATION'],
    effect: 'Amount used for DOA tiering (§2.2).' },
  { key: 'groupTravelEnabled', label: 'Group travel requests enabled', kind: 'boolean',
    effect: 'Enables one-request-many-travellers group requests (§13.14).' },
  { key: 'guestUpgradeDeanStep', label: 'Dean recommendation before Provost (guest upgrade)', kind: 'boolean',
    effect: 'When on, a guest travel-class upgrade routes through a Dean (or dean-equivalent) recommendation step BEFORE the Provost. The requestor selects the Dean from the staff directory on the Review step (required to submit); the Dean’s name and position are shown to the Provost so they can see who recommended the upgrade. When off (default), the guest upgrade goes straight to the Provost (§8, DD-25).' },
  { key: 'groupMaxTravellers', label: 'Group booking size limit', kind: 'number',
    effect: 'Maximum travellers in a single group booking, including guest members — mirrors the TMC group-fare limit. Create is blocked above this count (§13.14).' },
  { key: 'groupGuestMixAllowed', label: 'Allow guests as group members', kind: 'boolean',
    effect: 'When on (default), a group may include guests alongside employees and/or students, and students and guests may form a group without any staff (§8, §13.14). Off restores the employees-only policy — guests are raised on a separate Guest request.' },
  { key: 'mixedGroupEnabled', label: 'Allow mixed staff + student groups', kind: 'boolean',
    effect: 'When on (default), one group booking may combine staff (from the directory) and students (uploaded, non-validated) on a single shared TA — students carry no ODA and file no claim, exactly like guests. When off, a group is homogeneous: staff-only or student-only. Requires group travel enabled; students additionally require the student-group setting (§13.14).' },
  { key: 'groupSubItineraries', label: 'Allow per-traveller group itineraries', kind: 'boolean',
    effect: 'When on, a group traveller may DEVIATE from the shared itinerary with their own legs (declared upfront on the Trip step) — a different route or dates — and their ODA, accommodation and travel-class entitlement are costed on their own itinerary. When off (default), a group travels on one shared itinerary (§13.20).' },
  { key: 'selfBookingEnabled', label: 'Self-booked travel enabled', kind: 'boolean',
    effect: 'Allows Self-Booked method and Travel Request selection at claim (§13.17).' },
] as const;
