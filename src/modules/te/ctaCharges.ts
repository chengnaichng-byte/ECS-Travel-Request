// DD-30 CTA charges — the ECS-side listing of central-settled (CTA-paid) travel charges, for
// finance to reconcile against the provider statement OUTSIDE ECS. This is deliberately ONE-SIDED:
// no matching, no status workflow, no statement import. Each charge carries the feed-reported CTA
// account; the CTA master resolves its credit GL (clearing) account, and charges are grouped by
// credit GL so the balance can be tied out.
//
// Scope: only bookings that are actually BOOKED/completed via the TMC are considered (not
// in-progress, failed or cancelled). A charge appears under its credit GL only once the feed
// reports it SETTLED on the CTA (ticketed/charged, with a charge date); a confirmed-but-not-yet
// -charged booking is shown separately under "pending settlement".
import { prisma } from '@/shared/db';
import { EcsCharging, EcsIdentity, EcsReference } from '@/shared/ecs/services';
import { lineSettlement } from '@/modules/pretrip/settlement';
import { EXPENSE_CATEGORY, BOOKING_STATUS } from '@/shared/enums';

export interface CtaChargeRow {
  requestId: string;
  requestNumber: string;
  authorisationNo: string | null;
  travellerName: string;
  pnr: string | null;
  ticketNo: string | null;
  provider: string;
  type: 'Airfare' | 'Accommodation';
  detail: string;
  chargeDate: string | null;   // date the charge posted to the CTA; null while pending settlement
  settled: boolean;
  amountSgd: number;
  ctaAccountId: string | null;
  ctaAccountLabel: string;
  clearingGlAccount: string;   // the credit GL account (CTA clearing) from the master
}

export interface ClearingGroup {
  clearingGlAccount: string;
  ctaAccountIds: string[];
  rows: CtaChargeRow[];
  subtotalSgd: number;
}

export interface CtaChargesView {
  settledGroups: ClearingGroup[];
  pending: CtaChargeRow[];
  totalSettled: number;
  settledCount: number;
  totalPending: number;
  pendingCount: number;
}

const iso = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
const r2 = (n: number) => Math.round(n * 100) / 100;

// A CTA charge is only real once the booking is confirmed/completed via the TMC — not while it is
// in progress, failed or cancelled.
const ELIGIBLE: string[] = [BOOKING_STATUS.Booked, BOOKING_STATUS.TravelCompleted];

export async function listCtaCharges(): Promise<CtaChargesView> {
  const bookings = await prisma.travelBooking.findMany({ include: { request: true, segments: true }, orderBy: { id: 'asc' } });
  const rows: CtaChargeRow[] = [];

  for (const b of bookings) {
    const req = b.request;
    if (!req) continue;
    if (!ELIGIBLE.includes(b.status)) continue;   // (1) booked/completed only
    const traveller = b.travellerId ?? req.travellerId;
    const cta = EcsCharging.ctaAccount(b.ctaAccountId);
    const mk = (type: 'Airfare' | 'Accommodation', detail: string, amountSgd: number): CtaChargeRow => ({
      requestId: req.id,
      requestNumber: req.requestNumber,
      authorisationNo: req.authorisationNo,
      travellerName: EcsIdentity.employee(traveller)?.name ?? req.guestName ?? traveller,
      pnr: b.pnr,
      ticketNo: b.ticketNo,
      provider: cta?.provider ?? '—',
      type, detail,
      chargeDate: b.ctaCharged ? iso(b.ctaChargeDate) : null,
      settled: b.ctaCharged,
      amountSgd,
      ctaAccountId: b.ctaAccountId,
      ctaAccountLabel: cta?.label ?? (b.ctaAccountId ?? 'Unmapped'),
      clearingGlAccount: cta?.clearingGlAccount ?? 'UNMAPPED',
    });

    // A guest booking is CTA-settled in full (airfare + accommodation — DD-21); guests file no TE
    // claim but their CTA charges are still captured here. For employees, airfare is central when
    // TMC-arranged and the hotel only when the requestor chose CTA settlement.
    const isGuest = req.travellerType === 'GUEST';

    const airSgd = r2((b.fare ?? 0) + (b.taxes ?? 0) + (b.fees ?? 0));
    if (airSgd > 0 && (isGuest || lineSettlement(req, EXPENSE_CATEGORY.Airfare) === 'CENTRAL')) {
      const air = b.segments.find((s) => s.type === 'AIR');
      rows.push(mk('Airfare', air ? `${air.originCode ?? ''} → ${air.destCode ?? ''}` : (EcsReference.city(req.destCity ?? '')?.name ?? req.destCity ?? '—'), airSgd));
    }
    const hotelSgd = r2(b.segments.filter((s) => s.type === 'HOTEL').reduce((s, x) => s + (x.amount ?? 0), 0));
    if (hotelSgd > 0 && (isGuest || lineSettlement(req, EXPENSE_CATEGORY.Accommodation) === 'CENTRAL')) {
      rows.push(mk('Accommodation', EcsReference.city(req.destCity ?? '')?.name ?? req.destCity ?? '—', hotelSgd));
    }
  }

  // (2) settled charges group by credit GL; pending (booked, not yet charged) are shown separately.
  const settledRows = rows.filter((r) => r.settled);
  const pending = rows.filter((r) => !r.settled);

  const byClearing = new Map<string, ClearingGroup>();
  for (const r of settledRows) {
    let g = byClearing.get(r.clearingGlAccount);
    if (!g) { g = { clearingGlAccount: r.clearingGlAccount, ctaAccountIds: [], rows: [], subtotalSgd: 0 }; byClearing.set(r.clearingGlAccount, g); }
    g.rows.push(r);
    g.subtotalSgd = r2(g.subtotalSgd + r.amountSgd);
    if (r.ctaAccountId && !g.ctaAccountIds.includes(r.ctaAccountId)) g.ctaAccountIds.push(r.ctaAccountId);
  }
  const settledGroups = [...byClearing.values()].sort((a, b) => a.clearingGlAccount.localeCompare(b.clearingGlAccount));

  return {
    settledGroups,
    pending,
    totalSettled: r2(settledRows.reduce((s, r) => s + r.amountSgd, 0)),
    settledCount: settledRows.length,
    totalPending: r2(pending.reduce((s, r) => s + r.amountSgd, 0)),
    pendingCount: pending.length,
  };
}
