// DD-31 CTA charge → SAP posting. A settled CTA charge posts to SAP on RECEIPT from the TMC (not at
// claim). The posting is DRIVEN FROM THE FEED: each charge is the TMC's own per-charge breakdown
// (BookingCharge, persisted from inbound.charges[]) — its expense-type mapping, SAP tax code and GST
// amount are posted verbatim. ECS also re-derives the tax code/amount via its own GST logic and
// flags a mismatch (store-and-validate), but posts the feed's figures. A booking with no feed charge
// rows (legacy / a split PNR) falls back to deriving from fare/taxes/fees. The ECS settlement gate
// still decides WHICH charges post centrally (lineSettlement). The entry per charge is:
//   Dr  <expense GL>  (cost object)   net, split across the APPROVED charging allocation (cross charge)
//   Dr  Input GST GL                  external tax amount (only when > 0; air IZ / hotel IO = 0; fee I9 = 9%)
//   Cr  <CTA clearing GL>             gross (the credit side, from the CTA master)
// The SAP Reference is the feed invoice number (falls back to the PNR). On a later cancellation /
// refund the same entry is posted REVERSED (auto-reversal).
//
// `postCtaChargesForRequest` persists a CtaPostingDocument per settled charge (idempotent) with the
// SAP document number, posting date and status. `computeCtaPostings` builds the journal for the
// report and attaches each charge's posting lifecycle (date / status / doc).
import { prisma } from '@/shared/db';
import { EcsIdentity, EcsReference } from '@/shared/ecs/services';
import { ctaAccountsMap } from './ctaMaster';
import { lineSettlement } from './settlement';
import { resolveSapTaxCode } from '@/data/gstCodes';
import { airfareUpgrade, type AirfareUpgrade } from './upgrade';
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
  chargeType: 'Airfare' | 'Accommodation' | 'Fee';
  chargeDate: string | null;
  ctaAccountId: string | null;
  clearingGlAccount: string;
  grossSgd: number;
  taxSgd: number;              // external tax amount (GST) extracted from the gross
  netSgd: number;
  gstCode: string;             // SAP tax code (IZ/IO/I9/P9) — the figure posted
  allocationNote: string;
  crossCharge: boolean;
  source: string;              // human-readable amount basis (e.g. "fare + taxes")
  feedSourced: boolean;        // true = driven from the feed's BookingCharge; false = derived by ECS
  gstMismatch: boolean;        // store-and-validate: feed's tax code/amount disagrees with ECS logic
  validationNote: string | null;
  invoiceNo: string | null;    // feed invoice number
  sapReference: string | null; // SAP posting Reference = invoice no. (falls back to PNR)
  lines: PostingLine[];
  balanced: boolean;
  // posting lifecycle (from the persisted CtaPostingDocument)
  sapDocNo: string | null;
  postingDate: string | null;
  postingStatus: string;
  isReversal: boolean;
}

interface Charge {
  chargeType: 'Airfare' | 'Accommodation' | 'Fee';
  expenseTypeId: string;
  grossSgd: number;
  gstCode: string;             // SAP tax code posted (feed's when feed-sourced, else ECS-derived)
  gstAmountSgd: number;        // external tax amount posted
  feedSourced: boolean;
  gstMismatch: boolean;
  validationNote: string | null;
  upgrade?: AirfareUpgrade | null;  // #14 airfare line's upgrade split (NTU delta → M6; self-funded → gross reduced to entitlement)
}
type FeedCharge = { type: string; expenseTypeId: string; amountSgd: number; gstCode: string; gstAmountSgd: number; gstClaimable: boolean };
type BookingLike = { travellerId?: string | null; fare: number | null; taxes: number | null; fees: number | null; segments: { type: string; amount: number | null }[]; charges?: FeedCharge[] };
type AirfareEstLike = { category: string; travellerId: string | null; sgdAmount: number; entitlementFareSgd: number | null; upgradeFunding: string | null; upgradeDeltaCode: string | null };
type ReqLike = { travellerType: string | null; bookingArrangement: string | null; hotelSettlement: string | null; expenses?: AirfareEstLike[] };

const ELIGIBLE: string[] = [BOOKING_STATUS.Booked, BOOKING_STATUS.TravelCompleted];
const r2 = (n: number) => Math.round(n * 100) / 100;
const iso = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
const GST_INPUT_GL = 'GL-GST-INPUT';

/** Map a feed charge type to its ECS charge label + the settlement category that gates it. The
 *  agency/booking fee follows the airfare's settlement (it is the service fee on the air booking). */
function feedChargeMeta(t: string): { chargeType: 'Airfare' | 'Accommodation' | 'Fee'; category: string } | null {
  if (t === 'AIRFARE') return { chargeType: 'Airfare', category: EXPENSE_CATEGORY.Airfare };
  if (t === 'FEE') return { chargeType: 'Fee', category: EXPENSE_CATEGORY.Airfare };
  if (t === 'ACCOMMODATION') return { chargeType: 'Accommodation', category: EXPENSE_CATEGORY.Accommodation };
  return null;   // CAR / VISA not emitted by the prototype feed yet
}

/** Store-and-validate: re-derive the tax code + external tax amount via ECS's own GST logic and
 *  compare to what the feed asserted. ECS posts the FEED's figures; a disagreement is flagged only. */
function validateGst(expenseTypeId: string, grossSgd: number, feedCode: string, feedGstSgd: number, claimable: boolean): { mismatch: boolean; note: string | null } {
  const et = EcsReference.expenseType(expenseTypeId);
  const g = resolveSapTaxCode(et ?? { gstCode: 'IO' }, { claimable });
  const expectedTax = g.ratePct > 0 ? r2((grossSgd * g.ratePct) / (100 + g.ratePct)) : 0;
  const codeBad = g.code !== feedCode;
  const taxBad = Math.abs(expectedTax - r2(feedGstSgd)) > 0.01;
  if (!codeBad && !taxBad) return { mismatch: false, note: null };
  const parts: string[] = [];
  if (codeBad) parts.push(`tax code: feed ${feedCode} vs ECS ${g.code}`);
  if (taxBad) parts.push(`GST: feed ${fmt(feedGstSgd)} vs ECS ${fmt(expectedTax)}`);
  return { mismatch: true, note: parts.join('; ') };
}

/** The CTA (central-settled) charges carried by a booking. Driven from the feed's persisted
 *  per-charge breakdown when present; otherwise derived from fare/taxes/fees. The ECS settlement
 *  gate (lineSettlement) decides which charges post centrally in both paths. */
function chargesOf(b: BookingLike, req: ReqLike): Charge[] {
  const isGuest = req.travellerType === 'GUEST';
  const central = (cat: string) => isGuest || lineSettlement(req, cat) === 'CENTRAL';

  // #14 the airfare line's travel-class upgrade (from the matching airfare estimate). The entitlement
  // stays on the request's allocation; an NTU-funded delta posts to M6; a self-funded delta is
  // traveller-direct, so the CTA sees the entitlement only (the charge gross is reduced).
  const airEst = req.expenses?.find((e) => e.category === EXPENSE_CATEGORY.Airfare && (e.travellerId === (b.travellerId ?? null) || e.travellerId === null));
  const up = airEst ? airfareUpgrade({ sgdAmount: airEst.sgdAmount, entitlementFareSgd: airEst.entitlementFareSgd, upgradeFunding: airEst.upgradeFunding, upgradeDeltaCode: airEst.upgradeDeltaCode }) : null;
  const finalize = (charges: Charge[]): Charge[] => {
    if (!up || !up.isUpgrade) return charges;
    const air = charges.find((c) => c.chargeType === 'Airfare');
    if (!air) return charges;
    air.upgrade = up;
    if (up.funding === 'SELF' && up.fareSgd > 0) {
      // CTA is charged the entitlement only; the delta is settled by the traveller with the TMC.
      const ratio = up.entitlementSgd / up.fareSgd;
      air.grossSgd = r2(air.grossSgd * ratio);
      air.gstAmountSgd = r2(air.gstAmountSgd * ratio);
    }
    return charges;
  };

  // Primary: drive the posting from the feed's own charge rows (store-and-validate).
  if (b.charges && b.charges.length) {
    const out: Charge[] = [];
    for (const c of b.charges) {
      const meta = feedChargeMeta(c.type);
      if (!meta) continue;
      if (!central(meta.category)) continue;            // ECS settlement gate still applies
      const v = validateGst(c.expenseTypeId, c.amountSgd, c.gstCode, c.gstAmountSgd, c.gstClaimable);
      out.push({ chargeType: meta.chargeType, expenseTypeId: c.expenseTypeId, grossSgd: r2(c.amountSgd), gstCode: c.gstCode, gstAmountSgd: r2(c.gstAmountSgd), feedSourced: true, gstMismatch: v.mismatch, validationNote: v.note });
    }
    return finalize(out);
  }

  // Fallback: derive from fare/taxes/fees when the booking has no feed charge rows.
  const derive = (chargeType: 'Airfare' | 'Accommodation' | 'Fee', etId: string, gross: number): Charge => {
    const et = EcsReference.expenseType(etId);
    const g = resolveSapTaxCode(et ?? { gstCode: 'IO' }, { claimable: true });
    const tax = g.ratePct > 0 ? r2((gross * g.ratePct) / (100 + g.ratePct)) : 0;
    return { chargeType, expenseTypeId: etId, grossSgd: gross, gstCode: g.code, gstAmountSgd: tax, feedSourced: false, gstMismatch: false, validationNote: null };
  };
  const out: Charge[] = [];
  const airCentral = central(EXPENSE_CATEGORY.Airfare);
  const fare = r2((b.fare ?? 0) + (b.taxes ?? 0));   // airfare = fare + airline taxes (IZ)
  if (fare > 0 && airCentral) out.push(derive('Airfare', 'ET-AIR', fare));
  const fees = r2(b.fees ?? 0);                       // agency/booking fee — its own line (I9)
  if (fees > 0 && airCentral) out.push(derive('Fee', 'ET-FEE', fees));
  const hotel = r2(b.segments.filter((s) => s.type === 'HOTEL').reduce((s, x) => s + (x.amount ?? 0), 0));
  if (hotel > 0 && central(EXPENSE_CATEGORY.Accommodation)) out.push(derive('Accommodation', 'ET-ACC', hotel));
  return finalize(out);
}

/** DD-31 — post the settled CTA charges of a request to SAP on receipt (idempotent, one posting per
 *  booking + charge type). Creates a CtaPostingDocument with the SAP doc no, posting date and status. */
export async function postCtaChargesForRequest(requestId: string): Promise<void> {
  const req = await prisma.travelRequest.findUnique({ where: { id: requestId }, include: { allocations: true, expenses: true, bookings: { include: { segments: true, charges: true } } } });
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

/** DD-31 auto-reversal — on cancellation/refund, reverse the request's Posted CTA postings using the
 *  feed's refund/penalty split: the REFUNDED amount reverses, while a non-refundable PENALTY stays a
 *  charge. The penalty is retained against the airfare charge first (the airline cancellation penalty),
 *  spilling to the remaining charges; with no penalty (e.g. an un-ticketed void) the whole gross
 *  reverses. The original is marked Reversed with the retained amount and a reversing SAP document. */
export async function reverseCtaChargesForRequest(requestId: string, opts?: { penaltySgd?: number; dateIso?: string }): Promise<void> {
  const date = opts?.dateIso ?? new Date().toISOString().slice(0, 10);
  let remaining = Math.max(r2(opts?.penaltySgd ?? 0), 0);
  const order: Record<string, number> = { Airfare: 0, Fee: 1, Car: 2, Visa: 3, Accommodation: 4 };
  const docs = (await prisma.ctaPostingDocument.findMany({ where: { requestId, status: 'Posted' } }))
    .sort((a, b) => (order[a.chargeType] ?? 9) - (order[b.chargeType] ?? 9));
  for (const d of docs) {
    const retained = r2(Math.min(remaining, d.grossSgd));   // penalty kept on this charge (not reversed)
    remaining = r2(remaining - retained);
    await prisma.ctaPostingDocument.update({
      where: { id: d.id },
      data: { status: 'Reversed', retainedSgd: retained, reversalSapDocNo: d.sapDocNo.replace('SAP-CTA-', 'SAP-CTA-R'), reversedDate: date },
    });
  }
}

export interface CtaPostingsView { postings: CtaPosting[]; totalDr: number; totalCr: number; count: number }

/** Build the accounting-entries report: the journal per settled CTA charge, with the posting
 *  lifecycle (date/status/doc) attached from the persisted CtaPostingDocument. */
export async function computeCtaPostings(): Promise<CtaPostingsView> {
  const bookings = await prisma.travelBooking.findMany({ include: { request: { include: { allocations: true, expenses: true } }, segments: true, charges: true }, orderBy: { id: 'asc' } });
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
      // Driven from the charge's posted figures (the feed's when feed-sourced, else ECS-derived).
      const gross = r2(c.grossSgd);
      const tax = r2(c.gstAmountSgd);                 // external tax amount
      const net = r2(gross - tax);
      const lines: PostingLine[] = [];
      // #14 NTU-funded upgrade — the entitlement portion charges the request's allocation; the delta
      // portion charges the fixed M6 cost centre. (Self-funded already reduced the charge to the
      // entitlement in chargesOf, so it falls through to the normal allocation split.)
      const ntuUpgrade = c.upgrade && c.upgrade.isUpgrade && c.upgrade.funding === 'NTU' && c.upgrade.fareSgd > 0;
      const entNet = ntuUpgrade ? r2(net * (c.upgrade!.entitlementSgd / c.upgrade!.fareSgd)) : net;
      const deltaNet = ntuUpgrade ? r2(net - entNet) : 0;
      let running = 0;
      allocs.forEach((a, i) => {
        const amt = i === allocs.length - 1 ? r2(entNet - running) : r2(entNet * (a.percent / 100));
        running = r2(running + amt);
        lines.push({ side: 'DR', glAccount: gl, description: ntuUpgrade ? `${et?.name ?? c.chargeType} — entitlement` : `${et?.name ?? c.chargeType}`, costObject: a.code, costObjectType: a.type, percent: a.percent, amountSgd: amt });
      });
      if (ntuUpgrade && deltaNet > 0) lines.push({ side: 'DR', glAccount: gl, description: `${et?.name ?? c.chargeType} — upgrade differential`, costObject: c.upgrade!.deltaCostCentre, costObjectType: 'CC', percent: null, amountSgd: deltaNet });
      if (tax > 0) lines.push({ side: 'DR', glAccount: GST_INPUT_GL, description: `Input GST (${c.gstCode})`, costObject: null, costObjectType: null, percent: null, amountSgd: tax });
      lines.push({ side: 'CR', glAccount: clearingGl, description: `CTA clearing${b.ctaAccountId ? ` — ${b.ctaAccountId}` : ''}`, costObject: null, costObjectType: null, percent: null, amountSgd: gross });
      const dr = r2(lines.filter((l) => l.side === 'DR').reduce((s, l) => s + l.amountSgd, 0));
      const cr = r2(lines.filter((l) => l.side === 'CR').reduce((s, l) => s + l.amountSgd, 0));
      const doc = docMap.get(`${b.id}:${c.chargeType}`);
      const sapReference = b.invoiceNo ?? b.pnr;
      const base: CtaPosting = {
        bookingId: b.id, requestId: req.id, requestNumber: req.requestNumber, authorisationNo: req.authorisationNo,
        travellerName, pnr: b.pnr, chargeType: c.chargeType, chargeDate: iso(b.ctaChargeDate),
        ctaAccountId: b.ctaAccountId, clearingGlAccount: clearingGl,
        grossSgd: gross, taxSgd: tax, netSgd: net, gstCode: c.gstCode,
        allocationNote: allocs.map((a) => `${a.code} ${a.percent}%`).join(' · '), crossCharge: allocs.length > 1,
        source: c.chargeType === 'Airfare' ? `fare ${fmt(b.fare)} + taxes ${fmt(b.taxes)}` : c.chargeType === 'Fee' ? `agency / booking fee ${fmt(b.fees)}` : 'hotel segment total',
        feedSourced: c.feedSourced, gstMismatch: c.gstMismatch, validationNote: c.validationNote,
        invoiceNo: b.invoiceNo, sapReference,
        lines, balanced: Math.abs(dr - cr) < 0.005,
        sapDocNo: doc?.sapDocNo ?? null, postingDate: doc?.postingDate ?? null,
        postingStatus: doc?.status === 'Reversed' && r2(doc.retainedSgd ?? 0) > 0 ? 'Partially reversed' : (doc?.status ?? 'Not posted'),
        isReversal: false,
      };
      postings.push(base);
      // DD-31 auto-reversal: a Reversed charge also shows the reversing entry (Dr/Cr flipped). On a
      // cancellation with a refund/penalty split, only the REFUNDED amount reverses (scaled); the
      // retained penalty stays posted, so the charge's net = the penalty.
      if (doc?.status === 'Reversed') {
        const retained = r2(doc.retainedSgd ?? 0);
        const refunded = r2(gross - retained);
        if (refunded > 0.005) {
          const ratio = gross > 0 ? refunded / gross : 1;
          const revLines = lines.map((l) => ({ ...l, side: (l.side === 'DR' ? 'CR' : 'DR') as 'DR' | 'CR', amountSgd: r2(l.amountSgd * ratio) }));
          // keep the reversal balanced: the clearing line = the sum of the (scaled) expense + GST lines.
          const clSum = r2(revLines.filter((l) => l.glAccount !== clearingGl).reduce((s, l) => s + l.amountSgd, 0));
          const cl = revLines.find((l) => l.glAccount === clearingGl);
          if (cl) cl.amountSgd = clSum;
          const refTax = r2(tax * ratio);
          postings.push({
            ...base, lines: revLines, grossSgd: refunded, taxSgd: refTax, netSgd: r2(refunded - refTax),
            source: retained > 0 ? `refund ${fmt(refunded)} — penalty ${fmt(retained)} retained` : base.source,
            sapDocNo: doc.reversalSapDocNo ?? null, postingDate: doc.reversedDate ?? null,
            postingStatus: retained > 0 ? 'Reversed (refund)' : 'Reversed', isReversal: true,
          });
        }
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
