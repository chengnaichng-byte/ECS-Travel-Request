// §13.7 Monthly SGD exchange rates (ECS/SAP monthly rate). §13.4: foreign-currency
// estimates are converted using the monthly rate effective on the submission date, and
// the SGD conversion is locked at final approval (see relockFx in actions.ts).
export interface FxRate { currency: string; sgdPerUnit: number; month: string; } // month = YYYY-MM

// Effective-dated monthly table. SGD is the base (=1); other rates drift month to month.
export const fxRates: FxRate[] = [
  { currency: 'SGD', sgdPerUnit: 1, month: '2026-06' }, { currency: 'JPY', sgdPerUnit: 0.0089, month: '2026-06' }, { currency: 'GBP', sgdPerUnit: 1.69, month: '2026-06' }, { currency: 'EUR', sgdPerUnit: 1.44, month: '2026-06' },
  { currency: 'SGD', sgdPerUnit: 1, month: '2026-07' }, { currency: 'JPY', sgdPerUnit: 0.0091, month: '2026-07' }, { currency: 'GBP', sgdPerUnit: 1.71, month: '2026-07' }, { currency: 'EUR', sgdPerUnit: 1.46, month: '2026-07' },
  { currency: 'SGD', sgdPerUnit: 1, month: '2026-08' }, { currency: 'JPY', sgdPerUnit: 0.0090, month: '2026-08' }, { currency: 'GBP', sgdPerUnit: 1.72, month: '2026-08' }, { currency: 'EUR', sgdPerUnit: 1.47, month: '2026-08' },
  { currency: 'SGD', sgdPerUnit: 1, month: '2026-09' }, { currency: 'JPY', sgdPerUnit: 0.0092, month: '2026-09' }, { currency: 'GBP', sgdPerUnit: 1.70, month: '2026-09' }, { currency: 'EUR', sgdPerUnit: 1.45, month: '2026-09' },
  { currency: 'SGD', sgdPerUnit: 1, month: '2026-10' }, { currency: 'JPY', sgdPerUnit: 0.0093, month: '2026-10' }, { currency: 'GBP', sgdPerUnit: 1.73, month: '2026-10' }, { currency: 'EUR', sgdPerUnit: 1.48, month: '2026-10' },
  { currency: 'SGD', sgdPerUnit: 1, month: '2026-11' }, { currency: 'JPY', sgdPerUnit: 0.0092, month: '2026-11' }, { currency: 'GBP', sgdPerUnit: 1.74, month: '2026-11' }, { currency: 'EUR', sgdPerUnit: 1.49, month: '2026-11' },
  { currency: 'SGD', sgdPerUnit: 1, month: '2026-12' }, { currency: 'JPY', sgdPerUnit: 0.0091, month: '2026-12' }, { currency: 'GBP', sgdPerUnit: 1.73, month: '2026-12' }, { currency: 'EUR', sgdPerUnit: 1.48, month: '2026-12' },
];

export const currencies = ['SGD', 'JPY', 'GBP', 'EUR'];

/** Rate effective on `onMonth` (YYYY-MM): the latest seeded month on or before it. When
 * no month is given, the latest seeded rate is used. */
export function sgdPerUnit(currency: string, onMonth?: string): number {
  const rows = fxRates.filter((f) => f.currency === currency).sort((a, b) => (a.month < b.month ? -1 : 1));
  if (rows.length === 0) return 1;
  if (!onMonth) return rows[rows.length - 1].sgdPerUnit;
  const eligible = rows.filter((r) => r.month <= onMonth);
  return (eligible.length ? eligible[eligible.length - 1] : rows[0]).sgdPerUnit;
}
