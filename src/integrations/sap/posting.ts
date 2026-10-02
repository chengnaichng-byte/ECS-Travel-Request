// §36 Direct airfare posting to ERP (SAP). When the Airfare-treatment setting is
// DIRECT_SAP, the booked airfare does NOT flow through the expense claim — it posts
// straight to SAP against the trip's cost objects (CC/WBS), with the GL account derived
// from the airfare expense type. This is a mock interface (no live SAP connectivity); it
// builds the canonical posting document the ECS→SAP adapter would send.
import { EcsReference } from '@/shared/ecs/services';
import type { FullRequest } from '@/modules/pretrip/queries';

export interface SapCostObjectLine {
  code: string;            // CC / WBS id (the cost object)
  type: string;            // CC | WBS
  businessArea: string | null;
  companyCode: string | null;
  percent: number;
  amountSgd: number;       // booked airfare × this allocation's share
}

export interface SapAirfarePosting {
  documentType: 'AIRFARE_DIRECT';
  authorisationNumber: string;
  travellerRef: string;
  glAccount: string;       // §36 derived from the airfare expense type (ET-AIR → GL)
  currency: 'SGD';
  postingDate: string;
  bookingRefs: string[];   // PNR(s)
  amount: { fareSgd: number; taxesSgd: number; feesSgd: number; totalSgd: number };
  costObjects: SapCostObjectLine[];
}

const AIRFARE_EXPENSE_TYPE = 'ET-AIR';

/** Build the SAP airfare posting from a booked request. Aggregates the booked airfare
 *  across all bookings (one per traveller for a group fan-out) and splits it across the
 *  trip's charging allocations (the cost objects), rounding the last line to absorb
 *  rounding so the split always sums to the total. */
export function buildSapAirfarePosting(req: FullRequest, postingDate: Date = new Date()): SapAirfarePosting | null {
  const bookings = req.bookings.filter((b) => b.channel === 'TMC');
  if (bookings.length === 0) return null;
  const fareSgd = bookings.reduce((s, b) => s + (b.fare ?? 0), 0);
  const taxesSgd = bookings.reduce((s, b) => s + (b.taxes ?? 0), 0);
  const feesSgd = bookings.reduce((s, b) => s + (b.fees ?? 0), 0);
  const totalSgd = Math.round((fareSgd + taxesSgd + feesSgd) * 100) / 100;

  const allocations = req.allocations.length ? req.allocations : [{ chargingCode: 'UNALLOCATED', chargingType: 'CC', businessArea: null, companyCode: null, percent: 100 }];
  let running = 0;
  const costObjects: SapCostObjectLine[] = allocations.map((a, i) => {
    const raw = i === allocations.length - 1 ? totalSgd - running : Math.round(totalSgd * (a.percent / 100) * 100) / 100;
    running += raw;
    return { code: a.chargingCode, type: a.chargingType, businessArea: a.businessArea ?? null, companyCode: a.companyCode ?? null, percent: a.percent, amountSgd: Math.round(raw * 100) / 100 };
  });

  return {
    documentType: 'AIRFARE_DIRECT',
    authorisationNumber: req.authorisationNo ?? '',
    travellerRef: req.travellerId,
    glAccount: EcsReference.expenseType(AIRFARE_EXPENSE_TYPE)?.glAccount ?? 'GL-6110',
    currency: 'SGD',
    postingDate: postingDate.toISOString().slice(0, 10),
    bookingRefs: bookings.map((b) => b.pnr ?? '—'),
    amount: { fareSgd, taxesSgd, feesSgd, totalSgd },
    costObjects,
  };
}
