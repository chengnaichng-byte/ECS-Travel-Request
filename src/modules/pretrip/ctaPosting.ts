// DD-31 CTA charge → SAP posting. A settled CTA charge posts to SAP on RECEIPT from the TMC (not at
// claim). The entry per charge is:
//   Dr  <expense GL>  (cost object)   net, split across the APPROVED charging allocation (cross charge)
//   Dr  Input GST GL                  tax (only when GST-rated; CTA air/accom are ZP zero-rated)
//   Cr  <CTA clearing GL>             gross (the credit side, from the CTA master)
// On a later cancellation/refund the same entry is posted REVERSED (auto-reversal).
//
// `postCtaChargesForRequest` persists a CtaPostingDocument per settled charge (idempotent) with the
// SAP document number, posting date and status. `computeCtaPostings` builds the journal for the
// report and attaches each charge's posting lifecycle (date / status / doc).
import { prisma } from '@/shared/db';
import { EcsIdentity, EcsReference } from '@/shared/ecs/services';
import { ctaAccountsMap } from './ctaMaster';
import { getSettings } from './settings';
import { lineSettlement } from './settlement';
import { EXPENSE_CATEGORY, BOOKING_STATUS } from '@/shared/enums';

export interface PostingLine {
  side: 'DR' | 'CR';
  glAccount: string;
  description: string;
  costObject: string | null;
  costObjectType: string | null;
  percent: number | null;
  amountSgd: number;
}

export interface CtaPosting {
  bookingId: string;
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
  crossCharge: boolean;
  source: string;
  lines: PostingLine[];
  balanced: boolean;
  // posting lifecycle (from the persisted CtaPostingDocument)
  sapDocNo: string | null;
  postingDate: string | null;
  postingStatus: string;
  isReversal: boolean;
}

interface Charge { chargeType: 'Airfare' | 'Accommodation'; expenseTypeId: string; grossSgd: number }
type BookingLike = { fare: number | null; taxes: number | null; fees: number | null; segments: { type: string; amount: number | null }[] };
type ReqLike = { travellerType: string | null; bookingArrangement: string | null; hotelSettlement: string | null };

const ELIGIBLE: string[] = [BOOKING_STATUS.Booked, BOOKING_STATUS.TravelCompleted];
const r2 = (n: number) => Math.round(n * 100) / 100;
const iso = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
const GST_INPUT_GL = 'GL-GST-INPUT';

/** The CTA (central-settled) charges carried by a booking. */
function chargesOf(b: BookingLike, req: ReqLike): Charge[] {
  const out: Charge[] = [];
  const isGuest = req.travellerType === 'GUEST';
  const air = r2((b.fare ?? 0) + (b.taxes ?? 0) + (b.fees ?? 0));
  if (air > 0 && (isGuest || lineSettlement(req, EXPENSE_CATEGORY.Airfare) === 'CENTRAL')) out.push({ chargeType: 'Airfare', expenseTypeId: 'ET-AIR', grossSgd: air });
  const hotel = r2(b.segments.filter((s) => s.type === 'HOTEL').reduce((s, x) => s + (x.amount ?? 0), 0));
  if (hotel > 0 && (isGuest || lineSettlement(req, EXPENSE_CATEGORY.Accommodation) === 'CENTRAL')) out.push({ chargeType: 'Accommodation', expenseTypeId: 'ET-ACC', grossSgd: hotel });
  return out;
}

/** DD-31 — post the settled CTA charges of a request to SAP on receipt (idempotent, one posting per
 *  booking + charge type). Creates a CtaPostingDocument with the SAP doc no, posting date and status. */
export async function postCtaChargesForRequest(requestId: string): Promise<void> {
  const settings = await getSettings();
  if (settings.ctaPostingTiming !== 'ON_RECEIPT') return;   // DD-31 config gate (else post at claim)
  const req = await prisma.travelRequest.findUnique({ where: { id: requestId }, include: { allocations: true, bookings: { include: { segments: true } } } });
  if (!req) return;
  const ctaMap = await ctaAccountsMap();
  for (const b of req.bookings) {
    if (!ELIGIBLE.includes(b.status)) continue;
    if (!b.ctaCharged) continue;                       // post only once the feed reports it settled
    const cta = b.ctaAccountId ? ctaMap.get(b.ctaAccountId) : undefined;
    const clearingGl = cta?.clearingGlAccount ?? 'UNMAPPED';
    const status = clearingGl === 'UNMAPPED' ? 'Failed' : 'Posted';
    const postingDate = iso(b.ctaChargeDate) ?? new Date().toISOString().slice(0, 10);
    for (const c of chargesOf(b, req)) {
      const existing = await prisma.ctaPostingDocument.findUnique({ where: { bookingId_chargeType: { bookingId: b.id, chargeType: c.chargeType } } });
      if (existing) continue;                          // idempotent
      const seq = (await prisma.ctaPostingDocument.count()) + 1;
      const sapDocNo = `SAP-CTA-${String(seq).padStart(6, '0')}`;
      await prisma.ctaPostingDocument.create({ data: { bookingId: b.id, requestId: req.id, chargeType: c.chargeType, sapDocNo, postingDate, status, grossSgd: c.grossSgd, clearingGlAccount: clearingGl } });
    }
  }
}

/** DD-31 auto-reversal — on cancellation/refund, reverse every Posted CTA posting of the request:
 *  the original is marked Reversed and a reversing SAP document is recorded. */
export async function reverseCtaChargesForRequest(requestId: string, dateIso?: string): Promise<void> {
  const date = dateIso ?? new Date().toISOString().slice(0, 10);
  const docs = await prisma.ctaPostingDocument.findMany({ where: { requestId, status: 'Posted' } });
  for (const d of docs) {
    await prisma.ctaPostingDocument.update({
      where: { id: d.id },
      data: { status: 'Reversed', reversalSapDocNo: d.sapDocNo.replace('SAP-CTA-', 'SAP-CTA-R'), reversedDate: date },
    });
  }
}

export interface CtaPostingsView { postings: CtaPosting[]; totalDr: number; totalCr: number; count: number }

/** Build the accounting-entries report: the journal per settled CTA charge, with the posting
 *  lifecycle (date/status/doc) attached from the persisted CtaPostingDocument. */
export async function computeCtaPostings(): Promise<CtaPostingsView> {
  const bookings = await prisma.travelBooking.findMany({ include: { request: { include: { allocations: true } }, segments: true }, orderBy: { id: 'asc' } });
  const ctaMap = await ctaAccountsMap();
  const docs = await prisma.ctaPostingDocument.findMany();
  const docMap = new Map(docs.map((d) => [`${d.bookingId}:${d.chargeType}`, d]));
  const postedBookingIds = new Set(docs.map((d) => d.bookingId));   // include posted-then-cancelled bookings
  const postings: CtaPosting[] = [];

  for (const b of bookings) {
    const req = b.request;
    if (!req) continue;
    if (!ELIGIBLE.includes(b.status) && !postedBookingIds.has(b.id)) continue;
    if (!b.ctaCharged) continue;
    const cta = b.ctaAccountId ? ctaMap.get(b.ctaAccountId) : undefined;
    const clearingGl = cta?.clearingGlAccount ?? 'UNMAPPED';
    const traveller = b.travellerId ?? req.travellerId;
    const travellerName = EcsIdentity.employee(traveller)?.name ?? req.guestName ?? traveller;
    const allocs = req.allocations.length
      ? req.allocations.map((a) => ({ code: a.chargingCode, type: a.chargingType, percent: a.percent }))
      : [{ code: 'UNALLOCATED', type: 'CC', percent: 100 }];

    for (const c of chargesOf(b, req)) {
      const et = EcsReference.expenseType(c.expenseTypeId);
      const gl = et?.glAccount ?? 'GL-UNKNOWN';
      const rate = et?.taxRatePct ?? 0;
      const gross = r2(c.grossSgd);
      const tax = rate > 0 ? r2((gross * rate) / (100 + rate)) : 0;
      const net = r2(gross - tax);
      const lines: PostingLine[] = [];
      let running = 0;
      allocs.forEach((a, i) => {
        const amt = i === allocs.length - 1 ? r2(net - running) : r2(net * (a.percent / 100));
        running = r2(running + amt);
        lines.push({ side: 'DR', glAccount: gl, description: `${et?.name ?? c.chargeType}`, costObject: a.code, costObjectType: a.type, percent: a.percent, amountSgd: amt });
      });
      if (tax > 0) lines.push({ side: 'DR', glAccount: GST_INPUT_GL, description: `Input GST (${et?.gstCode})`, costObject: null, costObjectType: null, percent: null, amountSgd: tax });
      lines.push({ side: 'CR', glAccount: clearingGl, description: `CTA clearing${b.ctaAccountId ? ` — ${b.ctaAccountId}` : ''}`, costObject: null, costObjectType: null, percent: null, amountSgd: gross });
      const dr = r2(lines.filter((l) => l.side === 'DR').reduce((s, l) => s + l.amountSgd, 0));
      const cr = r2(lines.filter((l) => l.side === 'CR').reduce((s, l) => s + l.amountSgd, 0));
      const doc = docMap.get(`${b.id}:${c.chargeType}`);
      const base: CtaPosting = {
        bookingId: b.id, requestId: req.id, requestNumber: req.requestNumber, authorisationNo: req.authorisationNo,
        travellerName, pnr: b.pnr, chargeType: c.chargeType, chargeDate: iso(b.ctaChargeDate),
        ctaAccountId: b.ctaAccountId, clearingGlAccount: clearingGl,
        grossSgd: gross, taxSgd: tax, netSgd: net, gstCode: et?.gstCode ?? '—',
        allocationNote: allocs.map((a) => `${a.code} ${a.percent}%`).join(' · '), crossCharge: allocs.length > 1,
        source: c.chargeType === 'Airfare' ? `fare ${fmt(b.fare)} + taxes ${fmt(b.taxes)} + fees ${fmt(b.fees)}` : 'hotel segment total',
        lines, balanced: Math.abs(dr - cr) < 0.005,
        sapDocNo: doc?.sapDocNo ?? null, postingDate: doc?.postingDate ?? null, postingStatus: doc?.status ?? 'Not posted',
        isReversal: false,
      };
      postings.push(base);
      // DD-31 auto-reversal: a Reversed charge also shows the reversing entry (Dr/Cr flipped).
      if (doc?.status === 'Reversed') {
        const revLines = lines.map((l) => ({ ...l, side: (l.side === 'DR' ? 'CR' : 'DR') as 'DR' | 'CR' }));
        postings.push({ ...base, lines: revLines, sapDocNo: doc.reversalSapDocNo ?? null, postingDate: doc.reversedDate ?? null, postingStatus: 'Reversed', isReversal: true });
      }
    }
  }

  const totalDr = r2(postings.reduce((s, p) => s + p.lines.filter((l) => l.side === 'DR').reduce((a, l) => a + l.amountSgd, 0), 0));
  const totalCr = r2(postings.reduce((s, p) => s + p.lines.filter((l) => l.side === 'CR').reduce((a, l) => a + l.amountSgd, 0), 0));
  return { postings, totalDr, totalCr, count: postings.length };
}

function fmt(n: number | null | undefined): string {
  return (n ?? 0).toLocaleString('en-SG', { minimumFractionDigits: 0 });
}
