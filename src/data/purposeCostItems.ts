// §4.4 Default per-travel-purpose cost-item profiles — the factory set seeded into the editable
// PurposeCostItem master (admin-maintained on the Purpose Cost Items setup screen). Each entry says a
// given expense type is a "possible cost item" for a purpose, with an optional standard cost that
// pre-fills a declarable line. Computed items (accommodation, ODA) ignore the standard cost — they
// derive from policy (city cap / daily rate). Inactive purposes carry no profile.
import { travelPurposes } from './travelPurposes';

export interface PurposeCostItemDefault {
  purposeId: string;
  expenseTypeId: string;
  standardCostSgd: number | null;
  sortOrder: number;
}

// The base set every active purpose carries; training/conference purposes also carry a conference fee.
const BASE: { id: string; std: number | null; order: number }[] = [
  { id: 'ET-AIR', std: null, order: 1 }, // airfare — destination-specific, prompt (declarable)
  { id: 'ET-ACC', std: null, order: 2 }, // overseas accommodation — policy-computed (city cap)
  { id: 'ET-ODA', std: null, order: 3 }, // overseas daily allowance — policy-computed (daily rate)
  { id: 'ET-GND', std: 80, order: 4 },   // ground transportation — nominal default (declarable)
  { id: 'ET-INS', std: 60, order: 5 },   // travel insurance — nominal default (declarable)
];
const CONF = { id: 'ET-CONF', std: null, order: 6 }; // conference / registration fee — prompt (declarable)

export const defaultPurposeCostItems: PurposeCostItemDefault[] = travelPurposes
  .filter((p) => p.active)
  .flatMap((p) => {
    const items = p.id.startsWith('TP-TC-') ? [...BASE, CONF] : [...BASE];
    return items.map((it) => ({ purposeId: p.id, expenseTypeId: it.id, standardCostSgd: it.std, sortOrder: it.order }));
  });
