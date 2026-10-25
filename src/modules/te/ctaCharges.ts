// DD-30 CTA charges — the ECS-side listing of central-settled (CTA-paid) travel charges, for
// finance to reconcile against the provider statement OUTSIDE ECS. This is deliberately ONE-SIDED:
// no matching, no status workflow, no statement import. Each charge carries the feed-reported CTA
// account; the CTA master resolves its clearing account, and charges are grouped by clearing
// account so the balance can be tied out.
import { prisma } from '@/shared/db';
import { EcsCharging, EcsIdentity, EcsReference } from '@/shared/ecs/services';
import { lineSettlement } from '@/modules/pretrip/settlement';
import { EXPENSE_CATEGORY } from '@/shared/enums';

export interface CtaChargeRow {
  requestId: string;
  requestNumber: string;
  authorisationNo: string | null;
  claimId: string | null;
  travellerName: string;
  pnr: string | null;
  ticketNo: string | null;
  provider: string;
  type: 'Airfare' | 'Accommodation';
  detail: string;
  bookedDate: string | null;
  amountSgd: number;
  ctaAccountId: string | null;
  ctaAccountLabel: string;
  clearingGlAccount: string;
}

export interface ClearingGroup {
  clearingGlAccount: string;
  ctaAccountIds: string[];
  rows: CtaChargeRow[];
  subtotalSgd: number;
}

const iso = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);

export async function listCtaCharges(): Promise<{ groups: ClearingGroup[]; totalSgd: number; rowCount: number }> {
  const bookings = await prisma.travelBooking.findMany({ include: { request: true, segments: true }, orderBy: { id: 'asc' } });
  const rows: CtaChargeRow[] = [];

  for (const b of bookings) {
    const req = b.request;
    if (!req) continue;
    const traveller = b.travellerId ?? req.travellerId;
    const link = await prisma.travelExpenseLink.findFirst({ where: { requestId: req.id } });
    const cta = EcsCharging.ctaAccount(b.ctaAccountId);
    const mk = (type: 'Airfare' | 'Accommodation', detail: string, date: string | null, amountSgd: number): CtaChargeRow => ({
      requestId: req.id,
      requestNumber: req.requestNumber,
      authorisationNo: req.authorisationNo,
      claimId: link?.claimId ?? null,
      travellerName: EcsIdentity.employee(traveller)?.name ?? req.guestName ?? traveller,
      pnr: b.pnr,
      ticketNo: b.ticketNo,
      provider: cta?.provider ?? '—',
      type, detail, bookedDate: date, amountSgd,
      ctaAccountId: b.ctaAccountId,
      ctaAccountLabel: cta?.label ?? (b.ctaAccountId ?? 'Unmapped'),
      clearingGlAccount: cta?.clearingGlAccount ?? 'UNMAPPED',
    });

    // A guest booking is CTA-settled in full (airfare + accommodation are paid centrally /
    // direct-billed — DD-21): guests file no TE claim, but their CTA charges are still captured and
    // reconciled here. For employees, airfare is central when TMC-arranged and the hotel only when
    // the requestor chose CTA settlement.
    const isGuest = req.travellerType === 'GUEST';

    const airSgd = Math.round(((b.fare ?? 0) + (b.taxes ?? 0) + (b.fees ?? 0)) * 100) / 100;
    if (airSgd > 0 && (isGuest || lineSettlement(req, EXPENSE_CATEGORY.Airfare) === 'CENTRAL')) {
      const air = b.segments.find((s) => s.type === 'AIR');
      rows.push(mk('Airfare', air ? `${air.originCode ?? ''} → ${air.destCode ?? ''}` : (EcsReference.city(req.destCity ?? '')?.name ?? req.destCity ?? '—'), iso(air?.departDate), airSgd));
    }
    const hotelSgd = Math.round(b.segments.filter((s) => s.type === 'HOTEL').reduce((s, x) => s + (x.amount ?? 0), 0) * 100) / 100;
    if (hotelSgd > 0 && (isGuest || lineSettlement(req, EXPENSE_CATEGORY.Accommodation) === 'CENTRAL')) {
      const hotel = b.segments.find((s) => s.type === 'HOTEL');
      rows.push(mk('Accommodation', EcsReference.city(req.destCity ?? '')?.name ?? req.destCity ?? '—', iso(hotel?.departDate), hotelSgd));
    }
  }

  // Group by clearing account.
  const byClearing = new Map<string, ClearingGroup>();
  for (const r of rows) {
    let g = byClearing.get(r.clearingGlAccount);
    if (!g) { g = { clearingGlAccount: r.clearingGlAccount, ctaAccountIds: [], rows: [], subtotalSgd: 0 }; byClearing.set(r.clearingGlAccount, g); }
    g.rows.push(r);
    g.subtotalSgd = Math.round((g.subtotalSgd + r.amountSgd) * 100) / 100;
    if (r.ctaAccountId && !g.ctaAccountIds.includes(r.ctaAccountId)) g.ctaAccountIds.push(r.ctaAccountId);
  }
  const groups = [...byClearing.values()].sort((a, b) => a.clearingGlAccount.localeCompare(b.clearingGlAccount));
  const totalSgd = Math.round(rows.reduce((s, r) => s + r.amountSgd, 0) * 100) / 100;
  return { groups, totalSgd, rowCount: rows.length };
}
