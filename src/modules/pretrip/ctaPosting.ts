// DD-31 (proposed) CTA charge → SAP accounting-entry computation. Read-only: it builds the GL
// journal each settled CTA charge WOULD post (the posting itself is not wired yet — this is the
// preview report for finance to validate the entries before build).
//
// Per settled CTA charge the entry is:
//   Dr  <expense GL>  (cost object)   net amount, split across the APPROVED charging allocation
//   Dr  Input GST GL                  tax (only when the expense type is GST-rated; CTA airfare &
//                                     accommodation are ZP zero-rated → no tax line)
//   Cr  <CTA clearing GL>             gross amount (the credit side, from the CTA master)
// On a later cancellation/refund the same entry is posted REVERSED (auto-reversal).
import { prisma } from '@/shared/db';
import { EcsIdentity, EcsReference } from '@/shared/ecs/services';
import { ctaAccountsMap } from './ctaMaster';
import { lineSettlement } from './settlement';
import { EXPENSE_CATEGORY, BOOKING_STATUS } from '@/shared/enums';

export interface PostingLine {
  side: 'DR' | 'CR';
  glAccount: string;
  description: string;
  costObject: string | null;
  costObjectType: string | null;
  amountSgd: number;
}

export interface CtaPosting {
  requestId: string;
  requestNumber: string;
  authorisationNo: string | null;
  travellerName: string;
  pnr: string | null;
  chargeType: 'Airfare' | 'Accommodation';
  chargeDate: string | null;
  ctaAccountId: string | null;
  clearingGlAccount: string;
  grossSgd: number;
  taxSgd: number;
  netSgd: number;
  gstCode: string;
  allocationNote: string;
  source: string;
  lines: PostingLine[];
  balanced: boolean;
}

const ELIGIBLE: string[] = [BOOKING_STATUS.Booked, BOOKING_STATUS.TravelCompleted];
const r2 = (n: number) => Math.round(n * 100) / 100;
const iso = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
const GST_INPUT_GL = 'GL-GST-INPUT';

export interface CtaPostingsView { postings: CtaPosting[]; totalDr: number; totalCr: number; count: number }

export async function computeCtaPostings(): Promise<CtaPostingsView> {
  const bookings = await prisma.travelBooking.findMany({ include: { request: { include: { allocations: true } }, segments: true }, orderBy: { id: 'asc' } });
  const ctaMap = await ctaAccountsMap();
  const postings: CtaPosting[] = [];

  for (const b of bookings) {
    const req = b.request;
    if (!req) continue;
    if (!ELIGIBLE.includes(b.status)) continue;   // booked/completed via TMC only
    if (!b.ctaCharged) continue;                   // only charges the feed reports settled post to SAP
    const cta = b.ctaAccountId ? ctaMap.get(b.ctaAccountId) : undefined;
    const clearingGl = cta?.clearingGlAccount ?? 'UNMAPPED';
    const traveller = b.travellerId ?? req.travellerId;
    const travellerName = EcsIdentity.employee(traveller)?.name ?? req.guestName ?? traveller;
    const isGuest = req.travellerType === 'GUEST';
    const allocs = req.allocations.length
      ? req.allocations.map((a) => ({ code: a.chargingCode, type: a.chargingType, percent: a.percent }))
      : [{ code: 'UNALLOCATED', type: 'CC', percent: 100 }];

    const build = (chargeType: 'Airfare' | 'Accommodation', expenseTypeId: string, amount: number, source: string) => {
      const et = EcsReference.expenseType(expenseTypeId);
      const gl = et?.glAccount ?? 'GL-UNKNOWN';
      const rate = et?.taxRatePct ?? 0;
      const gross = r2(amount);
      const tax = rate > 0 ? r2((gross * rate) / (100 + rate)) : 0;   // GST-inclusive
      const net = r2(gross - tax);
      const lines: PostingLine[] = [];
      // Dr expense net, split across the approved allocation (last line absorbs rounding).
      let running = 0;
      allocs.forEach((a, i) => {
        const amt = i === allocs.length - 1 ? r2(net - running) : r2(net * (a.percent / 100));
        running = r2(running + amt);
        lines.push({ side: 'DR', glAccount: gl, description: `${et?.name ?? chargeType}`, costObject: a.code, costObjectType: a.type, amountSgd: amt });
      });
      if (tax > 0) lines.push({ side: 'DR', glAccount: GST_INPUT_GL, description: `Input GST (${et?.gstCode})`, costObject: null, costObjectType: null, amountSgd: tax });
      // Cr CTA clearing (gross).
      lines.push({ side: 'CR', glAccount: clearingGl, description: `CTA clearing${b.ctaAccountId ? ` — ${b.ctaAccountId}` : ''}`, costObject: null, costObjectType: null, amountSgd: gross });
      const dr = r2(lines.filter((l) => l.side === 'DR').reduce((s, l) => s + l.amountSgd, 0));
      const cr = r2(lines.filter((l) => l.side === 'CR').reduce((s, l) => s + l.amountSgd, 0));
      postings.push({
        requestId: req.id, requestNumber: req.requestNumber, authorisationNo: req.authorisationNo,
        travellerName, pnr: b.pnr, chargeType, chargeDate: iso(b.ctaChargeDate),
        ctaAccountId: b.ctaAccountId, clearingGlAccount: clearingGl,
        grossSgd: gross, taxSgd: tax, netSgd: net, gstCode: et?.gstCode ?? '—',
        allocationNote: allocs.map((a) => `${a.code} ${a.percent}%`).join(' · '),
        source, lines, balanced: Math.abs(dr - cr) < 0.005,
      });
    };

    const airSgd = r2((b.fare ?? 0) + (b.taxes ?? 0) + (b.fees ?? 0));
    if (airSgd > 0 && (isGuest || lineSettlement(req, EXPENSE_CATEGORY.Airfare) === 'CENTRAL')) {
      build('Airfare', 'ET-AIR', airSgd, `fare ${fmt(b.fare)} + taxes ${fmt(b.taxes)} + fees ${fmt(b.fees)}`);
    }
    const hotelSgd = r2(b.segments.filter((s) => s.type === 'HOTEL').reduce((s, x) => s + (x.amount ?? 0), 0));
    if (hotelSgd > 0 && (isGuest || lineSettlement(req, EXPENSE_CATEGORY.Accommodation) === 'CENTRAL')) {
      build('Accommodation', 'ET-ACC', hotelSgd, `hotel segment total`);
    }
  }

  const totalDr = r2(postings.reduce((s, p) => s + p.lines.filter((l) => l.side === 'DR').reduce((a, l) => a + l.amountSgd, 0), 0));
  const totalCr = r2(postings.reduce((s, p) => s + p.lines.filter((l) => l.side === 'CR').reduce((a, l) => a + l.amountSgd, 0), 0));
  return { postings, totalDr, totalCr, count: postings.length };
}

function fmt(n: number | null | undefined): string {
  return (n ?? 0).toLocaleString('en-SG', { minimumFractionDigits: 0 });
}
