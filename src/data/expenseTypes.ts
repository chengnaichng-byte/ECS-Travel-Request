// §13.7 Expense types aligned to existing TE codes. §2.1 extension attributes:
// pre-trip applicability, estimate form type, TMC/TE treatment, estimate basis,
// variance threshold. Reused read-only — the pre-trip module must NOT maintain a
// second list of expense types (§13.18, AC02).
import { EXPENSE_CATEGORY } from '@/shared/enums';

export interface ExpenseType {
  id: string;
  teCode: string;
  name: string;
  category: string;          // EXPENSE_CATEGORY
  glAccount: string;
  gstCode: string;           // §13 reused ECS GST/tax code
  taxRatePct: number;        // §13 GST rate applied at claim (indicative for overseas travel)
  preTripApplicable: boolean;
  isMajorCost: boolean;      // major vs incidental (§3.4 expense scope)
  estimateFormType: 'AIRFARE' | 'ACCOMMODATION' | 'ODA' | 'STANDARD';
  varianceThreshold: number; // % variance threshold (§2.1)
}

// GST codes reused from ECS: ZP = zero-rated / out-of-scope (overseas travel), SR = standard-rated.
export const expenseTypes: ExpenseType[] = [
  { id: 'ET-AIR',  teCode: '6110', name: 'Airfare',                  category: EXPENSE_CATEGORY.Airfare,       glAccount: 'GL-6110', gstCode: 'ZP', taxRatePct: 0, preTripApplicable: true, isMajorCost: true,  estimateFormType: 'AIRFARE',       varianceThreshold: 10 },
  { id: 'ET-ACC',  teCode: '6120', name: 'Overseas Accommodation',   category: EXPENSE_CATEGORY.Accommodation, glAccount: 'GL-6120', gstCode: 'ZP', taxRatePct: 0, preTripApplicable: true, isMajorCost: true,  estimateFormType: 'ACCOMMODATION', varianceThreshold: 10 },
  { id: 'ET-ODA',  teCode: '6130', name: 'Overseas Daily Allowance', category: EXPENSE_CATEGORY.ODA,           glAccount: 'GL-6130', gstCode: 'OS', taxRatePct: 0, preTripApplicable: true, isMajorCost: true,  estimateFormType: 'ODA',           varianceThreshold: 15 },
  { id: 'ET-CONF', teCode: '6140', name: 'Conference Fee',           category: EXPENSE_CATEGORY.Conference,    glAccount: 'GL-6140', gstCode: 'SR', taxRatePct: 9, preTripApplicable: true, isMajorCost: false, estimateFormType: 'STANDARD',      varianceThreshold: 10 },
  { id: 'ET-OTH',  teCode: '6190', name: 'Other Travel Expenses',    category: EXPENSE_CATEGORY.Other,         glAccount: 'GL-6190', gstCode: 'SR', taxRatePct: 9, preTripApplicable: true, isMajorCost: false, estimateFormType: 'STANDARD',      varianceThreshold: 20 },
];
