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
  gstCode: string;           // §13 ECS ⇄ SAP tax code (IZ/IO/I9/P9) — see src/data/gstCodes.ts
  taxRatePct: number;        // §13 GST rate (IZ/IO = 0%, I9/P9 = 9%); kept in sync with the code
  preTripApplicable: boolean;
  isMajorCost: boolean;      // major vs incidental (§3.4 expense scope)
  estimateFormType: 'AIRFARE' | 'ACCOMMODATION' | 'ODA' | 'STANDARD';
  varianceThreshold: number; // % variance threshold (§2.1)
}

// Tax codes are the shared ECS ⇄ SAP codes (IZ/IO/I9/P9) from the GST code master (src/data/gstCodes.ts):
// IZ = zero-rated intl service (airfare), IO = out-of-scope overseas consumption (hotel, car, visa, ODA),
// I9 = 9% claimable input tax (local agency/booking/handling fees + conf/insurance/comms), P9 = 9% blocked.
// This mirrors the shared ECS/TE expense-type master; the pre-trip module consumes it
// read-only (§13.18, AC02) and must not maintain a second list. Major-cost types drive the
// dedicated estimate forms; the remaining (incidental) types populate the "Other" picker and
// support full-cost estimates when the expense scope is ALL (§3.4).
export const expenseTypes: ExpenseType[] = [
  // ---- Major cost types (dedicated estimate forms) ----
  { id: 'ET-AIR',  teCode: '6110', name: 'Airfare',                  category: EXPENSE_CATEGORY.Airfare,       glAccount: 'GL-6110', gstCode: 'IZ', taxRatePct: 0, preTripApplicable: true, isMajorCost: true,  estimateFormType: 'AIRFARE',       varianceThreshold: 10 },
  { id: 'ET-ACC',  teCode: '6120', name: 'Overseas Accommodation',   category: EXPENSE_CATEGORY.Accommodation, glAccount: 'GL-6120', gstCode: 'IO', taxRatePct: 0, preTripApplicable: true, isMajorCost: true,  estimateFormType: 'ACCOMMODATION', varianceThreshold: 10 },
  { id: 'ET-ODA',  teCode: '6130', name: 'Overseas Daily Allowance', category: EXPENSE_CATEGORY.ODA,           glAccount: 'GL-6130', gstCode: 'IO', taxRatePct: 0, preTripApplicable: true, isMajorCost: true,  estimateFormType: 'ODA',           varianceThreshold: 15 },
  { id: 'ET-CONF', teCode: '6140', name: 'Conference / Registration Fee', category: EXPENSE_CATEGORY.Conference, glAccount: 'GL-6140', gstCode: 'I9', taxRatePct: 9, preTripApplicable: true, isMajorCost: false, estimateFormType: 'STANDARD', varianceThreshold: 10 },
  // ---- Incidental / out-of-pocket types (shared ECS master) ----
  { id: 'ET-GND',  teCode: '6150', name: 'Ground Transportation',    category: EXPENSE_CATEGORY.Other,         glAccount: 'GL-6150', gstCode: 'IO', taxRatePct: 0, preTripApplicable: true, isMajorCost: false, estimateFormType: 'STANDARD',      varianceThreshold: 20 },
  { id: 'ET-CAR',  teCode: '6155', name: 'Car Rental',               category: EXPENSE_CATEGORY.Other,         glAccount: 'GL-6155', gstCode: 'IO', taxRatePct: 0, preTripApplicable: true, isMajorCost: false, estimateFormType: 'STANDARD',      varianceThreshold: 20 },
  { id: 'ET-MEAL', teCode: '6160', name: 'Meals & Subsistence',      category: EXPENSE_CATEGORY.Other,         glAccount: 'GL-6160', gstCode: 'IO', taxRatePct: 0, preTripApplicable: true, isMajorCost: false, estimateFormType: 'STANDARD',      varianceThreshold: 20 },
  { id: 'ET-VISA', teCode: '6170', name: 'Visa & Immigration Fees',  category: EXPENSE_CATEGORY.Other,         glAccount: 'GL-6170', gstCode: 'IO', taxRatePct: 0, preTripApplicable: true, isMajorCost: false, estimateFormType: 'STANDARD',      varianceThreshold: 25 },
  { id: 'ET-INS',  teCode: '6180', name: 'Travel Insurance',         category: EXPENSE_CATEGORY.Other,         glAccount: 'GL-6180', gstCode: 'I9', taxRatePct: 9, preTripApplicable: true, isMajorCost: false, estimateFormType: 'STANDARD',      varianceThreshold: 15 },
  { id: 'ET-COMM', teCode: '6185', name: 'Communications (roaming / Wi-Fi)', category: EXPENSE_CATEGORY.Other,  glAccount: 'GL-6185', gstCode: 'I9', taxRatePct: 9, preTripApplicable: true, isMajorCost: false, estimateFormType: 'STANDARD',      varianceThreshold: 25 },
  // Agency / booking / transaction & handling fee — the TMC service fee charged on the CTA. 9% claimable
  // input tax (I9); the GST-claimable flag on the charging account forks it to P9 when not recoverable.
  { id: 'ET-FEE',  teCode: '7510', name: 'Agency / Booking Fee',     category: EXPENSE_CATEGORY.Other,         glAccount: 'GL-7510', gstCode: 'I9', taxRatePct: 9, preTripApplicable: true, isMajorCost: false, estimateFormType: 'STANDARD',      varianceThreshold: 25 },
  { id: 'ET-OTH',  teCode: '6190', name: 'Other Travel Expenses',    category: EXPENSE_CATEGORY.Other,         glAccount: 'GL-6190', gstCode: 'I9', taxRatePct: 9, preTripApplicable: true, isMajorCost: false, estimateFormType: 'STANDARD',      varianceThreshold: 20 },
];
