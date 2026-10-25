// Central Travel Account (CTA) master — the card / BTA / BSP accounts NTU settles centrally
// with the travel provider. ECS's existing posting programme performs the GL posting; the one
// thing it cannot derive is the CLEARING ACCOUNT for a given CTA (different CTA account →
// different clearing GL). That mapping lives here.
//
// The CTA account id is REPORTED BY THE CARD / TMC FEED on each charge (never derived by ECS);
// this master is a posting-only lookup: ctaAccountId → clearingGlAccount (+ the attributes the
// posting and reconciliation views display). In production this is an ECS/SAP finance master,
// read-only in the hub.
export interface CtaAccount {
  ctaAccountId: string;       // the account id exactly as the card / TMC provider reports it (feed key)
  label: string;
  provider: string;           // card issuer / settlement provider
  companyCode: string;
  currency: string;
  clearingGlAccount: string;  // the GL clearing account ECS's posting programme credits
  active: boolean;
  effectiveFrom: string;
  effectiveTo?: string;
}

export const ctaAccounts: CtaAccount[] = [
  { ctaAccountId: 'CTA-SG-SGD', label: 'NTU Central Travel Account — SGD', provider: 'FCM Travel (lodge card)', companyCode: '1000', currency: 'SGD', clearingGlAccount: '199101', active: true, effectiveFrom: '2025-01-01' },
  { ctaAccountId: 'CTA-SG-USD', label: 'NTU Central Travel Account — USD multi-currency (non-SGD settlements)', provider: 'FCM Travel (lodge card)', companyCode: '1000', currency: 'USD', clearingGlAccount: '199102', active: true, effectiveFrom: '2025-01-01' },
  { ctaAccountId: 'CTA-BSP-AIR', label: 'NTU Air BSP settlement account', provider: 'IATA BSP', companyCode: '1000', currency: 'SGD', clearingGlAccount: '199105', active: true, effectiveFrom: '2025-01-01' },
  // Guest bookings are CTA-settled too (airfare + accommodation). The feed reports which account
  // was used, so a guest charge can lodge to the SAME account as employees OR to this dedicated
  // guest account — the master simply holds whichever the TMC uses. Here it maps to its own
  // clearing GL to keep guest settlement reconcilable separately.
  { ctaAccountId: 'CTA-GUEST', label: 'NTU Guest Central Travel Account', provider: 'FCM Travel (guest lodge card)', companyCode: '1000', currency: 'SGD', clearingGlAccount: '199110', active: true, effectiveFrom: '2025-01-01' },
];
