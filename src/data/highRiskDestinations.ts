// §4.8 High-risk travel destinations. Configurable classification of countries/regions
// designated high-risk under prevailing MFA travel advisories and the University's travel
// risk-management framework. Reference master, consumed read-only; maintained in ECS in
// production. A travel request to a listed (active) country triggers the advisory, the
// mandatory traveller + approver acknowledgements, and notification of the risk office.
export interface HighRiskDestination {
  countryCode: string;
  name: string;
  riskLevel: 'HIGH' | 'EXTREME';   // configurable classification
  advisory: string;                 // advisory text shown to traveller and approver
  source: string;                   // basis for the classification
  effectiveFrom: string;
  active: boolean;
}

export const highRiskDestinations: HighRiskDestination[] = [
  { countryCode: 'EG', name: 'Egypt', riskLevel: 'HIGH', source: 'MFA Travel Advisory', effectiveFrom: '2025-01-01', active: true,
    advisory: 'Exercise a high degree of caution. Avoid non-essential travel to border and desert regions; monitor local conditions and register with the mission on arrival.' },
  { countryCode: 'UA', name: 'Ukraine', riskLevel: 'EXTREME', source: 'MFA Travel Advisory', effectiveFrom: '2025-01-01', active: true,
    advisory: 'Avoid all travel. Active conflict zone; University travel requires risk-committee clearance in addition to the standard approval.' },
  { countryCode: 'IQ', name: 'Iraq', riskLevel: 'EXTREME', source: 'MFA Travel Advisory', effectiveFrom: '2025-01-01', active: true,
    advisory: 'Avoid all travel. Security situation remains volatile; mandatory risk briefing and insurance confirmation required before booking.' },
  { countryCode: 'PK', name: 'Pakistan', riskLevel: 'HIGH', source: 'University Risk Framework', effectiveFrom: '2025-01-01', active: true,
    advisory: 'Avoid non-essential travel. Heightened security precautions required; confirm accommodation and ground transport arrangements in advance.' },
];
