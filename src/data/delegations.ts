// §13.13 / §13.16 Delegation seed. Reuses the existing ECS delegation framework:
// Delegate to Create Travel Requests (new, §13.13) and Delegate to Create Expense
// Reports (existing, reused at claim stage).
export interface Delegation {
  id: string;
  kind: 'CREATE_TRAVEL_REQUEST' | 'CREATE_EXPENSE_REPORT' | 'APPROVE';
  principalId: string;  // grantor (traveller)
  delegateId: string;   // grantee
}

export const delegations: Delegation[] = [
  // §13.16: one Delegate to Create Travel Requests grant (traveller to PA)
  { id: 'DG-1', kind: 'CREATE_TRAVEL_REQUEST', principalId: 'E-TRAV', delegateId: 'E-PA' },
  // §13.16: one existing Delegate to Create Expense Reports grant for claim-stage demo
  { id: 'DG-2', kind: 'CREATE_EXPENSE_REPORT', principalId: 'E-TRAV', delegateId: 'E-PA' },
];
