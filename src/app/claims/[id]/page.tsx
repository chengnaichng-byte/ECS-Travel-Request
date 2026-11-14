// TR-16 Create Travel Expense Claim (ECS format, §13.8 / §17) — pre-populated from the
// approved Travel Request. Locked header fields are copied from the TR; the claimant edits
// actual amounts, receipts, incidentals and (optionally) charging. Reuses the ECS charging
// cascade + Accounting Entries. Submission records the claim (TR-17 variance preserved).
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@/shared/db';
import { loadRequest } from '@/modules/pretrip/queries';
import { getSettings } from '@/modules/pretrip/settings';
import { prepopulateClaim, fmtSgd } from '@/modules/te/prepopulate';
import { getContractSettings, prepopContract } from '@/modules/pretrip/integration';
import { updateClaimHeader, submitClaim, addClaimExpense, removeClaimExpense, updateClaimExpenseLine, saveClaimCharging, waiveEvidence, saveClaimBasis, removeClaimAttachment } from '@/modules/te/actions';
import { claimChargingContext, doaAutoGrant, type ClaimLike } from '@/modules/te/workflow';
import { EcsReference, EcsIdentity, EcsTravelClassRegister } from '@/shared/ecs/services';
import { getCtaAccount } from '@/modules/pretrip/ctaMaster';
import { airfareUpgrade } from '@/modules/pretrip/upgrade';
import { listUpgradeAccounts, effectiveDeltaCode } from '@/modules/pretrip/upgradeConfig';
import { exceptionViews } from '@/modules/pretrip/exceptions';
import { effectiveOdaBasis, effectiveAccomBasis, effectivePeriods, odaStayDays, accomStayNights, odaPersonalDays, accomPersonalNights, odaFundedDays, accomFundedNights, personalDaysTotal } from '@/modules/te/basis';
import { PersonalPeriodsEditor } from '@/components/PersonalPeriodsEditor';
import { currentPersonaId } from '@/shared/session';
import { chargingCodes, companyCodes, businessAreas } from '@/data/charging';
import { expenseTypes } from '@/data/expenseTypes';
import { currencies } from '@/data/fxRates';
import { employees } from '@/data/employees';
import { CLAIM_STATUS, APPROVER_ROLE, TE_TREATMENT, EXPENSE_CATEGORY } from '@/shared/enums';
import { ChargingAccountEditor, type AccountOpt, type CostLineX } from '@/components/ChargingAccountEditor';
import { AddExpenseModal } from '@/components/AddExpenseModal';
import { ClaimDecisionBar } from '@/components/ClaimDecisionBar';
import { LegacyClaimView } from '@/components/LegacyClaimView';
import { ExceptionClaimView } from '@/components/ExceptionClaimView';
import { ViewExpenseModal, type ExpenseView } from '@/components/ViewExpenseModal';
import { EditExpenseModal } from '@/components/EditExpenseModal';
import { CtaDetailModal } from '@/components/CtaDetailModal';
import { Card, CollapsibleCard, Empty } from '@/components/ui';

const ROLE_LABEL: Record<string, string> = { [APPROVER_ROLE.Verifier]: 'Verifier', [APPROVER_ROLE.Exception]: 'Exception Approver', [APPROVER_ROLE.RO]: 'RO', [APPROVER_ROLE.DOA]: 'DOA', [APPROVER_ROLE.ResearchDOA]: 'Research DOA' };

export const dynamic = 'force-dynamic';

const RECEIPT: Record<string, string> = { LOCAL_GST: 'Local (With GST)', FOREIGN_NO_GST: 'Foreign / No GST', NO_RECEIPT: 'No receipt' };
const d = (x: Date | null) => (x ? x.toISOString().slice(0, 10) : '');

export default async function ClaimPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const claim = await prisma.travelExpenseClaim.findUnique({ where: { id }, include: { lines: { include: { attachments: true } }, approvalSteps: { orderBy: { seq: 'asc' } }, attachments: { orderBy: { createdAt: 'desc' } } } });
  if (!claim) notFound();
  const persona = await currentPersonaId();
  // TMC transition — a LEGACY claim (pre-go-live PNR, no Pre-Trip TR) has no approved request, so it
  // renders a focused view; none of the TA-anchored machinery below applies.
  if (!claim.requestId) return claim.noTrException
    ? <ExceptionClaimView claim={claim} persona={persona} />
    : <LegacyClaimView claim={claim} persona={persona} />;
  const req = await loadRequest(claim.requestId);
  if (!req) notFound();
  const settings = await getSettings();
  const prep = prepopulateClaim(req, claim.claimantId, settings.airfareTreatment, prepopContract(await getContractSettings()));
  const canEdit = claim.status === CLAIM_STATUS.Draft || claim.status === CLAIM_STATUS.SentBack;
  const canSubmit = canEdit && (persona === claim.claimantId || EcsIdentity.hasRole(persona, 'TRAVEL_ADMIN'));
  const pendingStep = claim.approvalSteps.find((s) => s.status === 'Pending');
  const canAct = !!pendingStep && (pendingStep.approverId === persona || EcsIdentity.hasRole(persona, 'TRAVEL_ADMIN') || EcsIdentity.hasRole(persona, 'SYSTEM_ADMIN'));
  // §8 Who may waive an offline-approval evidence requirement: the current pending approver, or a Travel/
  // System Administrator. Available even pre-submission so a stuck evidence requirement can be cleared.
  const canWaive = EcsIdentity.hasRole(persona, 'TRAVEL_ADMIN') || EcsIdentity.hasRole(persona, 'SYSTEM_ADMIN') || (!!pendingStep && pendingStep.approverId === persona);

  const emp = EcsIdentity.employee(claim.claimantId);
  const ro = EcsIdentity.employee(emp?.reportingOfficerId ?? '');
  const booking = req.bookings.find((b) => b.travellerId === claim.claimantId) ?? req.bookings[0];
  // §7.3 Travel Booking Reference — the TA/authorisation number plus the PNR(s) the TMC booked under.
  // One TR can split across several PNRs (multi-city, group), so show the reference then its PNRs;
  // beyond two PNRs the rest collapse to "…and more". PNRs come from the traveller's booking(s) and
  // their segments (TMC feed); none yet when booked off-TRS → just the reference.
  const myBookings = req.bookings.filter((b) => b.travellerId === claim.claimantId);
  const refBookings = myBookings.length ? myBookings : req.bookings;
  const pnrSet = new Set<string>();
  for (const b of refBookings) { if (b.pnr) pnrSet.add(b.pnr); for (const s of b.segments ?? []) if (s.pnr) pnrSet.add(s.pnr); }
  const pnrs = [...pnrSet];
  const pnrParts = pnrs.length <= 2 ? pnrs : [pnrs[0], pnrs[1], '…and more'];
  const bookingRefParts = [req.authorisationNo ?? '—', ...pnrParts];
  // §13.19 Travel-class provenance on the claim header — three distinct datapoints from two sources:
  //  • Travel entitlement + Class planned come from the PRE-TRIP TR (the entitled cabin derived from the
  //    traveller's policy group, and the cabin approved on the request).
  //  • Highest class booked comes from the TMC FEED (BookingSegment.bookedClassId, reported inbound) —
  //    the highest-ranked cabin actually booked; '—' until a booking is received (e.g. booked off-TRS).
  const classOnDate = claim.travelStart ?? req.startDate ?? new Date();
  const entitledClassId = req.entitledClassId
    ?? EcsTravelClassRegister.entitledForItinerary(
         claim.claimantId,
         (req.legs ?? []).map((l) => ({ durationHours: l.durationHours, isPersonal: l.isPersonal, destCode: l.destCode ?? undefined })),
         classOnDate,
       ).classId;
  // The TMC feed reports the booked cabin as a display name ("Economy") on some rows and as a class id
  // ("TC-PEY") on others, so resolve by either before ranking/labelling.
  const resolveClass = (x: string | null | undefined) =>
    !x ? undefined : (EcsReference.travelClass(x) ?? EcsReference.travelClasses().find((c) => c.name.toLowerCase() === x.toLowerCase()));
  const rankOfClass = (x: string | null | undefined) => resolveClass(x)?.rank ?? 0;
  const entitledClassName = resolveClass(entitledClassId)?.name ?? '—';
  const plannedClassName = resolveClass(req.travelClassId)?.name ?? '—';
  const airBookedClasses = (booking?.segments ?? []).filter((s) => s.type === 'AIR' && s.bookedClassId).map((s) => s.bookedClassId as string);
  const highestBookedRaw = airBookedClasses.length
    ? airBookedClasses.reduce((best, cid) => (rankOfClass(cid) > rankOfClass(best) ? cid : best))
    : null;
  const bookedClassName = highestBookedRaw ? (resolveClass(highestBookedRaw)?.name ?? null) : null;
  // Was the booked cabin above the entitlement? (amber flag — an upgrade actually travelled)
  const bookedAboveEntitlement = !!highestBookedRaw && rankOfClass(highestBookedRaw) > rankOfClass(entitledClassId);
  const labelOf = (l: { category: string; expenseTypeId: string }) => EcsReference.expenseType(l.expenseTypeId)?.name ?? prep.lines.find((p) => p.category === l.category)?.label ?? l.category;
  // §4.5 / contract v1.4 — the declared personal-extension reflection on the claim header (tePersonalDays,
  // Reference). Driven by prepopulateClaim so a contract Exclude hides it; per-traveller for a group member.
  const personalField = prep.header.find((h) => h.label === 'Personal extension (declared)');
  // New-datapoint highlight — a green "NEW" chip + a soft green field tint, so the datapoints added
  // in this build stand out from the existing claim fields.
  const newTag = () => <span className="ml-2 inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-wide align-middle" style={{ background: '#e1f5ee', color: '#0f6e56', border: '1px solid #a7dcc6' }}>NEW</span>;
  const hiField = { borderColor: '#4bbf8f', background: '#f0faf5' } as const;
  const destLabel = `${EcsReference.country(req.destCountry ?? '')?.name ?? '—'}${req.destCity ? ` · ${EcsReference.city(req.destCity)?.name ?? req.destCity}` : ''}`;
  const personalDaysNum = personalField ? Number((personalField.value.match(/(\d+)\s+personal day/) || [])[1] || 0) : 0;

  // DD-19 / DD-30 — CTA-settled (Reference) lines are shown for the full cost picture but are NOT
  // reimbursed (the employee never fronted them). Auto-deduct them from the reimbursable total so
  // the displayed figure matches claimTotal() (which already excludes Reference lines). The paying
  // CTA account comes from the claimant's booking (feed-reported).
  const isRef = (l: { treatment: string }) => l.treatment === TE_TREATMENT.Reference;
  const totalExpenses = claim.lines.reduce((s, l) => s + l.actualSgd, 0);
  const totalApproved = claim.lines.reduce((s, l) => s + l.approvedSgd, 0);
  const ctaPaidTotal = claim.lines.filter(isRef).reduce((s, l) => s + l.actualSgd, 0);
  const reimbursableExpenses = claim.lines.filter((l) => !isRef(l)).reduce((s, l) => s + l.actualSgd, 0);
  const totalReimbursable = Math.max(reimbursableExpenses - claim.lessCorpCard - claim.lessPersonal, 0);
  const ctaAccount = await getCtaAccount(booking?.ctaAccountId);
  // DD-31 — CTA charges post to SAP on receipt, so they are NOT posted again at the claim. Surface
  // the posting on each reference line for traceability (de-scoped from the claim posting).
  const ctaPostings = booking ? await prisma.ctaPostingDocument.findMany({ where: { bookingId: booking.id } }) : [];
  const postingByType = new Map(ctaPostings.map((d) => [d.chargeType, d] as const));
  const postingFor = (cat: string) => postingByType.get(cat === 'AIRFARE' ? 'Airfare' : cat === 'ACCOMMODATION' ? 'Accommodation' : '');
  // The central (CTA) charge lines behind the "Less: charges paid by CTA" total (for the detail icon).
  const ctaLines = claim.lines.filter(isRef).map((l) => ({ label: labelOf(l), amount: l.actualSgd, posting: (() => { const p = postingFor(l.category); return p ? `${p.sapDocNo} (${p.status})` : ''; })() }));

  // §4.5 / contract tePersonalDays (Phase 2) — the funded day/night BASIS behind the ODA and
  // accommodation amounts, from the approved request's per-city estimates, scoped to this claimant
  // (group → their attributed + shared estimates). Read-only: the amounts are already net of personal
  // time (ODA funded = eligibleDays; accommodation funded = nights − personalNights); this makes the
  // funded-vs-stay split visible on the claim without re-deriving anything.
  const claimantEstimates = req.isGroup
    ? req.expenses.filter((e) => !e.travellerId || e.travellerId === claim.claimantId || e.isShared)
    : req.expenses;
  const odaBasis = claimantEstimates.map((e) => e.oda).filter((o): o is NonNullable<typeof o> => !!o);
  const accomBasis = claimantEstimates.map((e) => e.accommodation).filter((a): a is NonNullable<typeof a> => !!a);
  const hasFundedBasis = odaBasis.length > 0 || accomBasis.length > 0;
  // §4.5 claim-side editable basis: the claim's own rows if edited, else seeded from the TR. This drives
  // the editable funded-basis tables, the header personal-day count, and the ODA/accommodation expense
  // amounts — the TR values stay the approved reference (over-funded guard).
  // §7.3 (a) ACTUAL stay windows from the TMC feed — a claim reimburses what was actually booked, so the
  // ODA / accommodation stay DATES come from the booked AIR segments (arrival at a city until the next
  // departure brackets the real stay), not the TR plan. The TR rate and approved amount stay the
  // reference. Off-TRS claims have no feed → the TR dates are kept (feedSynced = false).
  const airSegs = req.bookings.flatMap((b) => b.segments ?? []).filter((s) => s.type === 'AIR' && s.departDate)
    .sort((a, b) => a.departDate!.getTime() - b.departDate!.getTime());
  const feedStops: { cityCode: string; from: string; to: string }[] = [];
  for (let i = 0; i < airSegs.length; i++) {
    const s = airSegs[i];
    const cityCode = EcsReference.airport(s.destCode ?? '')?.cityCode ?? s.destCode ?? '';
    if (!cityCode || cityCode === 'SIN') continue; // the fly-home leg is not a stop
    const from = s.arriveDate ?? s.departDate;
    const next = airSegs[i + 1];
    const to = next ? (next.departDate ?? next.arriveDate) : req.endDate;
    if (!from || !to) continue;
    feedStops.push({ cityCode, from: d(from), to: d(to) });
  }
  const feedSynced = feedStops.length > 0;
  const feedStopFor = (city: string | null) => feedStops.find((s) => s.cityCode === city);
  // Override the TR-seeded stay dates with the actual feed windows (matched by city); the rate stays TR.
  // The feed windows SEED the stay dates, but once the claimant has edited the basis (odaBasisJson /
  // accomBasisJson saved) their dates are authoritative — the feed no longer overrides them.
  const odaEdited = !!claim.odaBasisJson;
  const accomEdited = !!claim.accomBasisJson;
  const effOda = effectiveOdaBasis(claim.odaBasisJson, odaBasis).map((o) => { if (odaEdited) return o; const f = feedStopFor(o.city); return f ? { ...o, arrive: f.from, depart: f.to } : o; });
  const effAccom = effectiveAccomBasis(claim.accomBasisJson, accomBasis, req.startDate, req.endDate).map((a) => { if (accomEdited) return a; const f = feedStopFor(a.city); return f ? { ...a, checkIn: f.from, checkOut: f.to } : a; });
  const effPeriods = effectivePeriods(claim.claimPersonalPeriodsJson, req.personalPeriodsJson);
  const basisEdited = !!claim.odaBasisJson || !!claim.accomBasisJson || !!claim.claimPersonalPeriodsJson;
  // §4.5 editable stay rows for the per-line Edit modal + the city options; effPeriods is posted with the
  // form so the server recomputes the funded (personal-excluded) total when the stay is edited.
  const stayCityOpts = EcsReference.cities().filter((c) => c.code !== 'SIN').map((c) => ({ code: c.code, name: c.name, countryCode: c.countryCode, countryName: EcsReference.country(c.countryCode)?.name ?? c.countryCode }));
  const accomEditRows = effAccom.map((a) => ({ city: a.city, from: a.checkIn, to: a.checkOut, rate: a.nightlyRate, personal: accomPersonalNights(a, effPeriods) }));
  const odaEditRows = effOda.map((o) => ({ city: o.city ?? '', from: o.arrive, to: o.depart, rate: o.dailyRate, personal: odaPersonalDays(o, effPeriods) }));
  const basisPersonalDays = personalDaysTotal(effOda, effPeriods);
  const anyPersonalBasis = effPeriods.length > 0;
  // Stay windows per city — a personal extension is auto-matched to the stay its dates fall in (date
  // overlap), so the right city's ODA / accommodation rate is excluded without the claimant picking one.
  const basisStops = [
    ...effOda.map((o) => ({ city: EcsReference.city(o.city ?? '')?.name ?? EcsReference.country(o.country)?.name ?? o.city ?? o.country ?? '', from: o.arrive, to: o.depart })),
    ...effAccom.map((a) => ({ city: EcsReference.city(a.city)?.name ?? a.city, from: a.checkIn, to: a.checkOut })),
  ].filter((s) => s.from && s.to && s.city);
  // Phase 4 — soft guard: the approved ODA / accommodation line IS the funded (personal-excluded)
  // amount. A claimed actual ABOVE it means more days/nights than funded are being claimed (personal
  // days creeping in). Not a hard block (the amounts are advisory, reviewed at claim), just a flag.
  const overFundedLines = claim.lines.filter((l) =>
    (l.category === EXPENSE_CATEGORY.ODA || l.category === EXPENSE_CATEGORY.Accommodation) && !isRef(l) && l.actualSgd > l.approvedSgd + 0.005);

  // §13.19 Phase 3 — M6 (travel-class entitlement differential) on the REIMBURSABLE airfare path.
  // A CTA-billed airfare line keeps its booking-time M6 split (Reference, not reimbursed); only an
  // employee-settled / self-booked airfare line (Editable) re-derives the split at claim, so the
  // NTU-funded differential routes to the governing BA's M6 account and the entitlement stays on the
  // normal allocation. Reuses upgrade.ts + the same ChargingAccountEditor machinery as the TR.
  const govBA = (req.allocations.find((a) => a.isMain) ?? req.allocations[0])?.businessArea ?? null;
  const upgradeAccounts = await listUpgradeAccounts();
  const m6Accounts: AccountOpt[] = upgradeAccounts.map((a) => ({ code: a.code, name: a.name, type: 'CC', companyCode: a.companyCode, businessArea: a.businessArea, research: false, crossCharge: false, closed: !a.active }));
  let m6DeltaSgd = 0;
  let m6DeltaCode: string | null = null;
  for (const e of claimantEstimates.filter((e) => e.category === EXPENSE_CATEGORY.Airfare)) {
    const u = airfareUpgrade({ sgdAmount: e.sgdAmount, entitlementFareSgd: e.entitlementFareSgd, upgradeFunding: e.upgradeFunding, upgradeDeltaCode: e.upgradeDeltaCode });
    if (u.isUpgrade && u.funding === 'NTU' && u.deltaSgd > 0) {
      m6DeltaSgd += u.deltaSgd;
      m6DeltaCode = effectiveDeltaCode(upgradeAccounts, govBA, settings.upgradeDeltaSelectionRequired, e.upgradeDeltaCode) ?? m6DeltaCode;
    }
  }
  m6DeltaSgd = Math.round(m6DeltaSgd * 100) / 100;

  // §13.8 Policy-violation sync — a policy exception already APPROVED at the TR (travel class above
  // entitlement → Airfare; hotel over cap → Accommodation) flows onto the claim line Reference-only:
  // its justification, limit and overage are copied from the approved request and shown read-only with
  // a "Pre-approved · TR" marker, NOT re-routed to the verifier. A violation that only surfaces at
  // claim time has no approval to inherit, so its justification stays editable (polJust_<id>, persisted).
  const EX_CAT: Record<string, string> = { CLASS: EXPENSE_CATEGORY.Airfare, HOTEL_CAP: EXPENSE_CATEGORY.Accommodation };
  const exViews = exceptionViews(req);
  const exForLine = (l: { category: string }) =>
    exViews.find((x) => EX_CAT[x.code] === l.category && (x.travellerId == null || x.travellerId === claim.claimantId)) ?? null;
  const preApprovedTag = (
    <span className="ml-1.5 inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-wide align-middle whitespace-nowrap"
      style={{ background: '#eef2ff', color: '#3730a3', border: '1px solid #c7d2fe' }}
      title={`Approved at the Travel Request (${req.authorisationNo ?? req.requestNumber}) — carried over, not re-justified`}>✓ Pre-approved · TR</span>
  );

  // Per-line "View Expense" detail — the expense-detail screen for a claim line: header fields + the
  // per-city / per-stay funded breakdown (ODA / accommodation) and the entitlement-vs-M6 split (airfare).
  const expenseView = (l: (typeof claim.lines)[number]): ExpenseView => {
    const et = EcsReference.expenseType(l.expenseTypeId);
    const gstRatePct = et?.taxRatePct ?? 0;
    const gstAmount = gstRatePct > 0 ? Math.round((l.actualSgd * gstRatePct / (100 + gstRatePct)) * 100) / 100 : 0;
    const v: ExpenseView = {
      label: labelOf(l), date: d(l.transactionDate), isRef: isRef(l), manualEntry: l.manualEntry, receiptRequired: l.category !== EXPENSE_CATEGORY.ODA && !isRef(l), approvedSgd: l.approvedSgd, actualSgd: l.actualSgd,
      reason: l.reason ?? '', receiptType: l.receiptType, currency: l.currency, foreignAmount: l.foreignAmount, sponsorSgd: l.sponsorSgd,
      paymentCtc: isRef(l), gstCode: et?.gstCode ?? '—', gstRatePct, gstAmount, baseAmount: Math.round((l.actualSgd - gstAmount) * 100) / 100,
      exchangeRate: l.foreignAmount && l.foreignAmount > 0 ? Math.round((l.actualSgd / l.foreignAmount) * 100000) / 100000 : 1,
      receipt: (() => { const rec = l.attachments.find((a) => a.docType === 'RECEIPT'); return rec ? { fileName: rec.fileName, href: `/claims/${id}/attachments/${rec.id}`, contentType: rec.contentType } : null; })(),
    };
    const countryName = (code: string) => EcsReference.country(code)?.name ?? code;
    if (l.category === EXPENSE_CATEGORY.ODA && effOda.length) {
      v.oda = effOda.map((o) => ({ country: countryName(o.country), city: EcsReference.city(o.city ?? '')?.name ?? o.city ?? '—', arrive: o.arrive || '—', depart: o.depart || '—', stay: odaStayDays(o), personal: odaPersonalDays(o, effPeriods), funded: odaFundedDays(o, effPeriods), rate: o.dailyRate, amount: Math.round(odaFundedDays(o, effPeriods) * o.dailyRate * 100) / 100 }));
    } else if (l.category === EXPENSE_CATEGORY.Accommodation && effAccom.length) {
      v.accom = effAccom.map((a) => ({ country: countryName(EcsReference.city(a.city)?.countryCode ?? ''), city: EcsReference.city(a.city)?.name ?? a.city, checkIn: a.checkIn || '—', checkOut: a.checkOut || '—', nights: accomStayNights(a), personal: accomPersonalNights(a, effPeriods), funded: accomFundedNights(a, effPeriods), rate: a.nightlyRate, amount: Math.round(accomFundedNights(a, effPeriods) * a.nightlyRate * 100) / 100 }));
    } else if (l.category === EXPENSE_CATEGORY.Airfare && !isRef(l) && m6DeltaSgd > 0) {
      const net = Math.max(l.actualSgd - l.sponsorSgd, 0);
      const diff = Math.min(m6DeltaSgd, net);
      v.m6 = { fare: net, entitlement: Math.round((net - diff) * 100) / 100, differential: diff, account: m6DeltaCode ?? 'M6' };
    }
    return v;
  };

  // DD-08 / E11 — if the claimant moved the charging off the approved request's DOA, the claim
  // will route to the NEW account's DOA on submit (no auto-grant). Surface that before submit.
  const claimLike: ClaimLike = {
    claimantId: claim.claimantId, lessCorpCard: claim.lessCorpCard, lessPersonal: claim.lessPersonal,
    chargingMainCode: claim.chargingMainCode,
    lines: claim.lines.map((l) => ({ expenseTypeId: l.expenseTypeId, actualSgd: l.actualSgd, sponsorSgd: l.sponsorSgd, receiptType: l.receiptType, treatment: l.treatment })),
  };
  const chargeCtx = claimChargingContext(claimLike, req, { sameRouteResearch: settings.sameRouteResearch });
  const newDoaDeptName = EcsIdentity.department(chargeCtx.dept)?.name ?? chargeCtx.dept;
  const wouldAutoGrant = doaAutoGrant(claimLike, req, {
    exceptionApproverRequired: settings.exceptionApproverRequired, roRequirement: settings.roRequirement,
    sameRouteResearch: settings.sameRouteResearch, teAutoGrantTolerancePct: settings.teAutoGrantTolerancePct,
    teAutoGrantToleranceAbsSgd: settings.teAutoGrantToleranceAbsSgd,
  }).auto;

  // Charging — reconstruct the editor state from the claim snapshot.
  const cj: { rows: { code: string; percent: number; amount: number; io: string; isMain: boolean }[]; lineMap: Record<string, string> } =
    claim.chargingJson ? JSON.parse(claim.chargingJson) : { rows: [], lineMap: {} };
  const defaultAccount = emp?.defaultChargingCode ?? chargingCodes[0]?.code ?? '';
  const accounts: AccountOpt[] = chargingCodes.map((c) => ({ code: c.code, name: c.name, type: c.type, companyCode: c.companyCode, businessArea: c.businessArea, research: c.isResearch, crossCharge: !!c.crossCharge, closed: c.active === false }));
  const etOpts = expenseTypes.map((e) => ({ id: e.id, name: e.name, gl: e.glAccount, gst: e.gstCode }));
  // Full ECS datapoint options for the Add / Edit expense modals (GST code + rate drive the derived GST block).
  const etModalOpts = expenseTypes.map((e) => ({ id: e.id, name: e.name, gstCode: e.gstCode, taxRatePct: e.taxRatePct }));
  const claimInitialAllocs = (l: { allocJson: string | null; chargingCode: string | null }): { code: string; pct: number; io: string }[] | undefined => {
    if (l.allocJson) { try { const a = JSON.parse(l.allocJson); if (Array.isArray(a) && a.length) return a.map((x: { code: string; pct: number; io?: string }) => ({ code: x.code, pct: Number(x.pct), io: x.io || '' })); } catch { /* ignore */ } }
    return l.chargingCode ? [{ code: l.chargingCode, pct: 100, io: '' }] : undefined;
  };
  // A budgeted line the claimant did not spend against (actual 0) is NOT posted — exclude it from the
  // charging allocation and the Accounting Entries so the posting only covers actual claimed amounts
  // (and a zero line no longer demands a 100% allocation, which previously blocked save/submit).
  const costLines: CostLineX[] = claim.lines
    .filter((l) => Math.max(l.actualSgd - l.sponsorSgd, 0) > 0.005)
    .map((l) => {
      const net = Math.max(l.actualSgd - l.sponsorSgd, 0);
      // M6 split only on a REIMBURSABLE airfare line (CTA/Reference airfare was split at booking).
      const m6OnLine = l.category === EXPENSE_CATEGORY.Airfare && !isRef(l) && m6DeltaSgd > 0;
      return {
        id: l.id, typeId: l.expenseTypeId, typeName: labelOf(l), net,
        category: l.category ?? l.expenseTypeId, isShared: false, deptAllocs: [], initialAllocs: claimInitialAllocs(l),
        ...(m6OnLine ? { upgradeDeltaSgd: Math.min(m6DeltaSgd, net), upgradeDeltaCode: m6DeltaCode ?? undefined } : {}),
      };
    });
  const initialRows = cj.rows.map((r) => ({ ba: chargingCodes.find((c) => c.code === r.code)?.businessArea ?? '', code: r.code, io: r.io ?? '', pct: r.percent }));
  const initialLineMap: Record<string, string> = {};
  for (const l of claim.lines) if (l.chargingCode) initialLineMap[l.id] = l.chargingCode;
  const initialMode = (claim.chargingMode === 'ITEM' || claim.chargingMode === 'CLAIM' ? claim.chargingMode : 'MAIN') as 'MAIN' | 'CLAIM' | 'ITEM';

  return (
    <div className="w-full space-y-5">
      {/* Title bar */}
      <div className="flex flex-wrap items-center gap-3 border-b border-[var(--ecs-border)] pb-3">
        <h1 className="text-xl font-bold text-[var(--ecs-navy)]">Travel Expense Claim <span className="text-[var(--ecs-muted)] font-normal">· {claim.claimNumber}</span></h1>
        <span className={claim.status === CLAIM_STATUS.Approved ? 'pill-pass' : claim.status === CLAIM_STATUS.SentBack ? 'pill-exc' : claim.status.startsWith('Pending') ? 'pill-warn' : 'pill-info'}>{claim.status}</span>
        <div className="ml-auto flex items-center gap-3 text-sm">
          <Link href={`/requests/${req.id}`} className="btn-ghost">View Travel Request →</Link>
          {canSubmit && <form action={submitClaim.bind(null, id)}><button className="btn-primary">Submit</button></form>}
          {canAct && <ClaimDecisionBar claimId={id} roleLabel={ROLE_LABEL[pendingStep!.roleType] ?? pendingStep!.roleType} />}
        </div>
      </div>
      <p className="text-xs text-[var(--ecs-muted)] -mt-2">Pre-populated from {req.requestNumber} / {req.authorisationNo ?? '—'}. {prep.note}</p>

      {/* DD-08 / E11 — charging moved off the approved request's DOA: re-route notice (Draft only) */}
      {canEdit && chargeCtx.changed && (
        <div className="card p-3 text-sm bg-amber-50 border-amber-200 text-amber-900">
          <strong>Charging changed — DOA re-routes.</strong> The main charging account has moved off the approved request&apos;s DOA. On submit this claim will <strong>not</strong> be auto-granted; it routes to <strong>{newDoaDeptName}{chargeCtx.research ? ' (research)' : ''}</strong>&apos;s DOA to approve the changed account (§13.8 / DD-08).
        </div>
      )}
      {canEdit && !chargeCtx.changed && wouldAutoGrant && (
        <div className="card p-3 text-sm bg-emerald-50 border-emerald-200 text-emerald-900">
          On submit, DOA approval will be <strong>auto-granted</strong> from {req.authorisationNo} — the claim is within tolerance, with the same charging DOA and no new exception or expense type (§51).
        </div>
      )}

      {/* §51 Claim approval workflow */}
      {claim.approvalSteps.length > 0 && (
        <div className="card p-4">
          <div className="text-xs font-semibold text-[var(--ecs-muted)] mb-2">Approval Workflow</div>
          <div className="chev-row overflow-x-auto">
            <div className="flex items-center"><div className="chev chev-done"><div className="font-semibold">Submitted</div><div className="opacity-80">by {emp?.name}</div></div></div>
            {claim.approvalSteps.map((s) => {
              const label = ROLE_LABEL[s.roleType] ?? s.roleType;
              const state = s.status === 'Approved' ? 'chev-done' : s.status === 'SentBack' ? 'chev-stop' : s.id === pendingStep?.id ? 'chev-current' : 'chev-todo';
              const who = s.autoGranted ? 'auto-granted' : (EcsIdentity.employee(s.approverId ?? '')?.name ?? 'TBD');
              return (
                <div key={s.id} className="flex items-center"><span className="chev-conn" />
                  <div className={`chev ${state}`}><div className="font-semibold">{s.status === 'Approved' ? `${label} ${s.autoGranted ? 'Auto-granted' : 'Approved'}` : s.status === 'SentBack' ? `${label} Sent Back` : `Pending ${label}`}</div><div className="opacity-80">{who}</div></div>
                </div>
              );
            })}
          </div>
          {claim.approvalSteps.some((s) => s.autoGranted) && (
            <p className="text-xs text-[var(--ecs-muted)] mt-2">DOA approval was <strong>auto-granted from {req.authorisationNo}</strong> — the claim is within the approved estimate (tolerance {settings.teAutoGrantTolerancePct}% / SGD {settings.teAutoGrantToleranceAbsSgd}), with no new exception or expense type (§51).</p>
          )}
        </div>
      )}

      {/* Main form: header + expense items + totals */}
      <form action={updateClaimHeader.bind(null, id)} className="space-y-5">
        <Card title="Employee details">
          <div className="grid md:grid-cols-4 gap-4">
            <div><label className="label">Employee Name</label><input className="field" value={emp?.name ?? claim.claimantId} disabled /></div>
            <div><label className="label">Reporting Officer</label><input className="field" value={ro ? `${ro.name} (${ro.email})` : '—'} disabled /></div>
            <div><label className="label">Additional approver 1</label><input className="field" value={EcsIdentity.employee(claim.additionalApprover1 ?? '')?.name ?? '—'} disabled /></div>
            <div><label className="label">Additional approver 2</label>
              <select name="additionalApprover2" defaultValue={claim.additionalApprover2 ?? ''} disabled={!canEdit} className="field">
                <option value="">— none —</option>
                {employees.filter((e) => e.id !== claim.claimantId).map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
              </select>
            </div>
          </div>
        </Card>

        <Card title="Travel Booking Details">
          <label className="flex items-center gap-2 text-sm mb-4">
            <input type="checkbox" name="trsNotBooked" defaultChecked={claim.trsNotBooked} disabled={!canEdit} className="w-4 h-4" />
            Booking not made on NTU&apos;s Travel Reservation System (TRS)
          </label>
          <div className="grid md:grid-cols-3 gap-4">
            <div>
              <label className="label">Travel Booking Reference {pnrs.length > 1 && newTag()}</label>
              <div className="field" style={{ background: 'var(--ecs-readonly)', minHeight: '2.375rem', display: 'flex', alignItems: 'center', flexWrap: 'wrap', columnGap: '0.5rem', rowGap: '0.125rem' }}
                title={pnrs.length ? `Authorisation number  |  ${pnrs.length} PNR${pnrs.length === 1 ? '' : 's'} booked by the TMC` : 'Authorisation number — no PNR yet (booked off-TRS)'}>
                {bookingRefParts.map((p, i) => (
                  <span key={i} className="contents">
                    {i > 0 && <span className="text-[var(--ecs-border)]">|</span>}
                    <span className={p === '…and more' ? 'text-[var(--ecs-muted)] italic' : i === 0 ? '' : 'font-mono text-xs'}>{p}</span>
                  </span>
                ))}
              </div>
            </div>
            <div><label className="label">Main Country/Region Of Travel {req.destCity && newTag()}</label><input className="field" style={req.destCity ? hiField : undefined} value={destLabel} disabled title="Now includes the city (new)" /></div>
            <div>
              <label className="label">Travel Entitlement | Class Planned | Highest Class Booked {newTag()}</label>
              <div className="field" style={{ background: 'var(--ecs-readonly)', minHeight: '2.375rem', display: 'flex', alignItems: 'center', flexWrap: 'wrap', columnGap: '0.5rem', rowGap: '0.125rem', ...(bookedAboveEntitlement ? { borderColor: '#d9a300', background: '#fdf6e3' } : {}) }}
                title="Entitled cabin (pre-trip · policy group)  |  cabin approved on the TR (pre-trip)  |  highest cabin actually booked (TMC feed)">
                <span>{entitledClassName}</span><span className="text-[var(--ecs-border)]">|</span>
                <span>{plannedClassName}</span><span className="text-[var(--ecs-border)]">|</span>
                <span>{bookedClassName ?? '—'}</span>
              </div>
              <div className="text-[10px] mt-1" style={{ color: bookedAboveEntitlement ? '#9a7500' : 'var(--ecs-muted)' }}>
                Pre-trip · Pre-trip · TMC feed{bookedAboveEntitlement ? ' — booked above entitlement' : (!bookedClassName ? ' (awaiting booking feed)' : '')}
              </div>
            </div>
            <div><label className="label">Travel Purpose</label><input className="field" value={EcsReference.travelPurpose(req.purposeId ?? '')?.name ?? '—'} disabled /></div>
            <div><label className="label">Trip Description</label><input className="field" value={req.description ?? '—'} disabled /></div>
            <div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="label">Travel Start Date</label><input type="date" name="travelStart" defaultValue={d(claim.travelStart)} disabled={!canEdit} className="field" /></div>
                <div><label className="label">Travel End Date</label><input type="date" name="travelEnd" defaultValue={d(claim.travelEnd)} disabled={!canEdit} className="field" /></div>
              </div>
              {(() => { const pd = hasFundedBasis ? basisPersonalDays : personalDaysNum; return pd > 0 && <p className="text-xs mt-1.5" style={{ color: '#0f6e56' }}>Includes <b>{pd} personal day{pd === 1 ? '' : 's'}</b> — excluded from funded ODA / accommodation{basisEdited ? ' · edited at claim' : ''} {newTag()}</p>; })()}
            </div>
          </div>
        </Card>

        <Card title="Claim details">
          <div className="grid md:grid-cols-3 gap-4">
            <div><label className="label">Claim ID</label><input className="field" value={claim.claimNumber} disabled /></div>
            <div><label className="label">Report Date</label><input className="field" value={d(claim.createdAt) || '—'} disabled /></div>
            <div><label className="label">Report Type</label><input className="field" value={claim.reportType || 'Travel expense'} disabled /></div>
          </div>
        </Card>

        <Card title={`Expense items (${claim.lines.length})`} actions={canEdit ? <AddExpenseModal action={addClaimExpense.bind(null, id)} expenseTypes={etModalOpts} currencies={currencies} /> : undefined}>
          {claim.lines.length === 0 ? <Empty>No expense items — add one, or create the claim from an approved request.</Empty> : (
            <div className="overflow-x-auto">
              {/* Fixed layout: the 12 key columns (Actions → Justification) fill the card width so
                  Justification sits at the card edge; the 6 secondary columns overflow to the right,
                  reached by horizontal scroll — keeping only the key information at eye level. */}
              {/* Table is (card width + 860px) wide. Under fixed layout the 6 secondary columns take their
                  860px; the 12 key columns are `auto`, so they split the remaining — exactly the card width —
                  evenly, putting Justification at the card's right edge and the secondary columns off to the
                  right (scroll to see). Adapts to any card width. */}
              <table className="text-sm" style={{ tableLayout: 'fixed', width: 'calc(100% + 860px)' }}>
                <colgroup>
                  {/* 1 Actions · 2 Select · 3 Txn date · 4 Expense type · 5 Reason (wide) · 6 Expense amount ·
                      7 Approved est · 8 Policy violation (narrow Yes/No) · 9-12 limit/exceeded/%/justification */}
                  <col /><col style={{ width: 40 }} /><col /><col /><col style={{ width: 190 }} /><col /><col /><col style={{ width: 68 }} /><col /><col /><col /><col />
                  <col style={{ width: 130 }} /><col style={{ width: 160 }} /><col style={{ width: 160 }} /><col style={{ width: 150 }} /><col style={{ width: 110 }} /><col style={{ width: 150 }} />
                </colgroup>
                <thead><tr>
                  <th className="th">Actions</th>
                  <th className="th"><input type="checkbox" disabled className="w-4 h-4 align-middle" title="Select for allocation" /></th>
                  <th className="th">Transaction date</th><th className="th">Expense type</th>
                  <th className="th">Reason for expense</th>
                  <th className="th text-right">Expense amount (SGD)</th>
                  <th className="th text-right" style={{ background: '#f0faf5' }}>Approved est. {newTag()}</th>
                  <th className="th text-center">Policy violation</th><th className="th text-right">Policy limit per unit</th><th className="th text-right">Total amount exceeded limit</th><th className="th text-right">% Exceeded</th><th className="th">Justification for policy violation</th>
                  <th className="th">Verifier verify status</th><th className="th">Verifier rejection reason</th><th className="th">Verifier comment</th>
                  <th className="th">Attachment</th><th className="th">Is duplicated?</th><th className="th">Send back history</th>
                </tr></thead>
                <tbody>
                  {claim.lines.map((l) => {
                    const ev = expenseView(l);
                    return (
                    <tr key={l.id} className="hover:bg-[var(--ecs-panel-2)]">
                      <td className="td">
                        <div className="flex items-center gap-0.5">
                          <ViewExpenseModal e={ev} />
                          {canEdit && !isRef(l) && (() => {
                            const rec = l.attachments.find((a) => a.docType === 'RECEIPT');
                            return <EditExpenseModal action={updateClaimExpenseLine.bind(null, id, l.id)} removeReceipt={rec ? removeClaimAttachment.bind(null, id, rec.id) : undefined} expenseTypes={etModalOpts} currencies={currencies} cities={stayCityOpts} periods={effPeriods} oda={l.category === EXPENSE_CATEGORY.ODA ? odaEditRows : undefined} accom={l.category === EXPENSE_CATEGORY.Accommodation ? accomEditRows : undefined} line={{ expenseTypeId: l.expenseTypeId, label: labelOf(l), manualEntry: l.manualEntry, receiptRequired: l.category !== EXPENSE_CATEGORY.ODA && !isRef(l), transactionDate: d(l.transactionDate), currency: l.currency, foreignAmount: l.foreignAmount, actualSgd: l.actualSgd, sponsorSgd: l.sponsorSgd, receiptType: l.receiptType, reason: l.reason ?? '', receipt: rec ? { id: rec.id, fileName: rec.fileName, href: `/claims/${id}/attachments/${rec.id}` } : null }} />;
                          })()}
                          {canEdit && (l.manualEntry
                            ? <button formAction={removeClaimExpense.bind(null, id, l.id)} title="Remove line" className="inline-grid place-items-center w-7 h-7 rounded hover:bg-red-50 text-[var(--ecs-red)]"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg></button>
                            : <span title="Budget line from the approved TR — cannot be deleted; set actual to 0 if not claimed" className="inline-grid place-items-center w-7 h-7 text-[var(--ecs-muted)] opacity-50"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg></span>)}
                        </div>
                      </td>
                      <td className="td"><input type="checkbox" disabled className="w-4 h-4" /></td>
                      <td className="td whitespace-nowrap">{d(l.transactionDate) || '—'}</td>
                      <td className="td font-medium">{labelOf(l)}{isRef(l) && (() => { const p = postingFor(l.category); const tip = `Paid by CTA${booking?.ctaAccountId ? ` · ${booking.ctaAccountId}` : ''} · reference — not reimbursed${p ? ` · posted to SAP ${p.sapDocNo} (${p.status})` : ''}`; return <span className="ml-1.5 inline-grid place-items-center w-5 h-5 rounded-full bg-[var(--ecs-panel-2)] text-[var(--ecs-muted)] text-[9px] font-semibold align-middle cursor-help" title={tip}>CTA</span>; })()}</td>
                      <td className="td">{canEdit && !isRef(l) ? <input key={`reason_${l.id}`} name={`reason_${l.id}`} defaultValue={l.reason ?? ''} className="field" /> : (l.reason ?? '—')}</td>
                      <td className={`td text-right whitespace-nowrap ${isRef(l) ? 'text-[var(--ecs-muted)]' : ''}`}>{canEdit && !isRef(l) ? <input key={`actual_${l.id}`} name={`actual_${l.id}`} type="number" step="any" defaultValue={l.actualSgd} className="field text-right" /> : fmtSgd(l.actualSgd)}</td>
                      <td className="td text-right whitespace-nowrap text-[var(--ecs-muted)]" style={{ background: '#f0faf5' }}>{l.approvedSgd > 0 ? fmtSgd(l.approvedSgd) : '—'}</td>
                      {(() => {
                        const ex = exForLine(l);
                        const over = !ex && overFundedLines.includes(l);
                        const pct = (num: number, base: number) => (base > 0 ? `${((num / base) * 100).toFixed(1)}%` : '—');
                        if (ex) {
                          // Pre-approved at the TR — synced Reference-only (read-only), not re-routed to the verifier.
                          return <>
                            <td className="td text-center"><span className="font-semibold text-[#0f6e56]" title={`${ex.label} — pre-approved at the Travel Request`}>Yes</span></td>
                            <td className="td text-right">{ex.breakdown?.leftValue ?? '—'}</td>
                            <td className="td text-right whitespace-nowrap">{ex.impactSgd > 0 ? fmtSgd(ex.impactSgd) : '—'}</td>
                            <td className="td text-right whitespace-nowrap">{ex.impactSgd > 0 ? pct(ex.impactSgd, l.approvedSgd) : '—'}</td>
                            <td className="td align-top" style={{ background: '#eef2ff' }}><div className="leading-tight">{preApprovedTag}</div><div className="text-[13px] mt-1">{ex.justification ?? <span className="text-[var(--ecs-muted)] italic">Approved at TR — no justification recorded</span>}</div></td>
                          </>;
                        }
                        // Claim-time: a line whose actual exceeds the approved ceiling is flagged for review;
                        // the justification stays editable (persisted) for the claimant / verifier.
                        return <>
                          <td className="td text-center">{over ? <span className="text-amber-700 font-semibold" title="Actual exceeds the approved budget — review at claim">Yes</span> : <span className="text-[var(--ecs-muted)]">No</span>}</td>
                          <td className="td text-right text-[var(--ecs-muted)]">{over ? fmtSgd(l.approvedSgd) : '—'}</td>
                          <td className="td text-right whitespace-nowrap">{over ? fmtSgd(l.actualSgd - l.approvedSgd) : <span className="text-[var(--ecs-muted)]">—</span>}</td>
                          <td className="td text-right whitespace-nowrap">{over ? pct(l.actualSgd - l.approvedSgd, l.approvedSgd) : <span className="text-[var(--ecs-muted)]">—</span>}</td>
                          <td className="td">{isRef(l) ? <span className="text-[var(--ecs-muted)]">—</span> : canEdit ? <input name={`polJust_${l.id}`} defaultValue={l.policyJustification ?? ''} className="field" placeholder={over ? 'Justify the overage…' : '—'} /> : (l.policyJustification ?? '—')}</td>
                        </>;
                      })()}
                      <td className="td text-[var(--ecs-muted)]">—</td>
                      <td className="td text-[var(--ecs-muted)]">—</td>
                      <td className="td text-[var(--ecs-muted)]">—</td>
                      <td className="td">{isRef(l) ? <span className="text-[var(--ecs-muted)]">—</span> : canEdit ? (
                        <select name={`receipt_${l.id}`} defaultValue={l.receiptType} className="field">
                          {Object.entries(RECEIPT).map(([v, lab]) => <option key={v} value={v}>{lab}</option>)}
                        </select>
                      ) : RECEIPT[l.receiptType] ?? l.receiptType}</td>
                      <td className="td text-center text-[var(--ecs-muted)]">—</td>
                      <td className="td text-[var(--ecs-muted)] whitespace-nowrap">—</td>
                    </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={5} className="td text-right text-[var(--ecs-muted)]">Total expenses (all lines)</td>
                    <td className="td text-right font-medium whitespace-nowrap">{fmtSgd(totalExpenses)}</td>
                    <td className="td text-right font-medium whitespace-nowrap text-[var(--ecs-muted)]" style={{ background: '#f0faf5' }}>{fmtSgd(totalApproved)}</td>
                    <td colSpan={11}></td>
                  </tr>
                  <tr>
                    <td colSpan={5} className="td text-right text-[var(--ecs-muted)]"><span className="inline-flex items-center justify-end">Less: charges paid by CTA{ctaAccount ? ` (${ctaAccount.ctaAccountId})` : ''} — reference only<CtaDetailModal total={ctaPaidTotal} account={ctaAccount?.label ?? null} lines={ctaLines} /></span></td>
                    <td className="td text-right text-[var(--ecs-muted)] whitespace-nowrap">− {fmtSgd(ctaPaidTotal)}</td>
                    <td colSpan={12}></td>
                  </tr>
                  <tr>
                    <td colSpan={5} className="td text-right text-[var(--ecs-muted)]">Less NTU Corporate Card (other)</td>
                    <td className="td text-right">{canEdit ? <input name="lessCorpCard" type="number" step="any" defaultValue={claim.lessCorpCard} className="field text-right" /> : fmtSgd(claim.lessCorpCard)}</td>
                    <td colSpan={12}></td>
                  </tr>
                  <tr>
                    <td colSpan={5} className="td text-right text-[var(--ecs-muted)]">Less Personal / Sponsorship</td>
                    <td className="td text-right">{canEdit ? <input name="lessPersonal" type="number" step="any" defaultValue={claim.lessPersonal} className="field text-right" /> : fmtSgd(claim.lessPersonal)}</td>
                    <td colSpan={12}></td>
                  </tr>
                  <tr>
                    <td colSpan={5} className="td text-right font-bold text-[var(--ecs-navy)] border-t-2 border-[var(--ecs-border)]">Total Reimbursable Amount</td>
                    <td className="td text-right font-bold text-[var(--ecs-navy)] border-t-2 border-[var(--ecs-border)] whitespace-nowrap">{fmtSgd(totalReimbursable)}</td>
                    <td colSpan={12}></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
          {ctaPaidTotal > 0 && <p className="text-xs text-[var(--ecs-muted)] mt-2">CTA-settled airfare / hotel are deducted automatically (paid centrally, not reimbursed). &ldquo;Less NTU Corporate Card (other)&rdquo; is for any other corporate-card spend not already shown as a reference line.</p>}
          {canEdit && <div className="flex justify-end mt-4"><button type="submit" className="btn-secondary">Save draft</button></div>}
        </Card>
      </form>

      {req.deviations.length > 0 && (
        <Card title="Booking deviations vs approved (§6.4)">
          {(() => {
            const blocking = req.deviations.filter((x) => x.requiresEvidence && !x.evidenceAttachmentId && !x.waivedBy);
            return blocking.length > 0 ? (
              <div className="mb-3 rounded border border-amber-200 bg-amber-50 p-2 text-sm text-amber-900">
                <b>Submission blocked (§8):</b> {blocking.length} deviation(s) need offline-approval evidence or an approved waiver before this claim can be submitted. The traveller uploads evidence against the request (Booking page); the approver may waive with a reason below.
              </div>
            ) : null;
          })()}
          <ul className="space-y-2 text-sm">
            {req.deviations.map((x) => (
              <li key={x.id} className="flex flex-col gap-1 border-b border-[var(--ecs-border)] pb-2 last:border-0">
                <div className="flex items-start gap-2">
                  <span className={x.material ? 'pill-exc' : 'pill-info'}>{x.material ? 'Material' : 'Log only'}</span>
                  <div className="min-w-0"><strong>{x.field}</strong>: approved {x.approvedValue} → booked {x.bookedValue}. <span className="text-[var(--ecs-muted)]">{[x.level, x.scopeRef, x.pnr ? `PNR ${x.pnr}` : null].filter(Boolean).join(' · ')}</span></div>
                </div>
                {x.requiresEvidence && (
                  x.evidenceAttachmentId ? <div className="text-xs text-emerald-700 ml-10">✓ Offline-approval evidence attached.</div>
                  : x.waivedBy ? <div className="text-xs text-amber-800 ml-10">Evidence waived by {EcsIdentity.employee(x.waivedBy)?.name ?? x.waivedBy}{x.waiverReason ? ` — ${x.waiverReason}` : ''}.</div>
                  : canWaive ? (
                    <form action={waiveEvidence.bind(null, x.id, id)} className="ml-10 flex flex-wrap items-center gap-2">
                      <span className="pill-warn text-xs">Evidence required</span>
                      <input name="reason" placeholder="Waiver reason (required)" className="field w-72 py-1 text-xs" />
                      <button className="btn-secondary text-xs">Waive with reason</button>
                    </form>
                  ) : <div className="text-xs text-amber-800 ml-10">Evidence required (§8) — awaiting upload against the request before submission.</div>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* Charging — reused ECS cascade + Accounting Entries */}
      <ChargingAccountEditor
        action={saveClaimCharging.bind(null, id)}
        canEdit={canEdit}
        total={totalReimbursable}
        companyCodes={companyCodes.map((c) => ({ code: c.code, name: c.name }))}
        businessAreas={businessAreas.map((b) => ({ code: b.code, name: b.name, companyCode: b.companyCode }))}
        accounts={accounts}
        extraAccounts={m6Accounts}
        highlightUpgrade
        postedAtBookingTypes={[...new Set(claim.lines.filter(isRef).map((l) => l.expenseTypeId))]}
        expenseTypes={etOpts}
        lines={costLines}
        defaultAccount={defaultAccount}
        initialMode={initialMode}
        initialMain={claim.chargingMainCode ?? defaultAccount}
        initialRows={initialRows}
        initialLineMap={initialLineMap}
        submitLabel="Save charging"
      />

      {hasFundedBasis && (
        <CollapsibleCard
          title={<>Funded basis — personal days / nights excluded {newTag()}</>}
          stub={anyPersonalBasis ? 'Personal time excluded from the funded ODA / accommodation' : 'No personal days declared — funded = full stay'}
          className="border-l-4 border-l-emerald-400"
        >
          <p className="text-xs text-[var(--ecs-muted)] mb-3">The funded (personal-excluded) ODA and accommodation basis, synced from the approved TR (§4.5).{canEdit ? ' Edit the stay / personal / dates / rate if the actual trip differed — saving recomputes the ODA & accommodation claim amounts and the header personal-day count. The approved TR amounts remain the reference (over-funded check below).' : ''}{anyPersonalBasis ? '' : ' No personal days are declared on this trip, so funded = full stay.'}</p>
          {overFundedLines.length > 0 && (
            <div className="mb-3 rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">
              <b>Check personal-day claiming:</b> {overFundedLines.map((l) => labelOf(l)).join(', ')} claimed above the funded (personal-excluded) approved amount. The funded day / night counts exclude personal time; the claimed ODA / accommodation should not exceed them.
            </div>
          )}
          <form action={saveClaimBasis.bind(null, id)}>
            <input type="hidden" name="odaCount" value={effOda.length} />
            <input type="hidden" name="accomCount" value={effAccom.length} />
            <div className="mb-4 rounded border border-[var(--ecs-border)] bg-[var(--ecs-panel-2)] p-3">
              <PersonalPeriodsEditor initial={effPeriods} stops={basisStops} canEdit={canEdit} />
              <p className="text-[10px] text-[var(--ecs-muted)] mt-2">Personal <b>days</b> (ODA) and <b>nights</b> (accommodation) are counted from these dates and matched to the city whose stay they fall in — they differ by a night because a stay&apos;s last day has no onward night. Saving recomputes the funded amounts, <b>updates the ODA / accommodation claim lines</b>, and the header personal-day count.</p>
            </div>
            <p className="text-[11px] text-[var(--ecs-muted)] mb-2">{feedSynced ? <>The stay dates are the <b>actual booked dates</b> (from the TMC feed / PNRs); the rate is the TR-approved rate.</> : <>The stay dates are from the approved TR (no TMC booking received).</>} This is the funded (personal-excluded) <b>reference</b> — not an input; actual amounts are claimed in the Expense items above.</p>
            {effOda.length > 0 && (
              <div className="overflow-x-auto mb-4">
                <table className="w-full text-sm" style={{ tableLayout: 'fixed' }}>
                  <colgroup><col style={{ width: '22%' }} /><col style={{ width: '15%' }} /><col style={{ width: '15%' }} /><col style={{ width: '12%' }} /><col style={{ width: '12%' }} /><col style={{ width: '12%' }} /><col style={{ width: '12%' }} /></colgroup>
                  <thead><tr>
                    <th className="th">Overseas Daily Allowance — city</th><th className="th">Arrive</th><th className="th">Depart</th>
                    <th className="th text-right">Stay days</th><th className="th text-right">Personal</th><th className="th text-right">Funded days</th><th className="th text-right">Rate/day</th>
                  </tr></thead>
                  <tbody>
                    {effOda.map((o, i) => { const pd = odaPersonalDays(o, effPeriods); return (
                      <tr key={i}>
                        <td className="td">{EcsReference.city(o.city ?? '')?.name ?? EcsReference.country(o.country)?.name ?? o.city ?? o.country}
                          <input type="hidden" name={`oda_${i}_city`} value={o.city ?? ''} /><input type="hidden" name={`oda_${i}_country`} value={o.country} />
                          <input type="hidden" name={`oda_${i}_arrive`} value={o.arrive} /><input type="hidden" name={`oda_${i}_depart`} value={o.depart} /><input type="hidden" name={`oda_${i}_dailyRate`} value={o.dailyRate} />
                        </td>
                        <td className="td whitespace-nowrap">{o.arrive || '—'}</td>
                        <td className="td whitespace-nowrap">{o.depart || '—'}</td>
                        <td className="td text-right">{odaStayDays(o)}</td>
                        <td className={`td text-right ${pd > 0 ? 'font-medium text-amber-700' : 'text-[var(--ecs-muted)]'}`} title="Derived from the personal extension dates">{pd}</td>
                        <td className="td text-right font-medium">{odaFundedDays(o, effPeriods)}</td>
                        <td className="td text-right text-[var(--ecs-muted)]">{fmtSgd(o.dailyRate)}</td>
                      </tr>
                    ); })}
                  </tbody>
                </table>
              </div>
            )}
            {effAccom.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-sm" style={{ tableLayout: 'fixed' }}>
                  <colgroup><col style={{ width: '22%' }} /><col style={{ width: '15%' }} /><col style={{ width: '15%' }} /><col style={{ width: '12%' }} /><col style={{ width: '12%' }} /><col style={{ width: '12%' }} /><col style={{ width: '12%' }} /></colgroup>
                  <thead><tr>
                    <th className="th">Accommodation — city</th><th className="th">Check-in</th><th className="th">Check-out</th>
                    <th className="th text-right">Stay nights</th><th className="th text-right">Personal</th><th className="th text-right">Funded nights</th><th className="th text-right">Avg/night</th>
                  </tr></thead>
                  <tbody>
                    {effAccom.map((a, i) => { const pn = accomPersonalNights(a, effPeriods); return (
                      <tr key={i}>
                        <td className="td">{EcsReference.city(a.city)?.name ?? a.city}
                          <input type="hidden" name={`accom_${i}_city`} value={a.city} />
                          <input type="hidden" name={`accom_${i}_checkIn`} value={a.checkIn} /><input type="hidden" name={`accom_${i}_checkOut`} value={a.checkOut} /><input type="hidden" name={`accom_${i}_nightlyRate`} value={a.nightlyRate} />
                        </td>
                        <td className="td whitespace-nowrap">{a.checkIn || '—'}</td>
                        <td className="td whitespace-nowrap">{a.checkOut || '—'}</td>
                        <td className="td text-right">{accomStayNights(a)}</td>
                        <td className={`td text-right ${pn > 0 ? 'font-medium text-amber-700' : 'text-[var(--ecs-muted)]'}`} title="Derived from the personal extension dates (nights, not days)">{pn}</td>
                        <td className="td text-right font-medium">{accomFundedNights(a, effPeriods)}</td>
                        <td className="td text-right text-[var(--ecs-muted)]">{fmtSgd(a.nightlyRate)}</td>
                      </tr>
                    ); })}
                  </tbody>
                </table>
              </div>
            )}
            {canEdit && <div className="flex justify-end mt-3"><button className="btn-secondary">Save &amp; recompute claim amounts</button></div>}
          </form>
        </CollapsibleCard>
      )}

      <Card title="Comments">
        <p className="text-sm text-[var(--ecs-muted)]">Submission and review history — no comments on this claim yet.</p>
      </Card>

      <Card title="Attachment">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr><th className="th">Document type</th><th className="th">File name</th><th className="th">File size</th><th className="th">Uploaded by</th><th className="th">Uploaded date</th></tr></thead>
            <tbody><tr><td className="td text-[var(--ecs-muted)]" colSpan={5}>No supporting documents attached.</td></tr></tbody>
          </table>
        </div>
        <p className="text-xs text-[var(--ecs-muted)] mt-2">Maximum of 7 files allowed, total size limit: 7 MB. Supported formats: PNG, JPEG, PDF.</p>
      </Card>

      <p className="text-xs text-[var(--ecs-muted)]">Approved estimates remain traceable; edits are recorded as actual values/variances rather than overwriting the approved request (§8.3). One approved request may link to multiple claims; cumulative claimed amounts compare against the approved estimate (AC17).</p>
    </div>
  );
}
