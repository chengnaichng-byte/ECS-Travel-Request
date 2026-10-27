// GST / tax code master — the ECS ⇄ SAP shared tax codes (IZ / IO / I9 / P9). These are the exact
// codes SAP's JV posting expects in its `Tax Code` field, so ECS consumes this list read-only rather
// than maintaining a parallel one. Per the TREX OBT→SAP journal interface ("GST Logic"):
//   IZ  input tax, zero-rated   — international services (airfare)
//   IO  input tax, out of scope — overseas consumption (hotel, car rental, visa, overseas services)
//   I9  input tax 9%, claimable — local agency / booking / handling / transaction fees (GST recoverable)
//   P9  input tax 9%, blocked   — same fees where GST is NOT recoverable (non-claimable)
// The code a charge carries is its expense type's default (maintained in the expense-type master);
// the only runtime fork is I9 ↔ P9, decided by the charging account's GST-claimable flag.
import type { ExpenseType } from './expenseTypes';

export type SapTaxCode = 'IZ' | 'IO' | 'I9' | 'P9';

export interface GstCode {
  code: SapTaxCode;
  ratePct: number;
  recoverable: boolean;              // input tax claimable / recoverable
  scope: 'ZERO_RATED' | 'OUT_OF_SCOPE' | 'STANDARD';
  description: string;
}

export const gstCodes: GstCode[] = [
  { code: 'IZ', ratePct: 0, recoverable: true,  scope: 'ZERO_RATED',   description: 'Input tax — zero-rated international service (airfare)' },
  { code: 'IO', ratePct: 0, recoverable: false, scope: 'OUT_OF_SCOPE', description: 'Input tax — out of scope, overseas consumption (hotel, car rental, visa)' },
  { code: 'I9', ratePct: 9, recoverable: true,  scope: 'STANDARD',     description: 'Input tax 9% — claimable (local agency / booking / handling fee)' },
  { code: 'P9', ratePct: 9, recoverable: false, scope: 'STANDARD',     description: 'Input tax 9% — blocked / non-claimable (local fee, GST not recoverable)' },
];

export const gstCodeMap = new Map<SapTaxCode, GstCode>(gstCodes.map((g) => [g.code, g]));

/**
 * ECS GST determination logic (shared with SAP). The expense type carries the default tax code
 * (IZ / IO / I9); the only runtime decision is the I9 ↔ P9 fork for 9% fee lines, driven by the
 * charging account's GST-claimable flag (Y/X → claimable → I9; N/blank → not claimable → P9).
 */
export function resolveSapTaxCode(et: Pick<ExpenseType, 'gstCode'>, opts?: { claimable?: boolean }): GstCode {
  const claimable = opts?.claimable ?? true;
  let code = (et.gstCode as SapTaxCode) ?? 'IO';
  if (code === 'I9' && !claimable) code = 'P9';   // the only runtime fork
  return gstCodeMap.get(code) ?? gstCodeMap.get('IO')!;
}
