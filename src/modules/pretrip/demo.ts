'use server';
// Seeds the §8.1 / §12.1 demonstration scenarios end-to-end using the real business
// logic (pricing, policy, route, TMC adapter, TE pre-population), so every scenario
// runs without manual setup (§13.7). Triggered from the dashboard.
import { revalidatePath } from 'next/cache';
import { prisma } from '@/shared/db';
import { loadRequest, type FullRequest } from './queries';
import { getSettings } from './settings';
import { nextRequestNumber, nextAuthorisationNumber, nextClaimNumber } from './numbering';
import { computeAccommodation, computeOda, computeSummary } from './pricing';
import { evaluatePolicies, hasException } from './policy';
import { buildRoute, statusForStep } from './route';
import { allTravellersConfirmed, sharedLegs } from './group';
import { applyMaterialAmendment } from './amend';
import { EcsFx, EcsIdentity, EcsCharging, EcsReference } from '@/shared/ecs/services';
import { prepopulateClaim } from '@/modules/te/prepopulate';
import { buildOutbound, simulateInbound } from '@/integrations/tmc/adapter';
import { REQUEST_STATUS, BOOKING_STATUS, EXPENSE_CATEGORY, POLICY_OUTCOME, BOOKING_METHOD } from '@/shared/enums';

const YEAR = 2026;
const day = (iso: string) => new Date(iso + 'T00:00:00Z');

interface Charge { code: string; pct: number }
interface ScenarioInput {
  requestorId: string; travellerId: string; purposeId: string; isResearch: boolean;
  destCountry: string; destCity: string; destAirport: string; start: string; end: string;
  personalStart?: string; personalEnd?: string; travelClassId: string; bookingMethod: string;
  airfare: { amount: number; currency: string; classId: string; sponsorship?: number };
  hotel?: { city: string; nights: number; personalNights?: number; quotedNightly: number };
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
    const exp = await prisma.estimatedExpense.create({ data: { requestId: id, category: EXPENSE_CATEGORY.Accommodation, expenseTypeId: 'ET-ACC', currency: 'SGD', foreignAmount: calc.sgdAmount, sgdAmount: calc.sgdAmount, estimateBasis: settings.hotelEstimateBasis } });
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

async function submit(id: string): Promise<FullRequest> {
  const settings = await getSettings();
  let req = await loadRequest(id);
  if (!req) throw new Error('missing');
  const checks = evaluatePolicies(req, settings.approvalAmountBasis);
  await prisma.policyCheck.deleteMany({ where: { requestId: id } });
  for (const c of checks) await prisma.policyCheck.create({ data: { requestId: id, code: c.code, label: c.label, outcome: c.outcome, detail: c.detail, travellerId: c.travellerId ?? null } });
  const summary = computeSummary(req.expenses, settings.approvalAmountBasis);
  await prisma.travelRequest.update({ where: { id }, data: { approvalAmountSgd: summary.approvalAmount } });
  req = await loadRequest(id);
  const steps = buildRoute(req!, { exceptionApproverRequired: settings.exceptionApproverRequired, sameRouteResearch: settings.sameRouteResearch, approvalAmount: summary.approvalAmount, hasException: hasException(checks), crossBaThresholdSgd: settings.crossBaThresholdSgd });
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
    } else if (req.isGroup && !allTravellersConfirmed(req)) {
      // §13.13 hold for traveller confirmations before issuing the authorisation.
      await prisma.travelRequest.update({ where: { id }, data: { status: REQUEST_STATUS.PendingConfirmation } });
      await audit(id, 'E-SYS', 'STATUS', 'Approvals complete — held pending traveller confirmations');
      break;
    } else {
      await finaliseApproval(id);
    }
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

async function bookViaTmc(id: string, overFarePct = 0) {
  const req = await loadRequest(id);
  if (!req) return;
  const acc = req.expenses.filter((e) => e.category === EXPENSE_CATEGORY.Accommodation && e.accommodation).map((e) => ({ city: e.accommodation!.city, nights: e.accommodation!.nights, cappedNightlySgd: e.accommodation!.budgetedNightly }));
  const ceiling = req.expenses.filter((e) => e.category === EXPENSE_CATEGORY.Airfare || e.category === EXPENSE_CATEGORY.Accommodation).reduce((s, e) => s + e.sgdAmount, 0);
  const exceptions = req.policyChecks.filter((c) => c.outcome === POLICY_OUTCOME.Exception).map((c) => c.label);
  const outbound = buildOutbound({ authorisationNo: req.authorisationNo, travellerId: req.travellerId, travellers: req.travellers, bookingMethod: req.bookingMethod, bookingDeadline: req.bookingDeadline, approvedCostCeilingSgd: ceiling, approvedExceptions: exceptions, legs: sharedLegs(req), accommodation: acc });
  await prisma.integrationMessage.create({ data: { requestId: id, direction: 'OUTBOUND', kind: 'TMC_HANDOFF', payload: JSON.stringify(outbound, null, 2) } });
  const inbound = simulateInbound(outbound, { overFarePct });
  await prisma.integrationMessage.create({ data: { requestId: id, direction: 'INBOUND', kind: 'TMC_RESPONSE', payload: JSON.stringify(inbound, null, 2) } });
  const booking = await prisma.travelBooking.create({ data: { requestId: id, pnr: inbound.pnr, ticketNo: inbound.ticketNumbers[0], channel: 'TMC', fare: inbound.fareSgd, taxes: inbound.taxesSgd, fees: inbound.feesSgd, hotelRate: inbound.segments.find((x) => x.type === 'HOTEL')?.roomRateSgd, status: inbound.bookingStatus } });
  for (const seg of inbound.segments) await prisma.bookingSegment.create({ data: { bookingId: booking.id, type: seg.type, originCode: seg.origin, destCode: seg.destination, bookedClassId: seg.bookedClass, amount: seg.amountSgd ?? seg.roomRateSgd } });
  await prisma.travelRequest.update({ where: { id }, data: { bookingStatus: BOOKING_STATUS.Booked } });
  await audit(id, 'E-SYS', 'INTEGRATION', `Inbound booking received — PNR ${inbound.pnr}`);
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
    hotel: { city: 'TYO', nights: 3, quotedNightly: 450 },
    oda: { country: 'JP', city: 'TYO', arrive: '2026-10-05', depart: '2026-10-08' },
    charging: [{ code: 'CC-1000', pct: 100 }],
  });
  await submit(s03);

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

  // S11 — group conference trip (§13.16): PA raises for three travellers from two
  // departments to Tokyo; hotel shared, airfare & ODA individual; charging split 60/40.
  await buildGroupS11();

  // S12 — group amendment: an approved group loses a traveller → reapproval (§13.16).
  await buildGroupS12();

  // S14 — multi-leg trip (§13.20): SIN → Tokyo (5n) → Osaka (3n) → SIN, 1 personal day.
  await buildS14();

  // S15 — class upgrade exception (§13.19): Economy entitlement, Business requested.
  await buildS15();

  revalidatePath('/dashboard');
}

async function buildS14() {
  const settings = await getSettings();
  const requestNumber = await nextRequestNumber(YEAR);
  const req = await prisma.travelRequest.create({
    data: {
      requestNumber, requestorId: 'E-TRAV', travellerId: 'E-TRAV',
      entityId: EcsIdentity.entity().id, departmentId: 'SCH-CS', status: REQUEST_STATUS.Draft, bookingStatus: BOOKING_STATUS.NotSent,
      purposeId: 'TP-TC-ACAD', description: 'Multi-leg trip — Tokyo & Osaka (S14)',
      destCountry: 'JP', destCity: 'TYO', startDate: day('2026-11-02'), endDate: day('2026-11-10'),
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
      purposeId: 'TP-TC-ACAD', description: 'Class upgrade exception — Business requested (S15)',
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
  await prisma.estimatedExpense.create({ data: { requestId: id, category: EXPENSE_CATEGORY.Airfare, expenseTypeId: 'ET-AIR', currency: 'SGD', foreignAmount: 3800, sgdAmount: 3800, estimateBasis: 'QUOTED', originCode: 'SIN', destCode: 'HND', proposedClassId: 'TC-BIZ', fareCeiling: 3800 } });
  const c = computeAccommodation({ cityCode: 'TYO', nights: 3, personalNights: 0, quotedNightly: 300, basis: settings.hotelEstimateBasis });
  const e = await prisma.estimatedExpense.create({ data: { requestId: id, category: EXPENSE_CATEGORY.Accommodation, expenseTypeId: 'ET-ACC', currency: 'SGD', foreignAmount: c.sgdAmount, sgdAmount: c.sgdAmount, estimateBasis: settings.hotelEstimateBasis } });
  await prisma.accommodationEstimate.create({ data: { expenseId: e.id, city: 'TYO', nights: 3, personalNights: 0, quotedNightly: 300, capNightly: c.capNightly, budgetedNightly: c.budgetedNightly, capVariance: c.capVariance, exceptionOutcome: c.outcome } });
  const master = EcsCharging.code('CC-1000');
  await prisma.chargingAllocation.create({ data: { requestId: id, chargingCode: 'CC-1000', percent: 100, chargingType: master?.type ?? 'CC', companyCode: master?.companyCode, businessArea: master?.businessArea, isResearch: false, isMain: true } });
  await submit(id); // routes through exception approval; left pending to show the route
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
  await prisma.itineraryLeg.create({ data: { requestId: id, seq: 1, originCode: 'SIN', destCode: 'HND', departDate: day(start), travelClassId: 'TC-ECO' } });
  await prisma.itineraryLeg.create({ data: { requestId: id, seq: 2, originCode: 'HND', destCode: 'SIN', departDate: day(end), travelClassId: 'TC-ECO' } });

  for (const tid of travellerIds) {
    await prisma.estimatedExpense.create({ data: { requestId: id, travellerId: tid, category: EXPENSE_CATEGORY.Airfare, expenseTypeId: 'ET-AIR', currency: 'SGD', foreignAmount: 1250, sgdAmount: 1250, estimateBasis: 'QUOTED', originCode: 'SIN', destCode: 'HND', proposedClassId: 'TC-ECO', fareCeiling: 1250 } });
    const oda = computeOda({ countryCode: 'JP', arrive: day(start), depart: day(end), personalDays: 0 });
    const oe = await prisma.estimatedExpense.create({ data: { requestId: id, travellerId: tid, category: EXPENSE_CATEGORY.ODA, expenseTypeId: 'ET-ODA', currency: 'SGD', foreignAmount: oda.sgdAmount, sgdAmount: oda.sgdAmount, estimateBasis: 'RATE' } });
    await prisma.oDAEstimate.create({ data: { expenseId: oe.id, country: 'JP', city: 'TYO', arrive: day(start), depart: day(end), eligibleDays: oda.eligibleDays, personalDays: 0, dailyRate: oda.dailyRate } });
  }
  const settings = await getSettings();
  const hcalc = computeAccommodation({ cityCode: 'TYO', nights: 4, personalNights: 0, quotedNightly: 330, basis: settings.hotelEstimateBasis });
  const sharedAmount = hcalc.sgdAmount * travellerIds.length; // rooms budgeted at the cap
  const he = await prisma.estimatedExpense.create({ data: { requestId: id, isShared: true, category: EXPENSE_CATEGORY.Accommodation, expenseTypeId: 'ET-ACC', currency: 'SGD', foreignAmount: sharedAmount, sgdAmount: sharedAmount, estimateBasis: settings.hotelEstimateBasis } });
  await prisma.accommodationEstimate.create({ data: { expenseId: he.id, city: 'TYO', nights: 4, personalNights: 0, quotedNightly: 330, capNightly: hcalc.capNightly, budgetedNightly: hcalc.budgetedNightly, capVariance: hcalc.capVariance, exceptionOutcome: hcalc.outcome } });

  await prisma.travelRequest.update({ where: { id }, data: { chargingMode: 'CLAIM' } });
  for (const [code, pct] of [['CC-1000', 60], ['CC-2000', 40]] as [string, number][]) {
    const master = EcsCharging.code(code);
    await prisma.chargingAllocation.create({ data: { requestId: id, chargingCode: code, percent: pct, chargingType: master?.type ?? 'CC', companyCode: master?.companyCode, businessArea: master?.businessArea, isResearch: master?.isResearch ?? false, isMain: code === 'CC-1000' } });
  }
  return id;
}

// S11 — group conference trip: approved by the 60%-department DOA, then held Pending
// Traveller Confirmation until all three confirm (§13.13).
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
