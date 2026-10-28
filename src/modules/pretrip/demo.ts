'use server';
// Seeds the §8.1 / §12.1 demonstration scenarios end-to-end using the real business
// logic (pricing, policy, route, TMC adapter, TE pre-population), so every scenario
// runs without manual setup (§13.7). Triggered from the dashboard.
import { revalidatePath } from 'next/cache';
import { prisma } from '@/shared/db';
import { loadRequest, type FullRequest } from './queries';
import { getSettings } from './settings';
import { nextRequestNumber, nextAuthorisationNumber, nextClaimNumber } from './numbering';
import { computeAccommodation, computeOda, computeOdaTiered, computeSummary } from './pricing';
import { evaluatePolicies, hasException, hasHardStop } from './policy';
import { ensureUpgradeConfigSeed, listUpliftRates, upliftPctFrom, deriveEntitlementSgd, listUpgradeAccounts, defaultAccountForBA, upgradeCheckCtx } from './upgradeConfig';
import { buildRoute, statusForStep } from './route';
import { sharedLegs } from './group';
import { HOTEL_SETTLEMENT } from './settlement';
import { postCtaChargesForRequest, reverseCtaChargesForRequest } from './ctaPosting';
import { applyMaterialAmendment } from './amend';
import { EcsFx, EcsIdentity, EcsCharging, EcsReference, EcsPolicy, EcsTravelClassRegister } from '@/shared/ecs/services';
import { prepopulateClaim } from '@/modules/te/prepopulate';
import { buildOutbound, simulateInbound } from '@/integrations/tmc/adapter';
import { EMERGENCY_APPROVAL_DOC } from './emergency';
import { REQUEST_STATUS, BOOKING_STATUS, EXPENSE_CATEGORY, POLICY_OUTCOME, BOOKING_METHOD, APPROVER_ROLE } from '@/shared/enums';

const YEAR = 2026;
const day = (iso: string) => new Date(iso + 'T00:00:00Z');

/** #14 Model B upgrade line fields — derive the entitlement from the chosen fare + the configured
 *  uplift % for the class step, and (for an NTU-funded delta) route to the governing BA's default M6
 *  account. Keeps the demo consistent with the live capture (addAirfare). */
async function upgradeLineFields(fareSgd: number, fromClassId: string, toClassId: string, funding: 'NTU' | 'SELF', ba: string) {
  await ensureUpgradeConfigSeed();
  const pct = upliftPctFrom(await listUpliftRates(), fromClassId, toClassId);
  const entitlementFareSgd = deriveEntitlementSgd(fareSgd, pct);
  const upgradeDeltaCode = funding === 'NTU' ? (defaultAccountForBA(await listUpgradeAccounts(), ba)?.code ?? null) : null;
  return { entitlementFareSgd, upgradeFunding: funding, upgradeDeltaCode };
}

interface Charge { code: string; pct: number }
interface ScenarioInput {
  requestorId: string; travellerId: string; purposeId: string; isResearch: boolean;
  destCountry: string; destCity: string; destAirport: string; start: string; end: string;
  personalStart?: string; personalEnd?: string; travelClassId: string; bookingMethod: string;
  airfare: { amount: number; currency: string; classId: string; sponsorship?: number };
  hotel?: { city: string; nights: number; personalNights?: number; quotedNightly: number; note?: string };
  oda?: { country: string; city: string; arrive: string; depart: string; personalDays?: number };
  conference?: { amount: number };
  charging: Charge[];
}

async function audit(requestId: string, actorId: string, kind: string, summary: string) {
  await prisma.auditEvent.create({ data: { requestId, actorId, kind, summary } });
}

async function buildDraft(s: ScenarioInput): Promise<string> {
  const settings = await getSettings();
  const requestNumber = await nextRequestNumber(YEAR);
  const traveller = EcsIdentity.employee(s.travellerId);
  const req = await prisma.travelRequest.create({
    data: {
      requestNumber, requestorId: s.requestorId, travellerId: s.travellerId,
      entityId: EcsIdentity.entity().id, departmentId: traveller?.departmentId, isResearch: s.isResearch,
      status: REQUEST_STATUS.Draft, bookingStatus: BOOKING_STATUS.NotSent,
      purposeId: s.purposeId, description: `${EcsIdentity.employee(s.travellerId)?.name} — demonstration trip`,
      destCountry: s.destCountry, destCity: s.destCity,
      startDate: day(s.start), endDate: day(s.end),
      personalStart: s.personalStart ? day(s.personalStart) : null, personalEnd: s.personalEnd ? day(s.personalEnd) : null,
      travelClassId: s.travelClassId, bookingMethod: s.bookingMethod,
    },
  });
  const id = req.id;
  await audit(id, s.requestorId, 'CREATE', `Draft ${requestNumber} created`);

  // Itinerary
  await prisma.itineraryLeg.create({ data: { requestId: id, seq: 1, originCode: 'SIN', destCode: s.destAirport, departDate: day(s.start), travelClassId: s.travelClassId } });
  await prisma.itineraryLeg.create({ data: { requestId: id, seq: 2, originCode: s.destAirport, destCode: 'SIN', departDate: day(s.end), travelClassId: s.travelClassId } });

  // Airfare
  const airSgd = EcsFx.toSgd(s.airfare.amount, s.airfare.currency);
  await prisma.estimatedExpense.create({
    data: {
      requestId: id, category: EXPENSE_CATEGORY.Airfare, expenseTypeId: 'ET-AIR', currency: s.airfare.currency,
      foreignAmount: s.airfare.amount, sgdAmount: airSgd, sponsorForeign: s.airfare.sponsorship ?? 0,
      sponsorSgd: EcsFx.toSgd(s.airfare.sponsorship ?? 0, s.airfare.currency), estimateBasis: 'QUOTED',
      originCode: 'SIN', destCode: s.destAirport, proposedClassId: s.airfare.classId, fareCeiling: airSgd, handoffStatus: 'Pending',
    },
  });
  // Accommodation
  if (s.hotel) {
    const calc = computeAccommodation({ cityCode: s.hotel.city, nights: s.hotel.nights, personalNights: s.hotel.personalNights ?? 0, quotedNightly: s.hotel.quotedNightly, basis: settings.hotelEstimateBasis });
    const exp = await prisma.estimatedExpense.create({ data: { requestId: id, category: EXPENSE_CATEGORY.Accommodation, expenseTypeId: 'ET-ACC', currency: 'SGD', foreignAmount: calc.sgdAmount, sgdAmount: calc.sgdAmount, estimateBasis: settings.hotelEstimateBasis, notes: s.hotel.note ?? null } });
    await prisma.accommodationEstimate.create({ data: { expenseId: exp.id, city: s.hotel.city, nights: s.hotel.nights, personalNights: s.hotel.personalNights ?? 0, quotedNightly: s.hotel.quotedNightly, capNightly: calc.capNightly, budgetedNightly: calc.budgetedNightly, capVariance: calc.capVariance, exceptionOutcome: calc.outcome } });
  }
  // ODA
  if (s.oda) {
    const calc = computeOda({ countryCode: s.oda.country, arrive: day(s.oda.arrive), depart: day(s.oda.depart), personalDays: s.oda.personalDays ?? 0 });
    const exp = await prisma.estimatedExpense.create({ data: { requestId: id, category: EXPENSE_CATEGORY.ODA, expenseTypeId: 'ET-ODA', currency: 'SGD', foreignAmount: calc.sgdAmount, sgdAmount: calc.sgdAmount, estimateBasis: 'RATE' } });
    await prisma.oDAEstimate.create({ data: { expenseId: exp.id, country: s.oda.country, city: s.oda.city, arrive: day(s.oda.arrive), depart: day(s.oda.depart), eligibleDays: calc.eligibleDays, personalDays: s.oda.personalDays ?? 0, dailyRate: calc.dailyRate } });
  }
  // Conference fee
  if (s.conference) {
    await prisma.estimatedExpense.create({ data: { requestId: id, category: EXPENSE_CATEGORY.Conference, expenseTypeId: 'ET-CONF', currency: 'SGD', foreignAmount: s.conference.amount, sgdAmount: s.conference.amount, estimateBasis: 'QUOTED' } });
  }
  // Charging (§17 ECS format: the first account is the main charging account)
  await prisma.travelRequest.update({ where: { id }, data: { chargingMode: s.charging.length > 1 ? 'CLAIM' : 'MAIN' } });
  for (const [ci, c] of s.charging.entries()) {
    const master = EcsCharging.code(c.code);
    await prisma.chargingAllocation.create({ data: { requestId: id, chargingCode: c.code, percent: c.pct, chargingType: master?.type ?? 'CC', companyCode: master?.companyCode, businessArea: master?.businessArea, isResearch: master?.isResearch ?? false, isMain: ci === 0 } });
  }
  return id;
}

/** The scenario seed creates accommodation lines by city + nights without a check-in / check-out,
 *  so the review & approval "Stay dates" line would show "— → —". This backfills those dates from
 *  the request's itinerary legs (From = arrival at the city, To = the next leg's departure onward,
 *  last stop = trip end), the same basis the live auto-estimates use. Lines that already carry a
 *  check-in (manually entered or auto-derived) are left untouched. */
async function backfillHotelDates(id: string) {
  const req = await prisma.travelRequest.findUnique({ where: { id }, include: { legs: { orderBy: { seq: 'asc' } }, expenses: { include: { accommodation: true } } } });
  if (!req) return;
  const legs = req.legs.filter((l) => !l.travellerId).sort((a, b) => a.seq - b.seq);
  const span: Record<string, { from: Date; to: Date }> = {};
  for (let i = 0; i < legs.length; i++) {
    const l = legs[i];
    const city = EcsReference.airport(l.destCode)?.cityCode ?? l.destCode;
    if (!city || city === 'SIN') continue;
    const from = l.arriveDate ?? l.departDate;
    const to = legs[i + 1]?.departDate ?? legs[i + 1]?.arriveDate ?? req.endDate;
    if (from && to && !span[city]) span[city] = { from, to };
  }
  for (const e of req.expenses) {
    const a = e.accommodation;
    if (!a || a.checkIn) continue;
    const s = span[a.city];
    const from = s?.from ?? req.startDate;
    if (!from) continue;
    const to = s?.to ?? new Date(from.getTime() + a.nights * 86400000);
    await prisma.accommodationEstimate.update({ where: { id: a.id }, data: { checkIn: from, checkOut: to } });
  }
}

/** Rebuild the ODA lines to the latest design: ONE line per city (stop), per employee traveller
 *  (guests get none), at that country's FULL daily rate × nights (no travel-day proportioning),
 *  keyed to the leg. Mirrors the live auto-estimates engine so seeded requests match what a real
 *  create flow produces. Replaces whatever ODA lines the scenario seed created. */
async function rebuildOda(id: string) {
  const req = await prisma.travelRequest.findUnique({ where: { id }, include: { legs: { orderBy: { seq: 'asc' } }, travellers: true, expenses: { include: { oda: true } } } });
  if (!req) return;
  const DAY = 86400000;
  const legs = req.legs.filter((l) => !l.travellerId).sort((a, b) => a.seq - b.seq);
  type St = { legSeq: number; city: string; country: string; from: Date; to: Date; nights: number };
  const stops: St[] = [];
  for (let i = 0; i < legs.length; i++) {
    const l = legs[i];
    const city = EcsReference.airport(l.destCode)?.cityCode ?? l.destCode;
    if (!city || city === 'SIN') continue;
    const from = l.arriveDate ?? l.departDate;
    const to = legs[i + 1]?.departDate ?? legs[i + 1]?.arriveDate ?? req.endDate;
    if (!from || !to) continue;
    const nights = Math.max(Math.round((to.getTime() - from.getTime()) / DAY), 0);
    if (nights <= 0) continue;
    stops.push({ legSeq: l.seq, city, country: EcsReference.city(city)?.countryCode ?? '', from, to, nights });
  }
  const guestIds = new Set(req.travellers.filter((t) => t.travellerType === 'GUEST' || t.employeeId.startsWith('G-')).map((t) => t.employeeId));
  const odaTids: (string | null)[] = req.isGroup ? req.travellers.filter((t) => !guestIds.has(t.employeeId)).map((t) => t.employeeId) : (req.travellerType === 'GUEST' ? [] : [null]);
  for (const e of req.expenses.filter((x) => x.oda)) await prisma.estimatedExpense.delete({ where: { id: e.id } });
  for (const tid of odaTids) for (const s of stops) {
    const rate = EcsPolicy.odaRate(s.country) ?? 0;
    if (rate <= 0) continue;
    const calc = computeOdaTiered({ days: s.nights, dailyRate: rate, monthlyRate: EcsPolicy.odaMonthlyRate(s.country) ?? 0 });
    const amount = calc.sgdAmount;
    const ratePct = s.nights > 0 ? Math.round((amount / (s.nights * rate)) * 100) : 100;
    const exp = await prisma.estimatedExpense.create({ data: { requestId: id, category: EXPENSE_CATEGORY.ODA, expenseTypeId: 'ET-ODA', currency: 'SGD', foreignAmount: amount, sgdAmount: amount, estimateBasis: 'RATE', expectedDate: s.from, autoDerived: true, travellerId: tid } });
    await prisma.oDAEstimate.create({ data: { expenseId: exp.id, country: s.country, city: s.city, legSeq: s.legSeq, arrive: s.from, depart: s.to, eligibleDays: s.nights, personalDays: 0, dailyRate: rate, ratePct } });
  }
}

async function submit(id: string): Promise<FullRequest> {
  const settings = await getSettings();
  let req = await loadRequest(id);
  if (!req) throw new Error('missing');
  // Seed fixtures are historical: several scenarios are completed trips dated in the past (so they
  // can be Approved/Booked/Claimed for the demo). The DATE_PAST rule (a NEW request can't be raised
  // for a trip that already started) does not apply to these fixtures, so it is exempt here — the
  // live submit (submitRequest / policy.ts) still enforces it in full.
  const checks = evaluatePolicies(req, settings.approvalAmountBasis, await upgradeCheckCtx(settings)).filter((c) => c.code !== 'DATE_PAST');
  // Mirror the live submit guard: a scenario must not submit with an unresolved hard stop (e.g. an
  // above-cap hotel or class upgrade with no justification) — fail loudly so bad seed data is caught.
  if (hasHardStop(checks)) {
    const blockers = checks.filter((c) => c.outcome === POLICY_OUTCOME.HardStop).map((c) => `${c.code} — ${c.detail}`);
    throw new Error(`Seed scenario ${req.requestNumber} cannot submit — unresolved hard stop(s): ${blockers.join('; ')}`);
  }
  await prisma.policyCheck.deleteMany({ where: { requestId: id } });
  for (const c of checks) await prisma.policyCheck.create({ data: { requestId: id, code: c.code, label: c.label, outcome: c.outcome, detail: c.detail, travellerId: c.travellerId ?? null } });
  const summary = computeSummary(req.expenses, settings.approvalAmountBasis);
  await prisma.travelRequest.update({ where: { id }, data: { approvalAmountSgd: summary.approvalAmount } });
  req = await loadRequest(id);
  const steps = buildRoute(req!, { exceptionApproverRequired: settings.exceptionApproverRequired, sameRouteResearch: settings.sameRouteResearch, approvalAmount: summary.approvalAmount, hasException: hasException(checks), crossBaThresholdSgd: settings.crossBaThresholdSgd, roRequirement: settings.roRequirement, researchPiSelfApproval: settings.researchPiSelfApproval, selfApprovalLimitSgd: settings.selfApprovalLimitSgd });
  await prisma.approvalStep.deleteMany({ where: { requestId: id } });
  for (const st of steps) await prisma.approvalStep.create({ data: { requestId: id, seq: st.seq, roleType: st.roleType, approverId: st.approverId, comments: st.note } });
  await prisma.travelRequestVersion.create({ data: { requestId: id, version: req!.currentVersion + 1, reason: 'SUBMISSION', approved: false, snapshot: JSON.stringify({ requestNumber: req!.requestNumber }) } });
  await prisma.travelRequest.update({ where: { id }, data: { currentVersion: req!.currentVersion + 1, status: steps.length ? statusForStep(steps[0].roleType) : REQUEST_STATUS.PendingDOA } });
  await audit(id, req!.requestorId, 'SUBMIT', `Submitted — routed to ${steps.map((s) => s.roleType).join(' → ')}`);
  return (await loadRequest(id))!;
}

async function approveAll(id: string) {
  let req = await loadRequest(id);
  while (req && req.status.startsWith('Pending')) {
    const step = req.approvalSteps.find((s) => s.status === 'Pending');
    if (!step) break;
    await prisma.approvalStep.update({ where: { id: step.id }, data: { status: 'Approved', decidedAt: new Date() } });
    await audit(id, step.approverId ?? 'E-SYS', 'APPROVE', `${step.roleType} approved`);
    const next = req.approvalSteps.find((s) => s.seq > step.seq && s.status === 'Pending');
    if (next) {
      await prisma.travelRequest.update({ where: { id }, data: { status: statusForStep(next.roleType) } });
    } else {
      // No traveller-confirmation gate — group requests finalise straight to Approved.
      await finaliseApproval(id);
    }
    req = await loadRequest(id);
  }
}

/** Approve the earlier steps only, leaving the request Pending at the given approver role — so
 *  the demo populates each approver persona's queue (RO, Exception, DOA) with something to act on. */
async function advanceTo(id: string, stopRole: string) {
  let req = await loadRequest(id);
  while (req && req.status.startsWith('Pending')) {
    const step = req.approvalSteps.find((s) => s.status === 'Pending');
    if (!step || step.roleType === stopRole) break;
    await prisma.approvalStep.update({ where: { id: step.id }, data: { status: 'Approved', decidedAt: new Date() } });
    await audit(id, step.approverId ?? 'E-SYS', 'APPROVE', `${step.roleType} approved`);
    const next = req.approvalSteps.find((s) => s.seq > step.seq && s.status === 'Pending');
    if (next) await prisma.travelRequest.update({ where: { id }, data: { status: statusForStep(next.roleType) } });
    req = await loadRequest(id);
  }
}

async function finaliseApproval(id: string) {
  const req = await loadRequest(id);
  if (!req) return;
  const settings = await getSettings();
  const authNo = await nextAuthorisationNumber(YEAR);
  const bookingDeadline = req.startDate ? new Date(req.startDate.getTime() - settings.bookingDeadlineDays * 86400000) : null;
  const expiry = req.endDate ? new Date(req.endDate.getTime() + settings.authorisationValidityDays * 86400000) : null;
  await prisma.travelRequest.update({ where: { id }, data: { status: REQUEST_STATUS.Approved, authorisationNo: authNo, bookingDeadline, authorisationExpiry: expiry } });
  await prisma.travelRequestVersion.create({ data: { requestId: id, version: req.currentVersion + 1, reason: 'APPROVAL', approved: true, snapshot: JSON.stringify({ approved: true }) } });
  await prisma.travelRequest.update({ where: { id }, data: { currentVersion: req.currentVersion + 1 } });
  await audit(id, 'E-SYS', 'STATUS', `Final approval — Travel Authorisation ${authNo} issued`);
}

async function bookViaTmc(id: string, overFarePct = 0, ctaAccountId = 'CTA-SG-SGD', charged = true) {
  const req = await loadRequest(id);
  if (!req) return;
  // DD-30 a settled CTA charge posts a few days before travel (ticketing); a pending booking is
  // confirmed but not yet charged (chargeDate null).
  const chargeDate = charged && req.startDate ? new Date(req.startDate.getTime() - 7 * 86400000) : null;
  const acc = req.expenses.filter((e) => e.category === EXPENSE_CATEGORY.Accommodation && e.accommodation).map((e) => ({ city: e.accommodation!.city, nights: e.accommodation!.nights, cappedNightlySgd: e.accommodation!.budgetedNightly }));
  const ceiling = req.expenses.filter((e) => e.category === EXPENSE_CATEGORY.Airfare || e.category === EXPENSE_CATEGORY.Accommodation).reduce((s, e) => s + e.sgdAmount, 0);
  const exceptions = req.policyChecks.filter((c) => c.outcome === POLICY_OUTCOME.Exception).map((c) => c.label);
  const outbound = buildOutbound({ authorisationNo: req.authorisationNo, travellerId: req.travellerId, travellers: req.travellers, bookingMethod: req.bookingMethod, bookingDeadline: req.bookingDeadline, approvedCostCeilingSgd: ceiling, approvedExceptions: exceptions, legs: sharedLegs(req), accommodation: acc });
  await prisma.integrationMessage.create({ data: { requestId: id, direction: 'OUTBOUND', kind: 'TMC_HANDOFF', payload: JSON.stringify(outbound, null, 2) } });
  const inbound = simulateInbound(outbound, { overFarePct, ctaAccountId, charged, chargeDate: chargeDate ? chargeDate.toISOString().slice(0, 10) : null });
  await prisma.integrationMessage.create({ data: { requestId: id, direction: 'INBOUND', kind: 'TMC_RESPONSE', payload: JSON.stringify(inbound, null, 2) } });
  const booking = await prisma.travelBooking.create({ data: { requestId: id, pnr: inbound.pnr, invoiceNo: inbound.invoiceNumber ?? null, ticketNo: inbound.ticketNumbers[0], channel: 'TMC', fare: inbound.fareSgd, taxes: inbound.taxesSgd, fees: inbound.feesSgd, hotelRate: inbound.segments.find((x) => x.type === 'HOTEL')?.roomRateSgd, ctaAccountId: inbound.ctaAccountId ?? null, ctaCharged: inbound.ctaCharged ?? false, ctaChargeDate: inbound.ctaChargeDate ? new Date(inbound.ctaChargeDate) : null, status: inbound.bookingStatus } });
  for (const seg of inbound.segments) await prisma.bookingSegment.create({ data: { bookingId: booking.id, type: seg.type, originCode: seg.origin, destCode: seg.destination, bookedClassId: seg.bookedClass, amount: seg.amountSgd ?? seg.roomRateSgd } });
  // DD-31 persist the feed's per-charge CTA breakdown — the authoritative basis for the SAP posting.
  for (const c of inbound.charges ?? []) await prisma.bookingCharge.create({ data: { bookingId: booking.id, type: c.type, expenseTypeId: c.expenseTypeId, amountSgd: c.amountSgd, gstCode: c.gstCode, gstAmountSgd: c.gstAmountSgd, gstClaimable: c.gstClaimable ?? true } });
  await prisma.travelRequest.update({ where: { id }, data: { bookingStatus: BOOKING_STATUS.Booked } });
  await audit(id, 'E-SYS', 'INTEGRATION', `Inbound booking received — PNR ${inbound.pnr}`);
  await postCtaChargesForRequest(id);   // DD-31 post settled CTA charges to SAP on receipt
}

async function makeClaim(id: string, claimantId: string, actualsFactor = 1) {
  const req = await loadRequest(id);
  if (!req) return;
  const settings = await getSettings();
  const prep = prepopulateClaim(req, claimantId, settings.airfareTreatment);
  const mainAlloc = req.allocations.find((a) => a.isMain) ?? req.allocations[0];
  const reason = EcsReference.travelPurpose(req.purposeId ?? '')?.name ?? req.description ?? null;
  const claim = await prisma.travelExpenseClaim.create({
    data: {
      claimNumber: await nextClaimNumber(YEAR), requestId: id, claimantId, status: 'Draft',
      trsNotBooked: req.bookings.length === 0, travelStart: req.startDate, travelEnd: req.endDate,
      additionalApprover1: req.additionalApproverId,
      chargingMode: req.allocations.length > 1 ? 'CLAIM' : 'MAIN', chargingMainCode: mainAlloc?.chargingCode ?? null,
      chargingJson: JSON.stringify({ rows: req.allocations.map((a) => ({ code: a.chargingCode, percent: a.percent, amount: a.amountSgd ?? 0, io: a.internalOrder ?? '', isMain: a.isMain })), lineMap: {} }),
      lines: { create: prep.lines.map((l) => ({ category: l.category, expenseTypeId: l.expenseTypeId, treatment: l.treatment, approvedSgd: l.approvedSgd, bookedSgd: l.bookedSgd, actualSgd: Math.round(l.approvedSgd * actualsFactor), varianceSgd: Math.round(l.approvedSgd * actualsFactor) - l.approvedSgd, receiptOk: true, transactionDate: req.startDate, currency: 'SGD', foreignAmount: l.approvedSgd, reason })) },
    },
  });
  await prisma.travelExpenseLink.create({ data: { requestId: id, claimId: claim.id, travellerId: claimantId } });
  await audit(id, claimantId, 'TE_LINK', `TE claim ${claim.claimNumber} created from ${req.requestNumber}`);
}

/** S29 — DD-19/DD-30 CTA-settled trip (London): airfare (TMC/CTA) + hotel (requestor chose CTA)
 *  are paid centrally and appear on the TE claim as REFERENCE / non-reimbursable, auto-deducted
 *  from the reimbursable total; ODA + conference are employee-paid and reimbursable. Booked on the
 *  USD multi-currency CTA (feed-reported), so its central charges clear to a DIFFERENT clearing
 *  account than the SGD-settled trips — demonstrated in the CTA charges listing. */
async function buildCtaSettledClaimS29() {
  const id = await buildDraft({
    requestorId: 'E-TRAV', travellerId: 'E-TRAV', purposeId: 'TP-TC-ACAD', isResearch: false,
    destCountry: 'GB', destCity: 'LON', destAirport: 'LHR', start: '2026-11-02', end: '2026-11-06',
    travelClassId: 'TC-ECO', bookingMethod: BOOKING_METHOD.TMCOnline,
    airfare: { amount: 1400, currency: 'GBP', classId: 'TC-ECO' },
    hotel: { city: 'LON', nights: 4, quotedNightly: 260 },
    oda: { country: 'GB', city: 'LON', arrive: '2026-11-02', depart: '2026-11-06' },
    conference: { amount: 500 },
    charging: [{ code: 'CC-1000', pct: 100 }],
  });
  // DD-19 — hotel paid centrally on the CTA for this trip (airfare is already CTA via the TMC
  // arrangement), so both are reference-only on the claim.
  await prisma.travelRequest.update({ where: { id }, data: { hotelSettlement: HOTEL_SETTLEMENT.Cta, description: 'CTA-settled trip — airfare + hotel on CTA, ODA + conference reimbursable (S29)' } });
  await submit(id); await approveAll(id); await bookViaTmc(id, 0, 'CTA-SG-USD'); await makeClaim(id, 'E-TRAV', 1);
}

/** S30 — DD-30 booked but PENDING SETTLEMENT: the TMC has confirmed the booking but the airfare is
 *  not yet ticketed/charged to the CTA, so it appears in the CTA Charges "Pending settlement" group
 *  (no charge date) rather than under a credit GL account. */
async function buildCtaPendingSettlementS30() {
  const id = await buildDraft({
    requestorId: 'E-TRAV', travellerId: 'E-TRAV', purposeId: 'TP-OB-ACAD', isResearch: false,
    destCountry: 'JP', destCity: 'TYO', destAirport: 'HND', start: '2026-12-07', end: '2026-12-10',
    travelClassId: 'TC-ECO', bookingMethod: BOOKING_METHOD.TMCOnline,
    airfare: { amount: 1250, currency: 'SGD', classId: 'TC-ECO' },
    hotel: { city: 'TYO', nights: 3, quotedNightly: 300 },
    oda: { country: 'JP', city: 'TYO', arrive: '2026-12-07', depart: '2026-12-10' },
    charging: [{ code: 'CC-1000', pct: 100 }],
  });
  await prisma.travelRequest.update({ where: { id }, data: { description: 'CTA airfare booked, pending settlement — not yet ticketed (S30)' } });
  await submit(id); await approveAll(id); await bookViaTmc(id, 0, 'CTA-SG-SGD', false);
}

/** S31 — DD-31 CTA cross-charge: a CTA-settled trip whose charging is split 60/40 across two cost
 *  centres (cross charge). The accounting-entries report then shows two debit lines per CTA charge
 *  with their share %, crediting the CTA clearing. */
async function buildCtaCrossChargeS31() {
  const id = await buildDraft({
    requestorId: 'E-TRAV', travellerId: 'E-TRAV', purposeId: 'TP-OB-RES', isResearch: false,
    destCountry: 'JP', destCity: 'TYO', destAirport: 'HND', start: '2026-12-14', end: '2026-12-17',
    travelClassId: 'TC-ECO', bookingMethod: BOOKING_METHOD.TMCOnline,
    airfare: { amount: 1600, currency: 'SGD', classId: 'TC-ECO' },
    hotel: { city: 'TYO', nights: 3, quotedNightly: 300 },
    oda: { country: 'JP', city: 'TYO', arrive: '2026-12-14', depart: '2026-12-17' },
    charging: [{ code: 'CC-1000', pct: 60 }, { code: 'CC-2000', pct: 40 }],
  });
  await prisma.travelRequest.update({ where: { id }, data: { hotelSettlement: HOTEL_SETTLEMENT.Cta, description: 'CTA cross-charge — airfare + hotel split 60/40 across two cost centres (S31)' } });
  await submit(id); await approveAll(id); await bookViaTmc(id, 0, 'CTA-SG-SGD', true);
}

/** S32 — DD-31 auto-reversal: a CTA airfare booked, settled and posted to SAP on receipt, then the
 *  booking is cancelled — the posting is auto-reversed (the accounting-entries report shows the
 *  original Reversed plus a reversing entry with flipped Dr/Cr). */
async function buildCtaCancelledReversalS32() {
  const id = await buildDraft({
    requestorId: 'E-TRAV', travellerId: 'E-TRAV', purposeId: 'TP-OB-ACAD', isResearch: false,
    destCountry: 'JP', destCity: 'TYO', destAirport: 'HND', start: '2026-12-21', end: '2026-12-24',
    travelClassId: 'TC-ECO', bookingMethod: BOOKING_METHOD.AgentAssisted,
    airfare: { amount: 1500, currency: 'SGD', classId: 'TC-ECO' },
    hotel: { city: 'TYO', nights: 3, quotedNightly: 300 },
    oda: { country: 'JP', city: 'TYO', arrive: '2026-12-21', depart: '2026-12-24' },
    charging: [{ code: 'CC-1000', pct: 100 }],
  });
  await prisma.travelRequest.update({ where: { id }, data: { description: 'CTA airfare booked & posted, then cancelled — posting auto-reversed (S32)' } });
  await submit(id); await approveAll(id); await bookViaTmc(id, 0, 'CTA-SG-SGD', true);   // posts CTA airfare on receipt
  // Cancellation after booking (DD-22) → CTA posting auto-reversed (DD-31).
  await prisma.travelBooking.updateMany({ where: { requestId: id, channel: 'TMC' }, data: { status: BOOKING_STATUS.Cancelled } });
  await prisma.travelRequest.update({ where: { id }, data: { bookingStatus: BOOKING_STATUS.Cancelled } });
  await reverseCtaChargesForRequest(id, '2026-12-16');
  await audit(id, 'E-SYS', 'INTEGRATION', 'Booking cancelled — CTA posting auto-reversed');
}

export async function seedDemoScenarios() {
  const existing = await prisma.travelRequest.count();
  if (existing > 0) { revalidatePath('/dashboard'); return; }

  // S01 — standard non-research conference trip: Singapore → Tokyo. Approved, booked, claimed.
  const s01 = await buildDraft({
    requestorId: 'E-TRAV', travellerId: 'E-TRAV', purposeId: 'TP-TC-ACAD', isResearch: false,
    destCountry: 'JP', destCity: 'TYO', destAirport: 'HND', start: '2026-09-14', end: '2026-09-18',
    travelClassId: 'TC-ECO', bookingMethod: BOOKING_METHOD.TMCOnline,
    airfare: { amount: 1200, currency: 'SGD', classId: 'TC-ECO' },
    hotel: { city: 'TYO', nights: 4, quotedNightly: 300 },
    oda: { country: 'JP', city: 'TYO', arrive: '2026-09-14', depart: '2026-09-18' },
    conference: { amount: 800 },
    charging: [{ code: 'CC-1000', pct: 100 }],
  });
  await submit(s01); await approveAll(s01); await bookViaTmc(s01); await makeClaim(s01, 'E-TRAV', 1.05);

  // S03 — hotel above cap: quoted SGD 450 > Tokyo cap 350 → exception. Left Pending Exception Approval.
  const s03 = await buildDraft({
    requestorId: 'E-TRAV', travellerId: 'E-TRAV', purposeId: 'TP-TC-ACAD', isResearch: false,
    destCountry: 'JP', destCity: 'TYO', destAirport: 'HND', start: '2026-10-05', end: '2026-10-08',
    travelClassId: 'TC-ECO', bookingMethod: BOOKING_METHOD.TMCOnline,
    airfare: { amount: 1300, currency: 'SGD', classId: 'TC-ECO' },
    hotel: { city: 'TYO', nights: 3, quotedNightly: 450, note: 'Conference venue hotel — only option within walking distance of the sessions; cheaper hotels are 45+ min away and would add taxi costs.' },
    oda: { country: 'JP', city: 'TYO', arrive: '2026-10-05', depart: '2026-10-08' },
    charging: [{ code: 'CC-1000', pct: 100 }],
  });
  await submit(s03); await advanceTo(s03, APPROVER_ROLE.Exception); // leave at Pending Exception for the Exception-Approver persona

  // S02 — research trip: research WBS routes to Research DOA. Approved.
  const s02 = await buildDraft({
    requestorId: 'E-TRAV3', travellerId: 'E-TRAV3', purposeId: 'TP-OB-RES', isResearch: true,
    destCountry: 'GB', destCity: 'LON', destAirport: 'LHR', start: '2026-09-20', end: '2026-09-27',
    travelClassId: 'TC-PEY', bookingMethod: BOOKING_METHOD.AgentAssisted,
    airfare: { amount: 2400, currency: 'SGD', classId: 'TC-PEY' },
    hotel: { city: 'LON', nights: 7, quotedNightly: 260 },
    oda: { country: 'GB', city: 'LON', arrive: '2026-09-20', depart: '2026-09-27' },
    conference: { amount: 600 },
    charging: [{ code: 'WBS-R100', pct: 100 }],
  });
  await submit(s02); await approveAll(s02);

  // S33 — #1 research PI self-approval: Dr Henry Ong (a Principal Investigator) raises a small
  // research-WBS trip within the self-approval limit → the PI IS the DOA and self-approves (no
  // separate DOA). The RO step still applies per config; the DOA step is the PI's own.
  const s33 = await buildDraft({
    requestorId: 'E-TRAV3', travellerId: 'E-TRAV3', purposeId: 'TP-OB-RES', isResearch: true,
    destCountry: 'JP', destCity: 'TYO', destAirport: 'HND', start: '2026-11-10', end: '2026-11-12',
    travelClassId: 'TC-ECO', bookingMethod: BOOKING_METHOD.TMCOnline,
    airfare: { amount: 1200, currency: 'SGD', classId: 'TC-ECO' },
    hotel: { city: 'TYO', nights: 2, quotedNightly: 300 },
    oda: { country: 'JP', city: 'TYO', arrive: '2026-11-10', depart: '2026-11-12' },
    charging: [{ code: 'WBS-R100', pct: 100 }],
  });
  await submit(s33); await approveAll(s33);

  // S11 — group conference trip (§13.16): PA raises for three travellers from two
  // departments to Tokyo; hotel shared, airfare & ODA individual; charging split 60/40.
  await buildGroupS11();

  // S12 — group amendment: an approved group loses a traveller → reapproval (§13.16).
  await buildGroupS12();

  // (Groups are employees-only — a guest is never mixed into a group; guests use their own
  // single-guest request. The former mixed-group scenario was removed; guest bookings are S21/S25/S26.)

  // S14 — multi-leg trip (§13.20): SIN → Tokyo (5n) → Osaka (3n) → SIN, 1 personal day.
  await buildS14();

  // S15 — class upgrade exception (§13.19): Economy entitlement, Business requested. NTU-funded delta → M6.
  await buildS15();
  // S15b — #7 self-funded class upgrade: traveller pays the TMC the delta directly (not reimbursed).
  await buildS15b();
  // S35 — #14 booked NTU-funded upgrade: CTA airfare posts split (entitlement → CC, delta → M6).
  await buildS35();

  // S16 — multi-country itinerary: SIN → London (3n) → Paris (2n) → SIN.
  await buildS16();

  // S18 — DD-23 emergency book-first lane: urgent agent-assisted trip to Seoul.
  await buildEmergencyS18();

  // S19 — a DRAFT left unsubmitted, so the traveller can retrieve it from the dashboard and
  // continue editing (demonstrates the draft → edit → submit flow).
  await buildDraftS19();
  await buildEmergencyEligibleDraftS27();

  // S20–S23 — additional requests left at a PENDING-approval stage, across trip types, so the
  // approver queue shows a group, a guest, a multi-city and a one-way request awaiting approval.
  await buildGroupPendingS20();
  await buildGuestPendingS21();
  await buildMultiCityPendingS22();
  await buildOneWayPendingS23();
  await buildLongTermPendingS24();
  await buildGuestSeoulPendingS25();
  await buildGuestLondonBookedS26();
  await buildMultiCityBookedS28();
  await buildCtaSettledClaimS29();
  await buildCtaPendingSettlementS30();
  await buildCtaCrossChargeS31();
  await buildCtaCancelledReversalS32();

  // Normalise every seeded request's estimate lines to the latest design: hotel stay dates filled
  // from the itinerary (so "Stay dates" isn't "— → —"), and ODA rebuilt as one full-rate line per
  // city. Then keep each non-draft request's recorded approved amount in step with its lines.
  const settings = await getSettings();
  const allReqs = await prisma.travelRequest.findMany({ select: { id: true, status: true } });
  for (const r of allReqs) {
    await backfillHotelDates(r.id);
    await rebuildOda(r.id);
    if (r.status !== REQUEST_STATUS.Draft && r.status !== REQUEST_STATUS.SentBack) {
      const fresh = await loadRequest(r.id);
      if (fresh) {
        const sum = computeSummary(fresh.expenses, settings.approvalAmountBasis);
        await prisma.travelRequest.update({ where: { id: r.id }, data: { approvalAmountSgd: sum.approvalAmount } });
      }
    }
  }

  revalidatePath('/dashboard');
}

/** S20 — group booking left at Pending DOA (three travellers, Tokyo). */
async function buildGroupPendingS20() {
  const id = await buildGroupDraft('Group conference — Tokyo (pending approval, S20)', '2026-12-14', '2026-12-18');
  await submit(id);
  await advanceTo(id, APPROVER_ROLE.DOA);
}

/** S21 — standalone guest booking (non-employee speaker) left at Pending DOA. */
async function buildGuestPendingS21() {
  const settings = await getSettings();
  const requestNumber = await nextRequestNumber(YEAR);
  const start = '2026-12-07', end = '2026-12-10';
  const req = await prisma.travelRequest.create({ data: {
    requestNumber, requestorId: 'E-PA', travellerId: 'GUEST', travellerType: 'GUEST',
    guestName: 'Prof Hiroshi Tanaka', guestEmail: 'h.tanaka@u-tokyo.ac.jp', guestOrg: 'University of Tokyo',
    entityId: EcsIdentity.entity().id, departmentId: 'SCH-CS', status: REQUEST_STATUS.Draft, bookingStatus: BOOKING_STATUS.NotSent,
    purposeId: 'TP-TC-ACAD', description: 'Guest speaker — invited seminar, Tokyo (pending approval, S21)',
    destCountry: 'JP', destCity: 'TYO', startDate: day(start), endDate: day(end),
    travelClassId: 'TC-ECO', entitledClassId: 'TC-ECO', classBasis: 'Guest default — Economy (§8)',
    bookingArrangement: 'AUTO', bookingMethod: BOOKING_METHOD.AgentAssisted,
  } });
  const id = req.id;
  await audit(id, 'E-PA', 'CREATE', `Guest travel draft ${requestNumber} created for Prof Hiroshi Tanaka (University of Tokyo)`);
  await prisma.itineraryLeg.create({ data: { requestId: id, seq: 1, originCode: 'SIN', destCode: 'HND', departDate: day(start), durationHours: 7, travelClassId: 'TC-ECO' } });
  await prisma.itineraryLeg.create({ data: { requestId: id, seq: 2, originCode: 'HND', destCode: 'SIN', departDate: day(end), durationHours: 0, travelClassId: 'TC-ECO' } });
  // §8 guest estimate = airfare + accommodation only (no ODA — guests file no claim).
  await prisma.estimatedExpense.create({ data: { requestId: id, category: EXPENSE_CATEGORY.Airfare, expenseTypeId: 'ET-AIR', currency: 'SGD', foreignAmount: 1250, sgdAmount: 1250, estimateBasis: 'QUOTED', originCode: 'SIN', destCode: 'HND', proposedClassId: 'TC-ECO', fareCeiling: 1250 } });
  const hcalc = computeAccommodation({ cityCode: 'TYO', nights: 3, personalNights: 0, quotedNightly: 320, basis: settings.hotelEstimateBasis });
  const he = await prisma.estimatedExpense.create({ data: { requestId: id, category: EXPENSE_CATEGORY.Accommodation, expenseTypeId: 'ET-ACC', currency: 'SGD', foreignAmount: hcalc.sgdAmount, sgdAmount: hcalc.sgdAmount, estimateBasis: settings.hotelEstimateBasis } });
  await prisma.accommodationEstimate.create({ data: { expenseId: he.id, city: 'TYO', nights: 3, personalNights: 0, quotedNightly: 320, capNightly: hcalc.capNightly, budgetedNightly: hcalc.budgetedNightly, capVariance: hcalc.capVariance, exceptionOutcome: hcalc.outcome } });
  const master = EcsCharging.code('CC-1000');
  await prisma.chargingAllocation.create({ data: { requestId: id, chargingCode: 'CC-1000', percent: 100, chargingType: master?.type ?? 'CC', companyCode: master?.companyCode, businessArea: master?.businessArea, isResearch: false, isMain: true } });
  await submit(id);
  await advanceTo(id, APPROVER_ROLE.DOA);
}

/** Build a SINGLE-guest travel request (§8: one guest per booking; a guest is never part of a
 *  group — groups are employees-only). Guest estimate is airfare + accommodation only (no ODA —
 *  guests file no claim). Returns the request id (unsubmitted). */
async function seedGuestRequest(o: { guestName: string; guestEmail: string; guestOrg: string; purposeId: string; destCountry: string; destCity: string; destAirport: string; start: string; end: string; nights: number; durationHours: number; airfare: number; nightly: number; descr: string }): Promise<string> {
  const settings = await getSettings();
  const requestNumber = await nextRequestNumber(YEAR);
  const req = await prisma.travelRequest.create({ data: {
    requestNumber, requestorId: 'E-PA', travellerId: 'GUEST', travellerType: 'GUEST',
    guestName: o.guestName, guestEmail: o.guestEmail, guestOrg: o.guestOrg,
    entityId: EcsIdentity.entity().id, departmentId: 'SCH-CS', status: REQUEST_STATUS.Draft, bookingStatus: BOOKING_STATUS.NotSent,
    purposeId: o.purposeId, description: o.descr,
    destCountry: o.destCountry, destCity: o.destCity, startDate: day(o.start), endDate: day(o.end),
    travelClassId: 'TC-ECO', entitledClassId: 'TC-ECO', classBasis: 'Guest default — Economy (§8)',
    bookingArrangement: 'AUTO', bookingMethod: BOOKING_METHOD.AgentAssisted,
  } });
  const id = req.id;
  await audit(id, 'E-PA', 'CREATE', `Guest travel draft ${requestNumber} created for ${o.guestName} (${o.guestOrg})`);
  await prisma.itineraryLeg.create({ data: { requestId: id, seq: 1, originCode: 'SIN', destCode: o.destAirport, departDate: day(o.start), durationHours: o.durationHours, travelClassId: 'TC-ECO' } });
  await prisma.itineraryLeg.create({ data: { requestId: id, seq: 2, originCode: o.destAirport, destCode: 'SIN', departDate: day(o.end), durationHours: 0, travelClassId: 'TC-ECO' } });
  await prisma.estimatedExpense.create({ data: { requestId: id, category: EXPENSE_CATEGORY.Airfare, expenseTypeId: 'ET-AIR', currency: 'SGD', foreignAmount: o.airfare, sgdAmount: o.airfare, estimateBasis: 'QUOTED', originCode: 'SIN', destCode: o.destAirport, proposedClassId: 'TC-ECO', fareCeiling: o.airfare } });
  const hcalc = computeAccommodation({ cityCode: o.destCity, nights: o.nights, personalNights: 0, quotedNightly: o.nightly, basis: settings.hotelEstimateBasis });
  const he = await prisma.estimatedExpense.create({ data: { requestId: id, category: EXPENSE_CATEGORY.Accommodation, expenseTypeId: 'ET-ACC', currency: 'SGD', foreignAmount: hcalc.sgdAmount, sgdAmount: hcalc.sgdAmount, estimateBasis: settings.hotelEstimateBasis } });
  await prisma.accommodationEstimate.create({ data: { expenseId: he.id, city: o.destCity, nights: o.nights, personalNights: 0, quotedNightly: o.nightly, capNightly: hcalc.capNightly, budgetedNightly: hcalc.budgetedNightly, capVariance: hcalc.capVariance, exceptionOutcome: hcalc.outcome } });
  const master = EcsCharging.code('CC-1000');
  await prisma.chargingAllocation.create({ data: { requestId: id, chargingCode: 'CC-1000', percent: 100, chargingType: master?.type ?? 'CC', companyCode: master?.companyCode, businessArea: master?.businessArea, isResearch: false, isMain: true } });
  return id;
}

/** S25 — single guest keynote speaker (Prof Maria Santos, MIT) to Seoul; left Pending DOA. */
async function buildGuestSeoulPendingS25() {
  const id = await seedGuestRequest({ guestName: 'Prof Maria Santos', guestEmail: 'maria.santos@mit.edu', guestOrg: 'MIT', purposeId: 'TP-TC-ACAD', destCountry: 'KR', destCity: 'SEL', destAirport: 'ICN', start: '2026-11-23', end: '2026-11-27', nights: 4, durationHours: 6, airfare: 1450, nightly: 240, descr: 'Guest keynote speaker — Seoul symposium (pending approval, S25)' });
  await submit(id);
  await advanceTo(id, APPROVER_ROLE.DOA);
}

/** S26 — single guest external examiner (Prof Eleanor Vance, Cambridge) to London; approved & booked. */
async function buildGuestLondonBookedS26() {
  const id = await seedGuestRequest({ guestName: 'Prof Eleanor Vance', guestEmail: 'e.vance@cam.ac.uk', guestOrg: 'University of Cambridge', purposeId: 'TP-OB-ACAD', destCountry: 'GB', destCity: 'LON', destAirport: 'LHR', start: '2026-12-01', end: '2026-12-05', nights: 4, durationHours: 13, airfare: 1850, nightly: 260, descr: 'Guest external examiner — London (approved & booked, S26)' });
  await submit(id);
  await approveAll(id);
  await bookViaTmc(id, 0, 'CTA-GUEST');   // DD-30 guest bookings lodged to the dedicated guest CTA (separate clearing)
}

/** S22 — multi-city itinerary (SIN → Tokyo → Seoul → SIN) left at Pending DOA. */
async function buildMultiCityPendingS22() {
  const settings = await getSettings();
  const requestNumber = await nextRequestNumber(YEAR);
  const req = await prisma.travelRequest.create({ data: {
    requestNumber, requestorId: 'E-TRAV', travellerId: 'E-TRAV',
    entityId: EcsIdentity.entity().id, departmentId: 'SCH-CS', status: REQUEST_STATUS.Draft, bookingStatus: BOOKING_STATUS.NotSent,
    purposeId: 'TP-TC-ACAD', description: 'Multi-city — Tokyo, Osaka & Seoul (pending approval, S22)',
    tripType: 'MULTI_CITY', destCountry: 'JP', destCity: 'TYO', startDate: day('2026-12-01'), endDate: day('2026-12-07'),
    travelClassId: 'TC-PEY', entitledClassId: 'TC-PEY', classBasis: 'Register C20 — Premium Economy for flights ≥ 6h',
    bookingArrangement: 'AUTO', bookingMethod: BOOKING_METHOD.AgentAssisted,
  } });
  const id = req.id;
  await audit(id, 'E-TRAV', 'CREATE', `Multi-city draft ${requestNumber} created`);
  const legs = [
    { seq: 1, o: 'SIN', d: 'HND', dep: '2026-12-01', dur: 7, nights: 2 },   // Tokyo
    { seq: 2, o: 'HND', d: 'KIX', dep: '2026-12-03', dur: 1.5, nights: 2 }, // Osaka
    { seq: 3, o: 'KIX', d: 'ICN', dep: '2026-12-05', dur: 2, nights: 2 },   // Seoul
    { seq: 4, o: 'ICN', d: 'SIN', dep: '2026-12-07', dur: 6, nights: 0 },
  ];
  for (const l of legs) await prisma.itineraryLeg.create({ data: { requestId: id, seq: l.seq, originCode: l.o, destCode: l.d, departDate: day(l.dep), arriveDate: day(l.dep), transportMode: 'AIR', durationHours: l.dur, nights: l.nights, travelClassId: 'TC-PEY', entitledClassId: 'TC-PEY', chosenClassId: 'TC-PEY' } });
  await prisma.estimatedExpense.create({ data: { requestId: id, category: EXPENSE_CATEGORY.Airfare, expenseTypeId: 'ET-AIR', currency: 'SGD', foreignAmount: 3400, sgdAmount: 3400, estimateBasis: 'QUOTED', originCode: 'SIN', destCode: 'HND', proposedClassId: 'TC-PEY', fareCeiling: 3400 } });
  for (const [city, nights, rate] of [['TYO', 2, 300], ['OSA', 2, 300], ['SEL', 2, 240]] as [string, number, number][]) {
    const c = computeAccommodation({ cityCode: city, nights, personalNights: 0, quotedNightly: rate, basis: settings.hotelEstimateBasis });
    const e = await prisma.estimatedExpense.create({ data: { requestId: id, category: EXPENSE_CATEGORY.Accommodation, expenseTypeId: 'ET-ACC', currency: 'SGD', foreignAmount: c.sgdAmount, sgdAmount: c.sgdAmount, estimateBasis: settings.hotelEstimateBasis } });
    await prisma.accommodationEstimate.create({ data: { expenseId: e.id, city, nights, personalNights: 0, quotedNightly: rate, capNightly: c.capNightly, budgetedNightly: c.budgetedNightly, capVariance: c.capVariance, exceptionOutcome: c.outcome } });
  }
  for (const [country, city, arr, dep] of [['JP', 'TYO', '2026-12-01', '2026-12-05'], ['KR', 'SEL', '2026-12-05', '2026-12-07']] as [string, string, string, string][]) {
    const oda = computeOda({ countryCode: country, arrive: day(arr), depart: day(dep), personalDays: 0 });
    const oe = await prisma.estimatedExpense.create({ data: { requestId: id, category: EXPENSE_CATEGORY.ODA, expenseTypeId: 'ET-ODA', currency: 'SGD', foreignAmount: oda.sgdAmount, sgdAmount: oda.sgdAmount, estimateBasis: 'RATE' } });
    await prisma.oDAEstimate.create({ data: { expenseId: oe.id, country, city, arrive: day(arr), depart: day(dep), eligibleDays: oda.eligibleDays, personalDays: 0, dailyRate: oda.dailyRate } });
  }
  const master = EcsCharging.code('CC-1000');
  await prisma.chargingAllocation.create({ data: { requestId: id, chargingCode: 'CC-1000', percent: 100, chargingType: master?.type ?? 'CC', companyCode: master?.companyCode, businessArea: master?.businessArea, isResearch: false, isMain: true } });
  await submit(id);
  await advanceTo(id, APPROVER_ROLE.DOA);
}

/** S28 — multi-city, APPROVED & BOOKED across TWO PNRs (DD-17). Demonstrates PNR provenance on the
 *  TR: SIN→HND→KIX ticketed on PNR-A, KIX→ICN→SIN on PNR-B, so the Review itinerary tags each leg
 *  to its PNR. Booked segments carry their dates so the per-leg join matches precisely. */
async function buildMultiCityBookedS28() {
  const settings = await getSettings();
  const requestNumber = await nextRequestNumber(YEAR);
  const req0 = await prisma.travelRequest.create({ data: {
    requestNumber, requestorId: 'E-TRAV', travellerId: 'E-TRAV',
    entityId: EcsIdentity.entity().id, departmentId: 'SCH-CS', status: REQUEST_STATUS.Draft, bookingStatus: BOOKING_STATUS.NotSent,
    purposeId: 'TP-TC-ACAD', description: 'Multi-city — Tokyo, Osaka & Seoul (approved & booked, 2 PNRs, S28)',
    tripType: 'MULTI_CITY', destCountry: 'JP', destCity: 'TYO', startDate: day('2026-11-16'), endDate: day('2026-11-22'),
    travelClassId: 'TC-PEY', entitledClassId: 'TC-PEY', classBasis: 'Register C20 — Premium Economy for flights ≥ 6h',
    bookingArrangement: 'AUTO', bookingMethod: BOOKING_METHOD.AgentAssisted,
  } });
  const id = req0.id;
  await audit(id, 'E-TRAV', 'CREATE', `Multi-city draft ${requestNumber} created`);
  const legs = [
    { seq: 1, o: 'SIN', d: 'HND', dep: '2026-11-16', dur: 7, nights: 2 },   // Tokyo
    { seq: 2, o: 'HND', d: 'KIX', dep: '2026-11-18', dur: 1.5, nights: 2 }, // Osaka
    { seq: 3, o: 'KIX', d: 'ICN', dep: '2026-11-20', dur: 2, nights: 2 },   // Seoul
    { seq: 4, o: 'ICN', d: 'SIN', dep: '2026-11-22', dur: 6, nights: 0 },
  ];
  for (const l of legs) await prisma.itineraryLeg.create({ data: { requestId: id, seq: l.seq, originCode: l.o, destCode: l.d, departDate: day(l.dep), arriveDate: day(l.dep), transportMode: 'AIR', durationHours: l.dur, nights: l.nights, travelClassId: 'TC-PEY', entitledClassId: 'TC-PEY', chosenClassId: 'TC-PEY' } });
  await prisma.estimatedExpense.create({ data: { requestId: id, category: EXPENSE_CATEGORY.Airfare, expenseTypeId: 'ET-AIR', currency: 'SGD', foreignAmount: 3400, sgdAmount: 3400, estimateBasis: 'QUOTED', originCode: 'SIN', destCode: 'HND', proposedClassId: 'TC-PEY', fareCeiling: 3400 } });
  for (const [city, nights, rate] of [['TYO', 2, 300], ['OSA', 2, 300], ['SEL', 2, 240]] as [string, number, number][]) {
    const c = computeAccommodation({ cityCode: city, nights, personalNights: 0, quotedNightly: rate, basis: settings.hotelEstimateBasis });
    const e = await prisma.estimatedExpense.create({ data: { requestId: id, category: EXPENSE_CATEGORY.Accommodation, expenseTypeId: 'ET-ACC', currency: 'SGD', foreignAmount: c.sgdAmount, sgdAmount: c.sgdAmount, estimateBasis: settings.hotelEstimateBasis } });
    await prisma.accommodationEstimate.create({ data: { expenseId: e.id, city, nights, personalNights: 0, quotedNightly: rate, capNightly: c.capNightly, budgetedNightly: c.budgetedNightly, capVariance: c.capVariance, exceptionOutcome: c.outcome } });
  }
  const master = EcsCharging.code('CC-1000');
  await prisma.chargingAllocation.create({ data: { requestId: id, chargingCode: 'CC-1000', percent: 100, chargingType: master?.type ?? 'CC', companyCode: master?.companyCode, businessArea: master?.businessArea, isResearch: false, isMain: true } });
  await submit(id);
  await approveAll(id);
  // Book across TWO PNRs (DD-17): the TMC splits the multi-city journey for competitive fares.
  const booked = await loadRequest(id);
  const seed = (booked!.authorisationNo ?? '').replace(/\D/g, '').slice(-4) || '0028';
  const mkPnr = async (tag: string, sel: typeof legs, air: { fare: number; taxes: number; fees: number }, hotels: [string, number][]) => {
    const b = await prisma.travelBooking.create({ data: { requestId: id, pnr: `PNR${seed}-${tag}`, ticketNo: `TKT-${seed}-${tag}`, channel: 'TMC', fare: air.fare, taxes: air.taxes, fees: air.fees, hotelRate: hotels[0]?.[1] ?? null, ctaAccountId: 'CTA-SG-SGD', ctaCharged: true, ctaChargeDate: day('2026-11-09'), status: BOOKING_STATUS.Booked } });
    for (const l of sel) await prisma.bookingSegment.create({ data: { bookingId: b.id, type: 'AIR', originCode: l.o, destCode: l.d, bookedClassId: 'TC-PEY', departDate: day(l.dep), arriveDate: day(l.dep), amount: Math.round(air.fare / sel.length) } });
    for (const [, rate] of hotels) await prisma.bookingSegment.create({ data: { bookingId: b.id, type: 'HOTEL', amount: rate } });
  };
  await mkPnr('A', legs.slice(0, 2), { fare: 1700, taxes: 204, fees: 30 }, [['TYO', 300], ['OSA', 300]]);
  await mkPnr('B', legs.slice(2, 4), { fare: 1700, taxes: 204, fees: 30 }, [['SEL', 240]]);
  await prisma.travelRequest.update({ where: { id }, data: { bookingStatus: BOOKING_STATUS.Booked } });
  await audit(id, 'E-SYS', 'INTEGRATION', `Inbound received — 2 PNRs (PNR${seed}-A, PNR${seed}-B)`);
  await postCtaChargesForRequest(id);   // DD-31 post settled CTA charges to SAP on receipt
}

/** S23 — one-way trip (single leg) left at Pending RO. */
/** S24 — long-term secondment (45 nights, Tokyo): a trip long enough to exercise the ODA duration
 *  tiers (days 1–15 @ 100%, 16–31 @ 75%, 32+ at the country's monthly allowance rate). Left at
 *  Pending DOA. The end-of-seed pass re-derives its ODA with the tiered calc. */
async function buildLongTermPendingS24() {
  const id = await buildDraft({
    requestorId: 'E-TRAV', travellerId: 'E-TRAV', purposeId: 'TP-OB-ACAD', isResearch: false,
    destCountry: 'JP', destCity: 'TYO', destAirport: 'HND', start: '2026-11-02', end: '2026-12-17',
    travelClassId: 'TC-ECO', bookingMethod: BOOKING_METHOD.TMCOnline,
    airfare: { amount: 1600, currency: 'SGD', classId: 'TC-ECO' },
    hotel: { city: 'TYO', nights: 45, quotedNightly: 300 },
    oda: { country: 'JP', city: 'TYO', arrive: '2026-11-02', depart: '2026-12-17' },
    charging: [{ code: 'CC-1000', pct: 100 }],
  });
  await prisma.travelRequest.update({ where: { id }, data: { description: 'Long-term secondment — 45 nights, Tokyo (ODA duration tiers, S24)' } });
  await submit(id);
  await advanceTo(id, APPROVER_ROLE.DOA);
}

async function buildOneWayPendingS23() {
  const start = '2026-11-16';
  const requestNumber = await nextRequestNumber(YEAR);
  const req = await prisma.travelRequest.create({ data: {
    requestNumber, requestorId: 'E-TRAV', travellerId: 'E-TRAV',
    entityId: EcsIdentity.entity().id, departmentId: 'SCH-CS', status: REQUEST_STATUS.Draft, bookingStatus: BOOKING_STATUS.NotSent,
    purposeId: 'TP-TC-ACAD', description: 'One-way trip — Seoul secondment (pending approval, S23)',
    tripType: 'ONE_WAY', destCountry: 'KR', destCity: 'SEL', startDate: day(start), endDate: day(start),
    travelClassId: 'TC-ECO', entitledClassId: 'TC-ECO', classBasis: 'Default — Economy',
    bookingArrangement: 'AUTO', bookingMethod: BOOKING_METHOD.TMCOnline,
  } });
  const id = req.id;
  await audit(id, 'E-TRAV', 'CREATE', `One-way draft ${requestNumber} created`);
  await prisma.itineraryLeg.create({ data: { requestId: id, seq: 1, originCode: 'SIN', destCode: 'ICN', departDate: day(start), arriveDate: day(start), transportMode: 'AIR', durationHours: 6, nights: 0, travelClassId: 'TC-ECO', entitledClassId: 'TC-ECO', chosenClassId: 'TC-ECO' } });
  await prisma.estimatedExpense.create({ data: { requestId: id, category: EXPENSE_CATEGORY.Airfare, expenseTypeId: 'ET-AIR', currency: 'SGD', foreignAmount: 600, sgdAmount: 600, estimateBasis: 'QUOTED', originCode: 'SIN', destCode: 'ICN', proposedClassId: 'TC-ECO', fareCeiling: 600 } });
  const master = EcsCharging.code('CC-1000');
  await prisma.chargingAllocation.create({ data: { requestId: id, chargingCode: 'CC-1000', percent: 100, chargingType: master?.type ?? 'CC', companyCode: master?.companyCode, businessArea: master?.businessArea, isResearch: false, isMain: true } });
  await submit(id); // individual → leaves at Pending RO
}

/** S19 — a draft travel request that is NOT submitted, so it sits in the traveller's
 *  "Drafts & sent back" bucket and can be reopened and edited. */
async function buildDraftS19() {
  const id = await buildDraft({
    requestorId: 'E-TRAV', travellerId: 'E-TRAV', purposeId: 'TP-TC-ACAD', isResearch: false,
    destCountry: 'JP', destCity: 'OSA', destAirport: 'KIX', start: '2026-12-14', end: '2026-12-18',
    travelClassId: 'TC-ECO', bookingMethod: BOOKING_METHOD.TMCOnline,
    airfare: { amount: 1400, currency: 'SGD', classId: 'TC-ECO' },
    hotel: { city: 'OSA', nights: 4, quotedNightly: 300 },
    oda: { country: 'JP', city: 'OSA', arrive: '2026-12-14', depart: '2026-12-18' },
    charging: [{ code: 'CC-1000', pct: 100 }],
  });
  await prisma.travelRequest.update({ where: { id }, data: { description: 'Draft — Osaka research workshop (continue editing)' } });
  // Deliberately NOT submitted — stays in Draft so the traveller can retrieve and edit it.
}

/** S27 — a complete DRAFT that qualifies for the emergency lane, parked at the submit stage (not
 *  submitted). The booking method is TMC agent-assisted and departure is within the lead-time
 *  window, so the Review & Submit step offers the emergency lane (named authoriser + justification +
 *  authorising e-mail). Open it from the dashboard and go to Submit to see the lane available. */
async function buildEmergencyEligibleDraftS27() {
  const id = await buildDraft({
    requestorId: 'E-TRAV4', travellerId: 'E-TRAV4', purposeId: 'TP-TC-ACAD', isResearch: false,
    destCountry: 'KR', destCity: 'SEL', destAirport: 'ICN', start: '2026-10-28', end: '2026-11-01',
    travelClassId: 'TC-ECO', bookingMethod: BOOKING_METHOD.AgentAssisted,
    airfare: { amount: 1250, currency: 'SGD', classId: 'TC-ECO' },
    hotel: { city: 'SEL', nights: 4, quotedNightly: 240 },
    oda: { country: 'KR', city: 'SEL', arrive: '2026-10-28', depart: '2026-11-01' },
    charging: [{ code: 'CC-1000', pct: 100 }],
  });
  // Agent-assisted booking + departure inside the lead-time window ⇒ the emergency lane is AVAILABLE
  // at Submit. Left in Draft (not submitted) so it sits at the submit stage.
  await prisma.travelRequest.update({ where: { id }, data: { bookingArrangement: 'AUTO', description: 'Draft — urgent Seoul trip, agent-assisted (emergency lane available; not yet submitted, S27)' } });
}

/** S18 — §13.x / DD-23 emergency (book-first) lane: an urgent agent-assisted trip to Seoul,
 *  authorised by a senior officer (the Dean) with the authorising e-mail attached, handed to the
 *  TMC automatically on submit, while the FULL approval workflow is still pending (retrospective
 *  DOA ratification). A structured destination is captured — the lane changes timing, not rigour. */
async function buildEmergencyS18() {
  const id = await buildDraft({
    requestorId: 'E-TRAV', travellerId: 'E-TRAV', purposeId: 'TP-TC-ACAD', isResearch: false,
    destCountry: 'KR', destCity: 'SEL', destAirport: 'ICN', start: '2026-10-26', end: '2026-10-29',
    travelClassId: 'TC-ECO', bookingMethod: BOOKING_METHOD.AgentAssisted,
    airfare: { amount: 1600, currency: 'SGD', classId: 'TC-ECO' },
    hotel: { city: 'SEL', nights: 3, quotedNightly: 280, note: 'Only hotel with same-day availability next to the funder meeting venue; cheaper options were fully booked at short notice (emergency booking).' },
    oda: { country: 'KR', city: 'SEL', arrive: '2026-10-26', depart: '2026-10-29' },
    charging: [{ code: 'CC-1000', pct: 100 }],
  });
  // Emergency lane: authorised by the Dean (senior, non-traveller); the DOA ratifies retrospectively.
  await prisma.travelRequest.update({ where: { id }, data: {
    isEmergency: true, isRetrospective: false, emergencyOutsideWindow: false,
    emergencyAuthoriserId: 'E-DEAN', emergencyRatified: false,
    emergencyJustification: 'Same-day flight to an urgent funder meeting in Seoul; TMC holding space pending authorisation.',
    description: 'Urgent funder meeting — Seoul (emergency book-first)',
  } });
  // Mandatory authorising e-mail attachment for the emergency lane.
  await prisma.attachment.create({ data: {
    requestId: id, docType: EMERGENCY_APPROVAL_DOC, fileName: 'emergency-approval-email.pdf',
    sizeKb: 48, contentType: 'application/pdf', uploadedById: 'E-TRAV',
  } });
  // Submit → full route built; status Pending DOA (retrospective ratification in progress).
  const req = await submit(id);
  // Book-first: automatic hand-off to the TMC on submit — outbound sent, awaiting the booking.
  const acc = req.expenses.filter((e) => e.category === EXPENSE_CATEGORY.Accommodation && e.accommodation).map((e) => ({ city: e.accommodation!.city, nights: e.accommodation!.nights, cappedNightlySgd: e.accommodation!.budgetedNightly }));
  const ceiling = req.expenses.filter((e) => e.category === EXPENSE_CATEGORY.Airfare || e.category === EXPENSE_CATEGORY.Accommodation).reduce((s, e) => s + e.sgdAmount, 0);
  const outbound = buildOutbound({ authorisationNo: req.authorisationNo, travellerId: req.travellerId, travellers: req.travellers, bookingMethod: req.bookingMethod, bookingDeadline: req.bookingDeadline, approvedCostCeilingSgd: ceiling, approvedExceptions: [], legs: sharedLegs(req), accommodation: acc });
  await prisma.integrationMessage.create({ data: { requestId: id, direction: 'OUTBOUND', kind: 'TMC_HANDOFF', payload: JSON.stringify(outbound, null, 2) } });
  await prisma.travelRequest.update({ where: { id }, data: { bookingStatus: BOOKING_STATUS.SentToTMC } });
  await audit(id, 'E-SYS', 'INTEGRATION', 'Emergency book-first — handed off to the TMC on submit, ahead of DOA ratification (DD-23)');
  // Advance past the earlier steps so the request sits at Pending DOA — the DOA ratifies the
  // emergency retrospectively, giving the default DOA persona an actionable item to review.
  await advanceTo(id, APPROVER_ROLE.DOA);
}

/** S16 — multi-country trip across two countries (United Kingdom & France), with per-city
 *  accommodation and a per-country ODA line each. Demonstrates a multi-country itinerary. */
async function buildS16() {
  const settings = await getSettings();
  const requestNumber = await nextRequestNumber(YEAR);
  const req = await prisma.travelRequest.create({
    data: {
      requestNumber, requestorId: 'E-TRAV', travellerId: 'E-TRAV',
      entityId: EcsIdentity.entity().id, departmentId: 'SCH-CS', status: REQUEST_STATUS.Draft, bookingStatus: BOOKING_STATUS.NotSent,
      purposeId: 'TP-TC-ACAD', description: 'Multi-country trip — London & Paris (S16)',
      tripType: 'MULTI_CITY', destCountry: 'GB', destCity: 'LON', startDate: day('2026-12-01'), endDate: day('2026-12-06'),
      travelClassId: 'TC-ECO', entitledClassId: 'TC-ECO', classBasis: 'Default — Economy',
      bookingArrangement: 'AUTO', bookingMethod: BOOKING_METHOD.AgentAssisted,
    },
  });
  const id = req.id;
  await audit(id, 'E-TRAV', 'CREATE', `Multi-country draft ${requestNumber} created`);
  // Legs crossing two countries: SIN → London → Paris → SIN.
  const legs = [
    { seq: 1, o: 'SIN', d: 'LHR', dep: '2026-12-01', dur: 14, nights: 3 },
    { seq: 2, o: 'LHR', d: 'CDG', dep: '2026-12-04', dur: 1.5, nights: 2 },
    { seq: 3, o: 'CDG', d: 'SIN', dep: '2026-12-06', dur: 13, nights: 0 },
  ];
  for (const l of legs) {
    await prisma.itineraryLeg.create({ data: { requestId: id, seq: l.seq, originCode: l.o, destCode: l.d, departDate: day(l.dep), arriveDate: day(l.dep), transportMode: 'AIR', durationHours: l.dur, nights: l.nights, travelClassId: 'TC-ECO', entitledClassId: 'TC-ECO', chosenClassId: 'TC-ECO' } });
  }
  await prisma.estimatedExpense.create({ data: { requestId: id, category: EXPENSE_CATEGORY.Airfare, expenseTypeId: 'ET-AIR', currency: 'SGD', foreignAmount: 2850, sgdAmount: 2850, estimateBasis: 'QUOTED', originCode: 'SIN', destCode: 'LHR', proposedClassId: 'TC-ECO', fareCeiling: 2850 } });
  // Accommodation per city (London & Paris) against each city cap.
  for (const [city, nights, rate] of [['LON', 3, 260], ['PAR', 2, 280]] as [string, number, number][]) {
    const c = computeAccommodation({ cityCode: city, nights, personalNights: 0, quotedNightly: rate, basis: settings.hotelEstimateBasis });
    const e = await prisma.estimatedExpense.create({ data: { requestId: id, category: EXPENSE_CATEGORY.Accommodation, expenseTypeId: 'ET-ACC', currency: 'SGD', foreignAmount: c.sgdAmount, sgdAmount: c.sgdAmount, estimateBasis: settings.hotelEstimateBasis } });
    await prisma.accommodationEstimate.create({ data: { expenseId: e.id, city, nights, personalNights: 0, quotedNightly: rate, capNightly: c.capNightly, budgetedNightly: c.budgetedNightly, capVariance: c.capVariance, exceptionOutcome: c.outcome } });
  }
  // One ODA line per country, each over that country's leg of the trip (§4.5).
  for (const [country, city, arr, dep] of [['GB', 'LON', '2026-12-01', '2026-12-04'], ['FR', 'PAR', '2026-12-04', '2026-12-06']] as [string, string, string, string][]) {
    const oda = computeOda({ countryCode: country, arrive: day(arr), depart: day(dep), personalDays: 0 });
    const oe = await prisma.estimatedExpense.create({ data: { requestId: id, category: EXPENSE_CATEGORY.ODA, expenseTypeId: 'ET-ODA', currency: 'SGD', foreignAmount: oda.sgdAmount, sgdAmount: oda.sgdAmount, estimateBasis: 'RATE' } });
    await prisma.oDAEstimate.create({ data: { expenseId: oe.id, country, city, arrive: day(arr), depart: day(dep), eligibleDays: oda.eligibleDays, personalDays: 0, dailyRate: oda.dailyRate } });
  }
  const master = EcsCharging.code('CC-1000');
  await prisma.chargingAllocation.create({ data: { requestId: id, chargingCode: 'CC-1000', percent: 100, chargingType: master?.type ?? 'CC', companyCode: master?.companyCode, businessArea: master?.businessArea, isResearch: false, isMain: true } });
  await submit(id); await approveAll(id);
}

async function buildS14() {
  const settings = await getSettings();
  const requestNumber = await nextRequestNumber(YEAR);
  const req = await prisma.travelRequest.create({
    data: {
      requestNumber, requestorId: 'E-TRAV', travellerId: 'E-TRAV',
      entityId: EcsIdentity.entity().id, departmentId: 'SCH-CS', status: REQUEST_STATUS.Draft, bookingStatus: BOOKING_STATUS.NotSent,
      purposeId: 'TP-TC-ACAD', description: 'Multi-leg trip — Tokyo & Osaka (S14)',
      tripType: 'MULTI_CITY', destCountry: 'JP', destCity: 'TYO', startDate: day('2026-11-02'), endDate: day('2026-11-10'),
      travelClassId: 'TC-PEY', entitledClassId: 'TC-PEY', classBasis: 'Register C20 — Premium Economy for flights ≥ 6h',
      bookingMethod: BOOKING_METHOD.AgentAssisted,
    },
  });
  const id = req.id;
  await audit(id, 'E-TRAV', 'CREATE', `Multi-leg draft ${requestNumber} created`);
  // Per-leg entitlement: long-haul legs Premium Economy, short connecting leg Economy (AC40).
  const legs = [
    { seq: 1, o: 'SIN', d: 'HND', dep: '2026-11-02', dur: 7, ent: 'TC-PEY', nights: 5 },
    { seq: 2, o: 'HND', d: 'KIX', dep: '2026-11-07', dur: 1.5, ent: 'TC-ECO', nights: 3 },
    { seq: 3, o: 'KIX', d: 'SIN', dep: '2026-11-10', dur: 6.5, ent: 'TC-PEY', nights: 0 },
  ];
  for (const l of legs) {
    await prisma.itineraryLeg.create({ data: { requestId: id, seq: l.seq, originCode: l.o, destCode: l.d, departDate: day(l.dep), arriveDate: day(l.dep), transportMode: 'AIR', durationHours: l.dur, nights: l.nights, travelClassId: 'TC-PEY', entitledClassId: l.ent, chosenClassId: 'TC-PEY' } });
  }
  await prisma.estimatedExpense.create({ data: { requestId: id, category: EXPENSE_CATEGORY.Airfare, expenseTypeId: 'ET-AIR', currency: 'SGD', foreignAmount: 1900, sgdAmount: 1900, estimateBasis: 'QUOTED', originCode: 'SIN', destCode: 'HND', proposedClassId: 'TC-PEY', fareCeiling: 1900 } });
  // Accommodation per stay location (Tokyo & Osaka) against each city cap.
  for (const [city, nights, rate] of [['TYO', 5, 320], ['OSA', 3, 280]] as [string, number, number][]) {
    const c = computeAccommodation({ cityCode: city, nights, personalNights: 0, quotedNightly: rate, basis: settings.hotelEstimateBasis });
    const e = await prisma.estimatedExpense.create({ data: { requestId: id, category: EXPENSE_CATEGORY.Accommodation, expenseTypeId: 'ET-ACC', currency: 'SGD', foreignAmount: c.sgdAmount, sgdAmount: c.sgdAmount, estimateBasis: settings.hotelEstimateBasis } });
    await prisma.accommodationEstimate.create({ data: { expenseId: e.id, city, nights, personalNights: 0, quotedNightly: rate, capNightly: c.capNightly, budgetedNightly: c.budgetedNightly, capVariance: c.capVariance, exceptionOutcome: c.outcome } });
  }
  // ODA across Japan for the date range, excluding 1 personal day (AC42).
  const oda = computeOda({ countryCode: 'JP', arrive: day('2026-11-02'), depart: day('2026-11-10'), personalDays: 1 });
  const oe = await prisma.estimatedExpense.create({ data: { requestId: id, category: EXPENSE_CATEGORY.ODA, expenseTypeId: 'ET-ODA', currency: 'SGD', foreignAmount: oda.sgdAmount, sgdAmount: oda.sgdAmount, estimateBasis: 'RATE' } });
  await prisma.oDAEstimate.create({ data: { expenseId: oe.id, country: 'JP', city: 'TYO', arrive: day('2026-11-02'), depart: day('2026-11-10'), eligibleDays: oda.eligibleDays, personalDays: 1, dailyRate: oda.dailyRate } });
  const master = EcsCharging.code('CC-1000');
  await prisma.chargingAllocation.create({ data: { requestId: id, chargingCode: 'CC-1000', percent: 100, chargingType: master?.type ?? 'CC', companyCode: master?.companyCode, businessArea: master?.businessArea, isResearch: false, isMain: true } });
  await submit(id); await approveAll(id);
}

async function buildS15() {
  const settings = await getSettings();
  const requestNumber = await nextRequestNumber(YEAR);
  const req = await prisma.travelRequest.create({
    data: {
      requestNumber, requestorId: 'E-TRAV2', travellerId: 'E-TRAV2',
      entityId: EcsIdentity.entity().id, departmentId: 'SCH-CS', status: REQUEST_STATUS.Draft, bookingStatus: BOOKING_STATUS.NotSent,
      purposeId: 'TP-TC-ACAD', description: 'Class upgrade — Business requested, NTU-funded delta → M6 (S15)',
      destCountry: 'JP', destCity: 'TYO', startDate: day('2026-11-16'), endDate: day('2026-11-19'),
      travelClassId: 'TC-BIZ', entitledClassId: 'TC-ECO', classBasis: 'Default (not in register) → Economy',
      classJustification: 'Overnight red-eye ahead of a same-day summit; business-class rest required.',
      bookingMethod: BOOKING_METHOD.TMCOnline,
    },
  });
  const id = req.id;
  await audit(id, 'E-TRAV2', 'CREATE', `Draft ${requestNumber} created (class upgrade)`);
  for (const [seq, o, d, dep] of [[1, 'SIN', 'HND', '2026-11-16'], [2, 'HND', 'SIN', '2026-11-19']] as [number, string, string, string][]) {
    await prisma.itineraryLeg.create({ data: { requestId: id, seq, originCode: o, destCode: d, departDate: day(dep), arriveDate: day(dep), transportMode: 'AIR', durationHours: 7, nights: seq === 1 ? 3 : 0, travelClassId: 'TC-BIZ', entitledClassId: 'TC-ECO', chosenClassId: 'TC-BIZ' } });
  }
  // #7/#14 NTU-funded upgrade: Business 3800, Economy entitlement derived via the ECO→BIZ uplift %; the delta charges the BA-CS M6 account.
  await prisma.estimatedExpense.create({ data: { requestId: id, category: EXPENSE_CATEGORY.Airfare, expenseTypeId: 'ET-AIR', currency: 'SGD', foreignAmount: 3800, sgdAmount: 3800, estimateBasis: 'QUOTED', originCode: 'SIN', destCode: 'HND', proposedClassId: 'TC-BIZ', fareCeiling: 3800, ...(await upgradeLineFields(3800, 'TC-ECO', 'TC-BIZ', 'NTU', 'BA-CS')) } });
  const c = computeAccommodation({ cityCode: 'TYO', nights: 3, personalNights: 0, quotedNightly: 300, basis: settings.hotelEstimateBasis });
  const e = await prisma.estimatedExpense.create({ data: { requestId: id, category: EXPENSE_CATEGORY.Accommodation, expenseTypeId: 'ET-ACC', currency: 'SGD', foreignAmount: c.sgdAmount, sgdAmount: c.sgdAmount, estimateBasis: settings.hotelEstimateBasis } });
  await prisma.accommodationEstimate.create({ data: { expenseId: e.id, city: 'TYO', nights: 3, personalNights: 0, quotedNightly: 300, capNightly: c.capNightly, budgetedNightly: c.budgetedNightly, capVariance: c.capVariance, exceptionOutcome: c.outcome } });
  const master = EcsCharging.code('CC-1000');
  await prisma.chargingAllocation.create({ data: { requestId: id, chargingCode: 'CC-1000', percent: 100, chargingType: master?.type ?? 'CC', companyCode: master?.companyCode, businessArea: master?.businessArea, isResearch: false, isMain: true } });
  await submit(id); // routes through exception approval; left pending to show the route
}

/** S15b — #7 self-funded class upgrade: Business requested, the traveller pays the TMC the delta
 *  directly, so NTU is charged the Economy entitlement only (the delta is not reimbursed). */
async function buildS15b() {
  const settings = await getSettings();
  const requestNumber = await nextRequestNumber(YEAR);
  const req = await prisma.travelRequest.create({
    data: {
      requestNumber, requestorId: 'E-TRAV4', travellerId: 'E-TRAV4',
      entityId: EcsIdentity.entity().id, departmentId: 'SCH-CS', status: REQUEST_STATUS.Draft, bookingStatus: BOOKING_STATUS.NotSent,
      purposeId: 'TP-TC-ACAD', description: 'Class upgrade — Business requested, self-funded delta (S15b)',
      destCountry: 'JP', destCity: 'TYO', startDate: day('2026-12-01'), endDate: day('2026-12-04'),
      travelClassId: 'TC-BIZ', entitledClassId: 'TC-ECO', classBasis: 'Default (not in register) → Economy',
      classJustification: 'Personal preference — traveller self-funds the upgrade above the Economy entitlement.',
      bookingMethod: BOOKING_METHOD.TMCOnline,
    },
  });
  const id = req.id;
  await audit(id, 'E-TRAV4', 'CREATE', `Draft ${requestNumber} created (self-funded class upgrade)`);
  for (const [seq, o, d, dep] of [[1, 'SIN', 'HND', '2026-12-01'], [2, 'HND', 'SIN', '2026-12-04']] as [number, string, string, string][]) {
    await prisma.itineraryLeg.create({ data: { requestId: id, seq, originCode: o, destCode: d, departDate: day(dep), arriveDate: day(dep), transportMode: 'AIR', durationHours: 7, nights: seq === 1 ? 3 : 0, travelClassId: 'TC-BIZ', entitledClassId: 'TC-ECO', chosenClassId: 'TC-BIZ' } });
  }
  // #7 self-funded: Business 3800, Economy entitlement derived; the traveller pays the TMC the delta directly (no M6).
  await prisma.estimatedExpense.create({ data: { requestId: id, category: EXPENSE_CATEGORY.Airfare, expenseTypeId: 'ET-AIR', currency: 'SGD', foreignAmount: 3800, sgdAmount: 3800, estimateBasis: 'QUOTED', originCode: 'SIN', destCode: 'HND', proposedClassId: 'TC-BIZ', fareCeiling: 3800, ...(await upgradeLineFields(3800, 'TC-ECO', 'TC-BIZ', 'SELF', 'BA-CS')) } });
  const c = computeAccommodation({ cityCode: 'TYO', nights: 3, personalNights: 0, quotedNightly: 300, basis: settings.hotelEstimateBasis });
  const e = await prisma.estimatedExpense.create({ data: { requestId: id, category: EXPENSE_CATEGORY.Accommodation, expenseTypeId: 'ET-ACC', currency: 'SGD', foreignAmount: c.sgdAmount, sgdAmount: c.sgdAmount, estimateBasis: settings.hotelEstimateBasis } });
  await prisma.accommodationEstimate.create({ data: { expenseId: e.id, city: 'TYO', nights: 3, personalNights: 0, quotedNightly: 300, capNightly: c.capNightly, budgetedNightly: c.budgetedNightly, capVariance: c.capVariance, exceptionOutcome: c.outcome } });
  const master = EcsCharging.code('CC-1000');
  await prisma.chargingAllocation.create({ data: { requestId: id, chargingCode: 'CC-1000', percent: 100, chargingType: master?.type ?? 'CC', companyCode: master?.companyCode, businessArea: master?.businessArea, isResearch: false, isMain: true } });
  await submit(id);
}

/** S35 — #14 booked NTU-funded upgrade: approved + booked, so the CTA airfare posts SPLIT — the
 *  entitlement charges the original cost centre and the upgrade differential charges M6. */
async function buildS35() {
  const settings = await getSettings();
  const requestNumber = await nextRequestNumber(YEAR);
  const req = await prisma.travelRequest.create({
    data: {
      requestNumber, requestorId: 'E-TRAV4', travellerId: 'E-TRAV4',
      entityId: EcsIdentity.entity().id, departmentId: 'SCH-CS', status: REQUEST_STATUS.Draft, bookingStatus: BOOKING_STATUS.NotSent,
      purposeId: 'TP-TC-ACAD', description: 'Booked NTU-funded upgrade — CTA airfare split entitlement → CC, delta → M6 (S35)',
      destCountry: 'GB', destCity: 'LON', startDate: day('2026-12-08'), endDate: day('2026-12-11'),
      travelClassId: 'TC-BIZ', entitledClassId: 'TC-ECO', classBasis: 'Default (not in register) → Economy',
      classJustification: 'Overnight long-haul ahead of a same-day board meeting; NTU-funded upgrade to M6.',
      bookingMethod: BOOKING_METHOD.TMCOnline,
    },
  });
  const id = req.id;
  await audit(id, 'E-TRAV4', 'CREATE', `Draft ${requestNumber} created (booked NTU-funded upgrade)`);
  for (const [seq, o, d, dep] of [[1, 'SIN', 'LHR', '2026-12-08'], [2, 'LHR', 'SIN', '2026-12-11']] as [number, string, string, string][]) {
    await prisma.itineraryLeg.create({ data: { requestId: id, seq, originCode: o, destCode: d, departDate: day(dep), arriveDate: day(dep), transportMode: 'AIR', durationHours: 13, nights: seq === 1 ? 3 : 0, travelClassId: 'TC-BIZ', entitledClassId: 'TC-ECO', chosenClassId: 'TC-BIZ' } });
  }
  // #14 NTU-funded: Business 3800, Economy entitlement derived; the delta charges the BA-CS M6 account on posting.
  await prisma.estimatedExpense.create({ data: { requestId: id, category: EXPENSE_CATEGORY.Airfare, expenseTypeId: 'ET-AIR', currency: 'SGD', foreignAmount: 3800, sgdAmount: 3800, estimateBasis: 'QUOTED', originCode: 'SIN', destCode: 'LHR', proposedClassId: 'TC-BIZ', fareCeiling: 3800, ...(await upgradeLineFields(3800, 'TC-ECO', 'TC-BIZ', 'NTU', 'BA-CS')) } });
  const c = computeAccommodation({ cityCode: 'LON', nights: 3, personalNights: 0, quotedNightly: 260, basis: settings.hotelEstimateBasis });
  const e = await prisma.estimatedExpense.create({ data: { requestId: id, category: EXPENSE_CATEGORY.Accommodation, expenseTypeId: 'ET-ACC', currency: 'SGD', foreignAmount: c.sgdAmount, sgdAmount: c.sgdAmount, estimateBasis: settings.hotelEstimateBasis } });
  await prisma.accommodationEstimate.create({ data: { expenseId: e.id, city: 'LON', nights: 3, personalNights: 0, quotedNightly: 260, capNightly: c.capNightly, budgetedNightly: c.budgetedNightly, capVariance: c.capVariance, exceptionOutcome: c.outcome } });
  const master = EcsCharging.code('CC-1000');
  await prisma.chargingAllocation.create({ data: { requestId: id, chargingCode: 'CC-1000', percent: 100, chargingType: master?.type ?? 'CC', companyCode: master?.companyCode, businessArea: master?.businessArea, isResearch: false, isMain: true } });
  await submit(id); await approveAll(id); await bookViaTmc(id);
}

/** Build a Tokyo group draft (airfare & ODA individual; hotel shared; 60/40 charging). */
async function buildGroupDraft(desc: string, start: string, end: string): Promise<string> {
  const travellerIds = ['E-TRAV', 'E-TRAV2', 'E-TRAV3'];
  const requestNumber = await nextRequestNumber(YEAR);
  const req = await prisma.travelRequest.create({
    data: {
      requestNumber, requestorId: 'E-PA', travellerId: 'E-TRAV', isGroup: true,
      entityId: EcsIdentity.entity().id, departmentId: 'SCH-CS', status: REQUEST_STATUS.Draft, bookingStatus: BOOKING_STATUS.NotSent,
      purposeId: 'TP-TC-ACAD', description: desc,
      destCountry: 'JP', destCity: 'TYO', startDate: day(start), endDate: day(end),
      travelClassId: 'TC-ECO', bookingMethod: BOOKING_METHOD.AgentAssisted,
      travellers: { create: travellerIds.map((eid) => ({ employeeId: eid, isRequestor: false, confirmed: false, sharePct: Math.round((100 / travellerIds.length) * 100) / 100 })) },
    },
  });
  const id = req.id;
  await audit(id, 'E-PA', 'CREATE', `Group draft ${requestNumber} created for ${travellerIds.length} travellers`);
  await prisma.itineraryLeg.create({ data: { requestId: id, seq: 1, originCode: 'SIN', destCode: 'HND', departDate: day(start), durationHours: 7, travelClassId: 'TC-ECO' } });
  await prisma.itineraryLeg.create({ data: { requestId: id, seq: 2, originCode: 'HND', destCode: 'SIN', departDate: day(end), durationHours: 0, travelClassId: 'TC-ECO' } });
  // §13.14 group travel books each traveller at their OWN entitled class for this itinerary.
  for (const eid of travellerIds) {
    const ent = EcsTravelClassRegister.entitledForItinerary(eid, [{ durationHours: 7, destCode: 'TYO' }], day(start));
    await prisma.travelRequestTraveller.updateMany({ where: { requestId: id, employeeId: eid }, data: { entitledClassId: ent.classId, chosenClassId: ent.classId } });
  }

  for (const tid of travellerIds) {
    await prisma.estimatedExpense.create({ data: { requestId: id, travellerId: tid, category: EXPENSE_CATEGORY.Airfare, expenseTypeId: 'ET-AIR', currency: 'SGD', foreignAmount: 1250, sgdAmount: 1250, estimateBasis: 'QUOTED', originCode: 'SIN', destCode: 'HND', proposedClassId: 'TC-ECO', fareCeiling: 1250 } });
    const oda = computeOda({ countryCode: 'JP', arrive: day(start), depart: day(end), personalDays: 0 });
    const oe = await prisma.estimatedExpense.create({ data: { requestId: id, travellerId: tid, category: EXPENSE_CATEGORY.ODA, expenseTypeId: 'ET-ODA', currency: 'SGD', foreignAmount: oda.sgdAmount, sgdAmount: oda.sgdAmount, estimateBasis: 'RATE' } });
    await prisma.oDAEstimate.create({ data: { expenseId: oe.id, country: 'JP', city: 'TYO', arrive: day(start), depart: day(end), eligibleDays: oda.eligibleDays, personalDays: 0, dailyRate: oda.dailyRate } });
  }
  const settings = await getSettings();
  const hcalc = computeAccommodation({ cityCode: 'TYO', nights: 4, personalNights: 0, quotedNightly: 330, basis: settings.hotelEstimateBasis });
  // §13.14 accommodation is per-traveller — each books/pays/claims their own room (one line each).
  for (const tid of travellerIds) {
    const he = await prisma.estimatedExpense.create({ data: { requestId: id, travellerId: tid, category: EXPENSE_CATEGORY.Accommodation, expenseTypeId: 'ET-ACC', currency: 'SGD', foreignAmount: hcalc.sgdAmount, sgdAmount: hcalc.sgdAmount, estimateBasis: settings.hotelEstimateBasis } });
    await prisma.accommodationEstimate.create({ data: { expenseId: he.id, city: 'TYO', nights: 4, personalNights: 0, quotedNightly: 330, capNightly: hcalc.capNightly, budgetedNightly: hcalc.budgetedNightly, capVariance: hcalc.capVariance, exceptionOutcome: hcalc.outcome } });
  }

  await prisma.travelRequest.update({ where: { id }, data: { chargingMode: 'CLAIM' } });
  for (const [code, pct] of [['CC-1000', 60], ['CC-2000', 40]] as [string, number][]) {
    const master = EcsCharging.code(code);
    await prisma.chargingAllocation.create({ data: { requestId: id, chargingCode: code, percent: pct, chargingType: master?.type ?? 'CC', companyCode: master?.companyCode, businessArea: master?.businessArea, isResearch: master?.isResearch ?? false, isMain: code === 'CC-1000' } });
  }
  return id;
}

async function buildGroupS11() {
  const id = await buildGroupDraft('Group conference trip — three travellers (S11)', '2026-11-09', '2026-11-13');
  await submit(id);
  await approveAll(id);
}

// S12 — group amendment (§13.16): an approved & confirmed group loses a traveller
// before travel; the request re-derives the route, restarts reapproval and recalculates
// the remaining shares.
async function buildGroupS12() {
  const id = await buildGroupDraft('Group amendment — one traveller withdraws (S12)', '2026-12-07', '2026-12-11');
  await submit(id);
  // confirm all travellers up front so the first approval fully authorises the trip
  await prisma.travelRequestTraveller.updateMany({ where: { requestId: id }, data: { confirmed: true, confirmedAt: new Date() } });
  await approveAll(id); // RO + DOA approve and, with all confirmed, the TA is issued
  // Now Dr Henry Ong withdraws before travel — a material amendment.
  const row = await prisma.travelRequestTraveller.findFirst({ where: { requestId: id, employeeId: 'E-TRAV3' } });
  if (row) {
    await prisma.estimatedExpense.deleteMany({ where: { requestId: id, travellerId: 'E-TRAV3' } });
    await prisma.travelRequestTraveller.delete({ where: { id: row.id } });
    await audit(id, 'E-PA', 'AMEND', 'Traveller Dr Henry Ong withdrew before travel; share released');
    await applyMaterialAmendment(id, 'traveller removed (Dr Henry Ong)');
  }
}
