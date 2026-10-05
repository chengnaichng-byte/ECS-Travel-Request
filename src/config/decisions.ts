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
  exceptionApproverRequired: true,  // §26 insert an Exception Approver step for exceptions (else surface to DOA)
  roRequirement: 'INDIVIDUAL_ONLY' as 'ALWAYS' | 'INDIVIDUAL_ONLY' | 'NEVER', // §51 RO decision point
  teAutoGrantTolerancePct: 10,      // §51 TE claim DOA auto-grant tolerance (% over approved)
  teAutoGrantToleranceAbsSgd: 500,  // §51 TE claim DOA auto-grant tolerance (SGD over approved)
  crossBaThresholdSgd: 500,         // §18 cross-business-area concurrence threshold (AC5)
  selfBookingEnabled: true,         // §13.17
  selfApprovalLimitSgd: 0,          // §43 self-approval limit (0 = never self-approve)
  attachmentMaxMb: 7,               // §2 max upload size per file
  chargingSplitMode: 'PERCENT' as 'PERCENT' | 'AMOUNT', // §17 charging entry mode
  declarationText: 'I confirm that the trip is for official purposes, the estimated costs are reasonable, and the itinerary and personal travel days are accurate.',
  coiText: 'I declare no conflict of interest arising from this trip or its funding source.',
  sftpConfig: 'sftp://tmc-gateway.example:22 (key: ECS_TMC_2026)',
  authorisationValidityDays: 30,    // §13.3
  bookingDeadlineDays: 14,          // §13.3
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
  { key: 'sameRouteResearch', label: 'Same route for research & non-research', kind: 'boolean',
    effect: 'If off, research-charged requests route to the Research DOA line.' },
  { key: 'crossBaThresholdSgd', label: 'Cross-BA concurrence threshold (SGD)', kind: 'number',
    effect: 'When charging spans more than one business area, each non-primary BA whose share exceeds this amount must concur (its DOA is added to the route); the primary-BA DOA still owns the request (§18, AC5).' },
  { key: 'expenseScope', label: 'Expense scope', kind: 'enum', options: ['MAJOR_ONLY', 'ALL'],
    effect: 'Controls which expense types are available (major only vs all travel expenses).' },
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
  { key: 'selfBookingEnabled', label: 'Self-booked travel enabled', kind: 'boolean',
    effect: 'Allows Self-Booked method and Travel Request selection at claim (§13.17).' },
] as const;
