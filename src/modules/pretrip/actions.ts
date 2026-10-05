'use server';
// Server actions for the Travel Request lifecycle (§6.1 standard workflow, §13.1
// status model). This is the transactional core; reference config is reached only
// through the mock ECS services. Only async functions are exported (Next.js
// 'use server' rule) — internal helpers are module-private.
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { prisma } from '@/shared/db';
import { currentPersonaId } from '@/shared/session';
import { loadRequest, overlappingTripsFor, type FullRequest } from './queries';
import { getSettings } from './settings';
import { nextRequestNumber, nextAuthorisationNumber } from './numbering';
import { computeSummary, computeAccommodation, computeOda } from './pricing';
import { evaluatePolicies, hasHardStop, hasException } from './policy';
import { buildRoute, statusForStep } from './route';
import { sharedLegs, travellerNightsAtCity, computeTravellerShares } from './group';
import { applyMaterialAmendment, isFreeEditState, isAmendableState } from './amend';
import { EcsIdentity, EcsReference, EcsFx, EcsPolicy, EcsCharging, EcsTravelClassRegister } from '@/shared/ecs/services';
import { REQUEST_STATUS, BOOKING_STATUS, TMC_INFLIGHT_STATUSES, EXPENSE_CATEGORY, APPROVER_ROLE, BOOKING_METHOD, BOOKING_ARRANGEMENT, POLICY_OUTCOME } from '@/shared/enums';
import { isTmcArrangement, providerFromArrangement } from './booking';
import { GUEST_TRAVELLER_ID, travellerName } from './traveller';
import { ruleActive } from '@/config/policyRules';
import { isHighRisk, highRiskDestinationsForRequest } from './risk';
import { visaLetterRecipientFor } from '@/config/visaLetter';
import { randomUUID } from 'node:crypto';
import { adapterFor } from '@/integrations/tmc/adapter';
import { assembleOutboundInstructions } from './tmcPayload';
import { buildSapAirfarePosting } from '@/integrations/sap/posting';
import { resolveTmcProvider } from './tmcRouting';
import { resolveChargingRows } from './chargingRollup';
import { tmcProvider } from '@/data/tmcProviders';
import { getContractSettings, tmcEnabledSet, getGuardSettings, evaluateFlow } from './integration';
import { CONTRACT_VERSION } from '@/config/integrationContracts';
import { actionAllowed, canActOnStep, canCreateFor, canEditRequest } from './guards';

const yr = () => new Date().getFullYear(); // §13.3 numbering year derived from the clock

/* ------------------------------------------------------------------ helpers */
async function audit(requestId: string | null, kind: string, summary: string, onBehalfOf?: string | null) {
  const actorId = await currentPersonaId();
  await prisma.auditEvent.create({ data: { requestId, actorId, onBehalfOf: onBehalfOf ?? null, kind, summary } });
}

async function snapshot(req: FullRequest, reason: string, approved: boolean) {
  await prisma.travelRequestVersion.create({
    data: {
      requestId: req.id,
      version: req.currentVersion + 1,
      reason,
      approved,
      snapshot: JSON.stringify({
        header: { requestNumber: req.requestNumber, purposeId: req.purposeId, destCountry: req.destCountry, destCity: req.destCity, startDate: req.startDate, endDate: req.endDate, travelClassId: req.travelClassId, bookingMethod: req.bookingMethod },
        expenses: req.expenses,
        allocations: req.allocations,
        approvalAmountSgd: req.approvalAmountSgd,
      }),
    },
  });
  await prisma.travelRequest.update({ where: { id: req.id }, data: { currentVersion: req.currentVersion + 1 } });
}

async function persistPolicy(id: string): Promise<{ hardStop: boolean; exception: boolean }> {
  const req = await loadRequest(id);
  if (!req) return { hardStop: false, exception: false };
  const settings = await getSettings();
  const checks = evaluatePolicies(req, settings.approvalAmountBasis);

  // §25/§40 duplicate / overlapping-trip check — evaluated here (not in the pure engine)
  // because it must look across sibling requests. A guest has no cross-request identity.
  const fmt = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : '—');
  const travellerIds = (req.isGroup ? req.travellers.map((t) => t.employeeId) : [req.travellerId]).filter((e) => e !== GUEST_TRAVELLER_ID);
  const overlaps = ruleActive('DUPLICATE') ? await overlappingTripsFor(travellerIds, req.startDate, req.endDate, req.id) : [];
  for (const o of overlaps) {
    const names = o.who.map((e) => EcsIdentity.employee(e)?.name ?? e).join(', ');
    checks.push({
      code: 'DUPLICATE', label: 'Overlapping trip', outcome: POLICY_OUTCOME.Warning,
      detail: `${names} already on ${o.request.requestNumber} (${fmt(o.request.startDate)} → ${fmt(o.request.endDate)}, ${o.request.status}). Confirm this is not a duplicate.`,
      travellerId: req.isGroup ? (o.who[0] ?? null) : null,
    });
  }

  await prisma.policyCheck.deleteMany({ where: { requestId: id } });
  for (const c of checks) {
    await prisma.policyCheck.create({ data: { requestId: id, code: c.code, label: c.label, outcome: c.outcome, detail: c.detail, travellerId: c.travellerId ?? null } });
  }
  return { hardStop: hasHardStop(checks), exception: hasException(checks) };
}

/** Issue (or retain) the Travel Authorisation Number and set validity on final
 *  approval (§13.3). On amendment reapproval the existing TA is retained (AC19). */
async function finalizeApproval(id: string) {
  const req = await loadRequest(id);
  if (!req) return;
  const settings = await getSettings();
  const reapproval = !!req.authorisationNo;
  const authNo = req.authorisationNo ?? (await nextAuthorisationNumber(yr()));
  const bookingDeadline = req.startDate ? new Date(req.startDate.getTime() - settings.bookingDeadlineDays * 86400000) : null;
  const expiry = req.endDate ? new Date(req.endDate.getTime() + settings.authorisationValidityDays * 86400000) : null;
  await prisma.travelRequest.update({ where: { id }, data: { status: REQUEST_STATUS.Approved, authorisationNo: authNo, bookingDeadline, authorisationExpiry: expiry } });
  const approved = await loadRequest(id);
  if (approved) await snapshot(approved, 'APPROVAL', true);
  await audit(id, 'STATUS', reapproval ? `Amendment reapproved — Travel Authorisation ${authNo} retained` : `Final approval — Travel Authorisation ${authNo} issued`);
}

/** §13.4 Re-convert foreign-currency estimate lines to the SGD rate effective on
 * `onDate` and persist, locking the SGD value at submission. SGD lines (accommodation,
 * ODA, SGD airfare) are left untouched. Returns the number of lines changed. */
async function relockFx(req: FullRequest, onDate: Date): Promise<number> {
  let changed = 0;
  for (const e of req.expenses) {
    if (!e.currency || e.currency === 'SGD' || e.foreignAmount == null) continue;
    const rate = EcsFx.sgdPerUnit(e.currency, onDate);
    const sgd = Math.round(e.foreignAmount * rate * 100) / 100;
    const data: { sgdAmount: number; sponsorSgd?: number } = { sgdAmount: sgd };
    if (e.sponsorForeign != null) data.sponsorSgd = Math.round(e.sponsorForeign * rate * 100) / 100;
    if (sgd !== e.sgdAmount || (data.sponsorSgd != null && data.sponsorSgd !== e.sponsorSgd)) {
      await prisma.estimatedExpense.update({ where: { id: e.id }, data });
      changed++;
    }
  }
  return changed;
}

/** §38 field-level audit helper — given [label, before, after] triples, return
 *  "Label: before → after" for each field whose value actually changed. */
function fieldDiffs(fields: [string, string, string][]): string[] {
  return fields.filter(([, a, b]) => a !== b).map(([label, a, b]) => `${label}: ${a} → ${b}`);
}

/** Edit-authority gate for the draft-edit mutations (trip, estimates, charging, submit).
 *  Returns false and logs when the acting persona may not edit this request. */
async function requireEdit(id: string): Promise<boolean> {
  const persona = await currentPersonaId();
  const req = await loadRequest(id);
  if (!req) return false;
  if (!canEditRequest(persona, req)) {
    await audit(id, 'STATUS', `Edit blocked — ${EcsIdentity.employee(persona)?.name ?? persona} is not authorised to edit this request`);
    return false;
  }
  return true;
}

function str(fd: FormData, k: string): string { return (fd.get(k) as string | null)?.trim() ?? ''; }
function num(fd: FormData, k: string): number { const v = parseFloat(str(fd, k)); return isNaN(v) ? 0 : v; }
function dateOrNull(fd: FormData, k: string): Date | null { const v = str(fd, k); return v ? new Date(v) : null; }

/* ------------------------------------------------------------- create (TR-02) */
export async function createDraft(fd: FormData) {
  const requestorId = await currentPersonaId();
  const travellerId = str(fd, 'travellerId') || requestorId;
  // §13.13 server-side authority check — don't trust the posted traveller id.
  if (!canCreateFor(requestorId, travellerId)) return;
  const traveller = EcsIdentity.employee(travellerId);
  const requestNumber = await nextRequestNumber(yr());
  const req = await prisma.travelRequest.create({
    data: {
      requestNumber,
      requestorId,
      travellerId,
      entityId: EcsIdentity.entity().id,
      departmentId: traveller?.departmentId,
      status: REQUEST_STATUS.Draft,
      bookingStatus: BOOKING_STATUS.NotSent,
    },
  });
  await audit(req.id, 'CREATE', `Draft ${requestNumber} created for ${traveller?.name ?? travellerId}`, requestorId !== travellerId ? travellerId : null);
  redirect(`/requests/${req.id}/trip`);
}

/** §8 Create a guest / non-employee travel request (AC7). The host (requestor) is an
 *  employee; the guest has no ECS/HR profile, so their identity is captured here and the
 *  trip is charged to the host's department. */
export async function createGuestDraft(fd: FormData) {
  const requestorId = await currentPersonaId();
  const host = EcsIdentity.employee(requestorId);
  const guestName = str(fd, 'guestName');
  if (!guestName) return; // a guest must at least be named
  const requestNumber = await nextRequestNumber(yr());
  const req = await prisma.travelRequest.create({
    data: {
      requestNumber,
      requestorId,
      travellerId: GUEST_TRAVELLER_ID,
      travellerType: 'GUEST',
      guestName,
      guestEmail: str(fd, 'guestEmail') || null,
      guestOrg: str(fd, 'guestOrg') || null,
      entityId: EcsIdentity.entity().id,
      departmentId: host?.departmentId,
      status: REQUEST_STATUS.Draft,
      bookingStatus: BOOKING_STATUS.NotSent,
    },
  });
  await audit(req.id, 'CREATE', `Guest travel draft ${requestNumber} created for ${guestName}${str(fd, 'guestOrg') ? ` (${str(fd, 'guestOrg')})` : ''}`, null);
  redirect(`/requests/${req.id}/trip`);
}

/* ------------------------------------------------------------- trip (TR-04) */
export async function saveTrip(id: string, fd: FormData) {
  if (!(await requireEdit(id))) return;
  const purposeId = str(fd, 'purposeId');
  const purpose = EcsReference.travelPurpose(purposeId);
  const req0 = await loadRequest(id);
  const destCity = str(fd, 'destCity');
  const destCountry = str(fd, 'destCountry');
  const start = dateOrNull(fd, 'startDate');
  const end = dateOrNull(fd, 'endDate');
  // Server-side validation (the browser `required` attributes are only a first gate).
  const missing: string[] = [];
  if (!purposeId) missing.push('travel purpose');
  if (!destCountry || !destCity) missing.push('destination');
  if (!start || !end) missing.push('travel dates');
  if (start && end && start > end) missing.push('a return date on or after departure');
  if (!str(fd, 'bookingArrangement')) missing.push('booking arrangement');
  if (missing.length) redirect(`/requests/${id}/trip?error=${encodeURIComponent('Please provide: ' + missing.join(', ') + '.')}`);
  // §13.19 derive the entitled class for the (single-destination) trip and pre-fill it.
  const hours = EcsReference.flightHours(destCity);
  const derived = EcsTravelClassRegister.entitledForItinerary(req0?.travellerId ?? 'E-TRAV', [{ durationHours: hours, destCode: destCity }], start ?? new Date());
  const chosenClass = str(fd, 'travelClassId') || derived.classId;
  const bookingArr = str(fd, 'bookingArrangement') || BOOKING_ARRANGEMENT.Auto;

  await prisma.travelRequest.update({
    where: { id },
    data: {
      purposeId,
      isResearch: purpose?.isResearch ?? false,
      description: str(fd, 'description'),
      destCountry: str(fd, 'destCountry'),
      destCity,
      startDate: start,
      endDate: dateOrNull(fd, 'endDate'),
      personalStart: dateOrNull(fd, 'personalStart'),
      personalEnd: dateOrNull(fd, 'personalEnd'),
      eventStartDate: dateOrNull(fd, 'eventStartDate'),
      eventEndDate: dateOrNull(fd, 'eventEndDate'),
      invitationRef: str(fd, 'invitationRef') || null,
      visaLetterRequired: str(fd, 'visaLetterRequired') === 'on',
      // §2.2 booking arrangement drives the (derived) preferred TMC + the TMC method.
      bookingArrangement: bookingArr,
      tmcProviderId: providerFromArrangement(bookingArr), // TMC-<id> → explicit provider; AUTO/non-TMC → null
      bookingMethod: isTmcArrangement(bookingArr) ? (str(fd, 'bookingMethod') || null) : null,
      travelClassId: chosenClass,
      entitledClassId: derived.classId,
      classBasis: derived.basis,
      classJustification: str(fd, 'classJustification') || null,
    },
  });
  // Default single-destination return itinerary — only when no legs exist yet, so a
  // hand-built multi-leg itinerary (§13.20) is never clobbered.
  const destAirport = str(fd, 'destAirport');
  if (destAirport && (req0?.legs.length ?? 0) === 0) {
    const origin = str(fd, 'originCode') || 'SIN';
    const ent = EcsTravelClassRegister.entitledForDuration(req0?.travellerId ?? 'E-TRAV', hours, start ?? new Date());
    await prisma.itineraryLeg.create({ data: { requestId: id, seq: 1, originCode: origin, destCode: destAirport, departDate: start, arriveDate: start, transportMode: 'AIR', durationHours: hours, travelClassId: chosenClass, entitledClassId: ent, chosenClassId: chosenClass } });
    await prisma.itineraryLeg.create({ data: { requestId: id, seq: 2, originCode: destAirport, destCode: origin, departDate: dateOrNull(fd, 'endDate'), arriveDate: dateOrNull(fd, 'endDate'), transportMode: 'AIR', durationHours: hours, travelClassId: chosenClass, entitledClassId: ent, chosenClassId: chosenClass } });
  }
  // §38 field-level audit — log each changed header field as "Label: old → new".
  const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : '—');
  const cls = (cid: string | null | undefined) => EcsReference.travelClass(cid ?? '')?.name ?? '—';
  const city = (c: string | null | undefined) => EcsReference.city(c ?? '')?.name ?? c ?? '—';
  const diffs = fieldDiffs([
    ['Travel purpose', EcsReference.travelPurpose(req0?.purposeId ?? '')?.name ?? '—', purpose?.name ?? '—'],
    ['Destination', city(req0?.destCity), city(destCity)],
    ['Start date', iso(req0?.startDate ?? null), iso(start)],
    ['End date', iso(req0?.endDate ?? null), iso(end)],
    ['Travel class', cls(req0?.travelClassId), cls(chosenClass)],
    ['Booking method', req0?.bookingMethod ?? '—', str(fd, 'bookingMethod') || '—'],
  ]);
  await audit(id, 'AMEND', diffs.length ? `Trip details updated — ${diffs.join('; ')}` : 'Trip details saved (no field changes)');
  revalidatePath(`/requests/${id}/trip`);
  redirect(`/requests/${id}/estimates`);
}

/* --------------------------------------------- multi-leg itinerary (§13.20) */
/** Update per-leg nights + entitled class for one ordered leg set (shared or a
 *  traveller's own sub-itinerary) and return the nights-by-city tally. */
async function updateLegMetrics(legs: FullRequest['legs'], ownerId: string, onDate: Date) {
  const ordered = [...legs].sort((a, b) => a.seq - b.seq);
  const nightsByCity: Record<string, number> = {};
  for (let i = 0; i < ordered.length; i++) {
    const leg = ordered[i];
    const next = ordered[i + 1];
    let nights = 0;
    const arrive = leg.arriveDate ?? leg.departDate;
    if (next?.departDate && arrive) nights = Math.max(Math.round((next.departDate.getTime() - arrive.getTime()) / 86400000), 0);
    const cityCode = EcsReference.airport(leg.destCode)?.cityCode ?? leg.destCode;
    const ent = leg.isPersonal ? null : EcsTravelClassRegister.entitledForDuration(ownerId, leg.durationHours ?? 12, onDate);
    await prisma.itineraryLeg.update({ where: { id: leg.id }, data: { nights, entitledClassId: ent } });
    if (!leg.isPersonal && cityCode !== 'SIN') nightsByCity[cityCode] = (nightsByCity[cityCode] ?? 0) + nights;
  }
  return nightsByCity;
}

/** §13.20 Keep each shared accommodation line's total in sync with the sum of every
 *  traveller's date-aware room-nights (nightly rate × their own nights at that city),
 *  so a traveller who extends their stay increases the accommodation cost. */
async function recomputeSharedAccommodation(id: string) {
  const req = await loadRequest(id);
  if (!req || !req.isGroup) return;
  for (const e of req.expenses.filter((x) => x.isShared && x.category === EXPENSE_CATEGORY.Accommodation && x.accommodation)) {
    const rate = e.accommodation!.budgetedNightly;
    const totalNights = req.travellers.reduce((s, t) => s + travellerNightsAtCity(req, t.employeeId, e.accommodation!.city), 0);
    const amt = rate * totalNights;
    if (Math.abs(amt - e.sgdAmount) > 0.001) {
      await prisma.estimatedExpense.update({ where: { id: e.id }, data: { sgdAmount: amt, foreignAmount: amt } });
    }
  }
}

/** Recompute the SHARED (group/individual) itinerary: per-leg metrics, main
 *  destination by longest stay, and the request-level entitled class. */
async function recomputeShared(id: string) {
  const req = await loadRequest(id);
  if (!req) return;
  const legs = sharedLegs(req);
  if (legs.length === 0) return;
  const onDate = req.startDate ?? legs[0].departDate ?? new Date();
  const nightsByCity = await updateLegMetrics(legs, req.travellerId, onDate);
  const main = Object.entries(nightsByCity).sort((a, b) => b[1] - a[1])[0]?.[0];
  const derived = EcsTravelClassRegister.entitledForItinerary(
    req.travellerId,
    legs.map((l) => ({ durationHours: l.durationHours, isPersonal: l.isPersonal, destCode: EcsReference.airport(l.destCode)?.cityCode ?? l.destCode })),
    onDate,
  );
  await prisma.travelRequest.update({
    where: { id },
    data: { entitledClassId: derived.classId, classBasis: derived.basis, ...(main ? { destCity: main, destCountry: EcsReference.city(main)?.countryCode ?? req.destCountry } : {}) },
  });
  await recomputeSharedAccommodation(id); // non-deviating travellers inherit the shared dates
}


/** Add a leg to the (single, shared) itinerary. There are no per-traveller sub-itineraries. */
export async function addLeg(id: string, fd: FormData) {
  if (!(await requireEdit(id))) return;
  const req = await loadRequest(id);
  if (!req) return;
  const seq = sharedLegs(req).reduce((m, l) => Math.max(m, l.seq), 0) + 1;
  const originCode = str(fd, 'originCode');
  const destCode = str(fd, 'destCode');
  if (!originCode || !destCode) return;
  await prisma.itineraryLeg.create({
    data: {
      requestId: id, travellerId: null, seq, originCode, destCode,
      departDate: dateOrNull(fd, 'departDate'), arriveDate: dateOrNull(fd, 'arriveDate') ?? dateOrNull(fd, 'departDate'),
      transportMode: str(fd, 'transportMode') || 'AIR', durationHours: num(fd, 'durationHours') || null,
      departTime: str(fd, 'departTime') || null, bookingRequired: str(fd, 'bookingRequired') === 'on',
      isPersonal: str(fd, 'isPersonal') === 'on', travelClassId: req.travelClassId, chosenClassId: req.travelClassId,
    },
  });
  await recomputeShared(id);
  await audit(id, 'AMEND', `Itinerary leg added (${originCode} → ${destCode})`);
  revalidatePath(`/requests/${id}/trip`); revalidatePath(`/requests/${id}`);
}

export async function removeLeg(id: string, legId: string) {
  if (!(await requireEdit(id))) return;
  await prisma.itineraryLeg.delete({ where: { id: legId } });
  const remaining = await prisma.itineraryLeg.findMany({ where: { requestId: id, travellerId: null }, orderBy: { seq: 'asc' } });
  for (let i = 0; i < remaining.length; i++) await prisma.itineraryLeg.update({ where: { id: remaining[i].id }, data: { seq: i + 1 } });
  await recomputeShared(id);
  await audit(id, 'AMEND', 'Itinerary leg removed');
  revalidatePath(`/requests/${id}/trip`); revalidatePath(`/requests/${id}`);
}

export async function moveLeg(id: string, legId: string, dir: 'up' | 'down') {
  if (!(await requireEdit(id))) return;
  const legs = await prisma.itineraryLeg.findMany({ where: { requestId: id, travellerId: null }, orderBy: { seq: 'asc' } });
  const idx = legs.findIndex((l) => l.id === legId);
  const swap = dir === 'up' ? idx - 1 : idx + 1;
  if (idx < 0 || swap < 0 || swap >= legs.length) return;
  await prisma.itineraryLeg.update({ where: { id: legs[idx].id }, data: { seq: legs[swap].seq } });
  await prisma.itineraryLeg.update({ where: { id: legs[swap].id }, data: { seq: legs[idx].seq } });
  await recomputeShared(id);
  revalidatePath(`/requests/${id}/trip`); revalidatePath(`/requests/${id}`);
}

/* ------------------------------------------------- estimates (TR-05..08) */
export async function addAirfare(id: string, fd: FormData) {
  if (!(await requireEdit(id))) return;
  const currency = str(fd, 'currency') || 'SGD';
  const foreign = num(fd, 'amount');
  if (foreign <= 0) redirect(`/requests/${id}/estimates?error=${encodeURIComponent('Airfare amount must be greater than 0.')}`);
  const now = new Date();
  const sgd = EcsFx.toSgd(foreign, currency, now); // §13.4 converted at the entry-date rate; re-locked at submission
  const spForeign = num(fd, 'sponsorship');
  await prisma.estimatedExpense.create({
    data: {
      requestId: id, category: EXPENSE_CATEGORY.Airfare, expenseTypeId: 'ET-AIR',
      currency, foreignAmount: foreign, sgdAmount: sgd,
      sponsorForeign: spForeign, sponsorSgd: EcsFx.toSgd(spForeign, currency, now),
      estimateBasis: 'QUOTED', expectedDate: dateOrNull(fd, 'expectedDate'),
      originCode: str(fd, 'originCode'), destCode: str(fd, 'destCode'),
      proposedClassId: str(fd, 'proposedClassId'), fareCeiling: sgd, handoffStatus: 'Pending',
      notes: str(fd, 'notes'),
      travellerId: str(fd, 'travellerId') || null, // §13.14 airfare is always individual
    },
  });
  await audit(id, 'AMEND', `Airfare estimate added (${currency} ${foreign})`);
  revalidatePath(`/requests/${id}/estimates`);
}

export async function addAccommodation(id: string, fd: FormData) {
  if (!(await requireEdit(id))) return;
  const settings = await getSettings();
  const city = str(fd, 'city');
  const nights = Math.round(num(fd, 'nights'));
  const personalNights = Math.round(num(fd, 'personalNights'));
  const quotedNightly = num(fd, 'quotedNightly');
  if (!city || nights <= 0 || quotedNightly <= 0) redirect(`/requests/${id}/estimates?error=${encodeURIComponent('Accommodation needs a city, nights > 0 and a nightly rate > 0.')}`);
  const calc = computeAccommodation({ cityCode: city, nights, personalNights, quotedNightly, basis: settings.hotelEstimateBasis });
  const exp = await prisma.estimatedExpense.create({
    data: {
      requestId: id, category: EXPENSE_CATEGORY.Accommodation, expenseTypeId: 'ET-ACC',
      currency: 'SGD', foreignAmount: calc.sgdAmount, sgdAmount: calc.sgdAmount,
      estimateBasis: settings.hotelEstimateBasis, expectedDate: dateOrNull(fd, 'checkIn'),
      notes: str(fd, 'notes'),
      travellerId: str(fd, 'shared') === 'on' ? null : (str(fd, 'travellerId') || null),
      isShared: str(fd, 'shared') === 'on', // §13.14 hotel may be a shared apportioned line
    },
  });
  await prisma.accommodationEstimate.create({
    data: {
      expenseId: exp.id, city, checkIn: dateOrNull(fd, 'checkIn'), checkOut: dateOrNull(fd, 'checkOut'),
      nights, personalNights, quotedNightly, capNightly: calc.capNightly, budgetedNightly: calc.budgetedNightly,
      capVariance: calc.capVariance, conferenceHotel: str(fd, 'conferenceHotel') === 'on',
      exceptionOutcome: calc.outcome,
    },
  });
  await audit(id, 'AMEND', `Accommodation estimate added (${city}, ${nights} nights)`);
  revalidatePath(`/requests/${id}/estimates`);
}

export async function addOda(id: string, fd: FormData) {
  if (!(await requireEdit(id))) return;
  const country = str(fd, 'country');
  const arrive = dateOrNull(fd, 'arrive');
  const depart = dateOrNull(fd, 'depart');
  const personalDays = Math.round(num(fd, 'personalDays'));
  if (!country || !arrive || !depart || depart < arrive) redirect(`/requests/${id}/estimates?error=${encodeURIComponent('ODA needs a country and arrive/depart dates (depart on or after arrive).')}`);
  const calc = computeOda({ countryCode: country, arrive, depart, personalDays });
  const exp = await prisma.estimatedExpense.create({
    data: {
      requestId: id, category: EXPENSE_CATEGORY.ODA, expenseTypeId: 'ET-ODA',
      currency: 'SGD', foreignAmount: calc.sgdAmount, sgdAmount: calc.sgdAmount,
      estimateBasis: 'RATE', expectedDate: arrive, notes: str(fd, 'notes'),
      travellerId: str(fd, 'travellerId') || null, // §13.14 ODA is always individual
    },
  });
  await prisma.oDAEstimate.create({
    data: { expenseId: exp.id, country, city: str(fd, 'city'), arrive, depart, eligibleDays: calc.eligibleDays, personalDays, dailyRate: calc.dailyRate, ratePct: 100 },
  });
  await audit(id, 'AMEND', `ODA estimate added (${country}, ${calc.eligibleDays} eligible days)`);
  revalidatePath(`/requests/${id}/estimates`);
}

export async function addOther(id: string, fd: FormData) {
  if (!(await requireEdit(id))) return;
  const currency = str(fd, 'currency') || 'SGD';
  const foreign = num(fd, 'amount');
  if (foreign <= 0) redirect(`/requests/${id}/estimates?error=${encodeURIComponent('Amount must be greater than 0.')}`);
  const typeId = str(fd, 'expenseTypeId') || 'ET-OTH';
  const type = EcsReference.expenseType(typeId);
  await prisma.estimatedExpense.create({
    data: {
      requestId: id, category: type?.category ?? EXPENSE_CATEGORY.Other, expenseTypeId: typeId,
      currency, foreignAmount: foreign, sgdAmount: EcsFx.toSgd(foreign, currency, new Date()),
      estimateBasis: 'QUOTED', notes: str(fd, 'notes'),
      travellerId: str(fd, 'shared') === 'on' ? null : (str(fd, 'travellerId') || null),
      isShared: str(fd, 'shared') === 'on',
    },
  });
  await audit(id, 'AMEND', `${type?.name ?? 'Other'} estimate added`);
  revalidatePath(`/requests/${id}/estimates`);
}

export async function deleteExpense(id: string, expenseId: string) {
  if (!(await requireEdit(id))) return;
  await prisma.estimatedExpense.delete({ where: { id: expenseId } });
  await audit(id, 'AMEND', 'Estimate line removed');
  revalidatePath(`/requests/${id}/estimates`);
}

/* --------------------------------------------------------- charging (TR-09) */
export async function saveCharging(id: string, fd: FormData) {
  if (!(await requireEdit(id))) return;
  const req = await prisma.travelRequest.findUnique({ where: { id }, include: { expenses: { include: { accommodation: true, oda: true } } } });
  if (!req) return;
  const settings = await getSettings();
  const ntuFunded = computeSummary(req.expenses, settings.approvalAmountBasis).ntuFunded;
  const raw = resolveChargingRows(fd, req.expenses, ntuFunded, EcsIdentity.employee(req.travellerId)?.defaultChargingCode ?? '');

  // §17 ITEM mode persists per-line accounts; other modes clear them.
  if (raw.mode === 'ITEM') {
    for (const e of req.expenses) await prisma.estimatedExpense.update({ where: { id: e.id }, data: { chargingCode: raw.lineMap[e.id] || null } });
  } else {
    await prisma.estimatedExpense.updateMany({ where: { requestId: id }, data: { chargingCode: null } });
  }

  await prisma.travelRequest.update({ where: { id }, data: { chargingMode: raw.mode } });
  await prisma.chargingAllocation.deleteMany({ where: { requestId: id } });
  for (const r of raw.rows) {
    const master = EcsCharging.code(r.chargingCode);
    await prisma.chargingAllocation.create({
      data: {
        requestId: id, chargingCode: r.chargingCode, percent: r.percent, amountSgd: r.amountSgd,
        internalOrder: r.internalOrder, isMain: r.isMain,
        chargingType: master?.type ?? 'CC', companyCode: master?.companyCode, businessArea: master?.businessArea,
        isResearch: master?.isResearch ?? false,
      },
    });
  }
  await audit(id, 'AMEND', raw.mode === 'ITEM' ? 'Charging allocated per expense item (cross-charge)' : raw.mode === 'CLAIM' ? 'Charging allocated at claim level' : 'Charging allocation saved');
  await persistPolicy(id);
  revalidatePath(`/requests/${id}/charging`);
  redirect(`/requests/${id}/policy`);
}

/* ----------------------------------------------------- policy review (TR-10) */
export async function runPolicy(id: string) {
  await persistPolicy(id);
  revalidatePath(`/requests/${id}/policy`);
  revalidatePath(`/requests/${id}/review`);
}

/* ---------------------------------------------------------- submit (TR-11) */
export async function submitRequest(id: string, fd?: FormData) {
  const req = await loadRequest(id);
  if (!req) return;
  if (!canEditRequest(await currentPersonaId(), req)) { await audit(id, 'STATUS', 'Submit blocked — not authorised to edit this request'); return; }
  if (!actionAllowed('submit', req.status)) { await audit(id, 'STATUS', `Submit blocked — request is ${req.status}, not in an editable state`); return; }
  const settings = await getSettings();

  // §4.8 high-risk destination — the traveller must acknowledge the advisory before submission.
  const highRisk = isHighRisk(req);
  // §23 optional traveller-selected Additional Approver (any AD person, never the traveller).
  if (fd) {
    const aa = str(fd, 'additionalApproverId');
    const aaId = aa && aa !== req.travellerId ? aa : null;
    const personalAck = str(fd, 'personalAck') === 'on';
    const highRiskAck = str(fd, 'highRiskAck') === 'on' || req.highRiskAck;
    if (highRisk && !highRiskAck) {
      await audit(id, 'STATUS', 'Submission blocked — high-risk destination requires the traveller acknowledgement (§4.8)');
      revalidatePath(`/requests/${id}/review`);
      return;
    }
    await prisma.travelRequest.update({ where: { id }, data: { additionalApproverId: aaId, personalAck, highRiskAck } });
  }

  // §13.4 lock foreign-currency estimates to the SGD rate effective on the submission date.
  const submitDate = new Date();
  const relocked = await relockFx(req, submitDate);
  if (relocked > 0) await audit(id, 'AMEND', `FX locked at submission — ${relocked} foreign-currency line(s) re-converted at the ${submitDate.toISOString().slice(0, 7)} rate (§13.4)`);

  // Re-run policy (on the locked amounts); block on hard stop (AC06).
  const { hardStop, exception } = await persistPolicy(id);
  if (hardStop) {
    revalidatePath(`/requests/${id}/review`);
    return; // UI shows the hard stops and disables submit
  }

  const fresh = await loadRequest(id);
  if (!fresh) return;
  const summary = computeSummary(fresh.expenses, settings.approvalAmountBasis);
  const steps = buildRoute(fresh, {
    exceptionApproverRequired: settings.exceptionApproverRequired,
    sameRouteResearch: settings.sameRouteResearch,
    approvalAmount: summary.approvalAmount,
    hasException: exception,
    crossBaThresholdSgd: settings.crossBaThresholdSgd,
    roRequirement: settings.roRequirement,
  });
  const firstStatus = steps.length ? statusForStep(steps[0].roleType) : REQUEST_STATUS.PendingDOA;
  // Atomic: approval amount + rebuilt route + status move together (no half-built route).
  await prisma.$transaction([
    prisma.travelRequest.update({ where: { id }, data: { approvalAmountSgd: summary.approvalAmount } }),
    prisma.approvalStep.deleteMany({ where: { requestId: id } }),
    ...steps.map((s) => prisma.approvalStep.create({ data: { requestId: id, seq: s.seq, roleType: s.roleType, approverId: s.approverId, comments: s.note } })),
    prisma.travelRequest.update({ where: { id }, data: { status: firstStatus } }),
  ]);

  await snapshot(fresh, 'SUBMISSION', false);
  await audit(id, 'SUBMIT', `Submitted for approval — routed to ${steps.map((s) => s.roleType).join(' → ')}`, req.requestorId !== req.travellerId ? req.travellerId : null);

  // §4.8 notify the risk office when a high-risk destination is involved.
  if (highRisk) {
    const names = highRiskDestinationsForRequest(fresh).map((h) => `${h.name} (${h.riskLevel})`).join(', ');
    await audit(id, 'STATUS', `High-risk travel — ${names}; traveller acknowledged, Risk Management Office notified (§4.8)`);
  }

  revalidatePath('/dashboard');
  redirect(`/requests/${id}`);
}

/* ---------------------------------------------- approver actions (TR-12) */
export async function approveStep(id: string, fd?: FormData) {
  const req = await loadRequest(id);
  if (!req) return;
  if (!actionAllowed('approve', req.status)) { await audit(id, 'STATUS', `Approve blocked — request is ${req.status}, not awaiting approval`); return; }
  const persona = await currentPersonaId();
  const step = req.approvalSteps.find((s) => s.status === 'Pending');
  if (!step) return;
  if (!canActOnStep(step.approverId, persona)) return; // AC14/AC22 — assigned approver or Travel Admin only
  // §4.8 high-risk destination — the approver must acknowledge the advisory to approve.
  if (isHighRisk(req) && (fd ? str(fd, 'highRiskAck') : '') !== 'on') {
    await audit(id, 'STATUS', 'Approval blocked — high-risk destination requires the approver acknowledgement (§4.8)');
    revalidatePath(`/requests/${id}`);
    return;
  }
  const inReapproval = req.status === REQUEST_STATUS.AmendmentInProgress;

  // Optimistic concurrency — only decide the step if it is still Pending (one winner).
  const won = await prisma.approvalStep.updateMany({ where: { id: step.id, status: 'Pending' }, data: { status: 'Approved', decidedAt: new Date() } });
  if (won.count === 0) return; // another actor already decided this step
  await audit(id, 'APPROVE', `${step.roleType} ${inReapproval ? 'reapproved' : 'approved'} by ${EcsIdentity.employee(persona)?.name ?? persona}`);
  // §4.8 record the approver's high-risk acknowledgement.
  if (isHighRisk(req)) {
    await prisma.travelRequest.update({ where: { id }, data: { highRiskApproverAck: true } });
    await audit(id, 'STATUS', `${EcsIdentity.employee(persona)?.name ?? persona} acknowledged the high-risk travel advisory (§4.8)`);
  }

  const next = req.approvalSteps.find((s) => s.seq > step.seq && s.status === 'Pending');
  if (next) {
    // During reapproval the umbrella status stays Amendment In Progress (§13.1).
    if (!inReapproval) await prisma.travelRequest.update({ where: { id }, data: { status: statusForStep(next.roleType) } });
  } else {
    // Final approval issues the Travel Authorisation. Group requests do NOT require a
    // traveller-confirmation gate (confirmation is assumed handled offline), so a group is
    // approved straight through, identical to an individual request.
    await finalizeApproval(id);
  }
  revalidatePath(`/requests/${id}`);
  revalidatePath('/dashboard');
}

// NOTE: a Travel Request has no Reject action — an approver who disagrees uses sendBack,
// which returns the request to the requestor to revise and resubmit (matching the ECS
// expense-claim flow). The terminal "Rejected" status is therefore not reachable from the UI.

export async function sendBack(id: string, fd: FormData) {
  const persona = await currentPersonaId();
  const req = await loadRequest(id);
  if (!req) return;
  if (!actionAllowed('sendBack', req.status)) { await audit(id, 'STATUS', `Send-back blocked — request is ${req.status}, not awaiting approval`); return; }
  const step = req.approvalSteps.find((s) => s.status === 'Pending');
  if (!step || !canActOnStep(step.approverId, persona)) return; // AC14 — only the pending approver / Travel Admin
  const won = await prisma.approvalStep.updateMany({ where: { id: step.id, status: 'Pending' }, data: { status: 'SentBack', decidedAt: new Date(), comments: str(fd, 'comment') } });
  if (won.count === 0) return; // another actor already decided this step
  await prisma.travelRequest.update({ where: { id }, data: { status: REQUEST_STATUS.SentBack } });
  await audit(id, 'SENDBACK', `Sent back by ${EcsIdentity.employee(persona)?.name ?? persona}: ${str(fd, 'comment')}`);
  revalidatePath(`/requests/${id}`);
  redirect(`/requests/${id}`);
}

export async function withdrawRequest(id: string) {
  const req = await loadRequest(id);
  if (!req) return;
  if (!actionAllowed('withdraw', req.status)) { await audit(id, 'STATUS', `Withdraw blocked — request is ${req.status}`); return; }
  await prisma.travelRequest.update({ where: { id }, data: { status: REQUEST_STATUS.Withdrawn } });
  await prisma.approvalStep.updateMany({ where: { requestId: id, status: 'Pending' }, data: { status: 'Skipped' } });
  await audit(id, 'STATUS', 'Withdrawn by requestor');
  revalidatePath(`/requests/${id}`);
  redirect(`/requests/${id}`);
}

/** Send-back reopens the same request in Draft for editing (§13.2). */
export async function reopenDraft(id: string) {
  const req = await loadRequest(id);
  if (!req) return;
  if (!actionAllowed('reopen', req.status)) { await audit(id, 'STATUS', `Reopen blocked — request is ${req.status}, not Sent Back`); return; }
  await prisma.travelRequest.update({ where: { id }, data: { status: REQUEST_STATUS.Draft } });
  await audit(id, 'STATUS', 'Reopened as Draft after send-back');
  redirect(`/requests/${id}/trip`);
}

/** Cancel an approved/expired request (or one in amendment). Skips pending steps and
 * marks any live booking cancelled (§13.1). */
export async function cancelRequest(id: string, fd?: FormData) {
  const req = await loadRequest(id);
  if (!req) return;
  if (!actionAllowed('cancel', req.status)) { await audit(id, 'STATUS', `Cancel blocked — request is ${req.status}`); return; }
  const reason = fd ? str(fd, 'reason') : '';
  await prisma.travelRequest.update({ where: { id }, data: { status: REQUEST_STATUS.Cancelled } });
  await prisma.approvalStep.updateMany({ where: { requestId: id, status: 'Pending' }, data: { status: 'Skipped' } });
  // §34 cancelling a request with a live TMC booking triggers a TMC cancellation — capture
  // the cancel reference and any cancellation fee the TMC/airline charges (mock).
  const liveBooking = [BOOKING_STATUS.SentToTMC, BOOKING_STATUS.Booked, BOOKING_STATUS.Failed, ...TMC_INFLIGHT_STATUSES].includes(req.bookingStatus as never);
  if (liveBooking) {
    const booking = req.bookings.find((b) => b.channel === 'TMC');
    const wasBooked = req.bookingStatus === BOOKING_STATUS.Booked;
    const cancellationFeeSgd = wasBooked ? 75 : 0; // mock airline/TMC cancellation fee once ticketed
    const cancelRef = `CXL-${booking?.pnr ?? req.authorisationNo?.replace(/\D/g, '').slice(-4) ?? '0000'}`;
    await prisma.integrationMessage.create({ data: { requestId: id, direction: 'OUTBOUND', kind: 'TMC_CANCEL', payload: JSON.stringify({ documentType: 'BOOKING_CANCEL', authorisationNumber: req.authorisationNo, cancelRef, cancellationFeeSgd, pnr: booking?.pnr ?? null, reason: reason || 'Request cancelled', cancelledAt: new Date().toISOString() }, null, 2) } });
    await prisma.travelRequest.update({ where: { id }, data: { bookingStatus: BOOKING_STATUS.Cancelled } });
    await audit(id, 'INTEGRATION', `TMC booking cancelled — ${cancelRef}${cancellationFeeSgd ? `, cancellation fee SGD ${cancellationFeeSgd}` : ' (no fee)'}`);
  }
  await audit(id, 'STATUS', `Request cancelled${reason ? `: ${reason}` : ''}`);
  revalidatePath(`/requests/${id}`);
  revalidatePath('/dashboard');
  redirect(`/requests/${id}`);
}

/* --------------------------------------------- TMC hand-off (TR-14, §13.9) */
export async function handoffToTmc(id: string) {
  const req = await loadRequest(id);
  if (!req) return;
  // Idempotency — never double-send an in-flight or completed booking (prevents orphan
  // bookings). A failed booking is re-sent via resendToTmc (which resets to Not Sent).
  if ([BOOKING_STATUS.SentToTMC, BOOKING_STATUS.Booked, ...TMC_INFLIGHT_STATUSES].includes(req.bookingStatus as never)) {
    await audit(id, 'INTEGRATION', `Hand-off skipped — booking is already ${req.bookingStatus}`);
    revalidatePath(`/requests/${id}/booking`);
    return;
  }
  // §13.9 parameter filters — only hand off when the outbound guards all pass.
  const gate = evaluateFlow(req, 'OUTBOUND', await getGuardSettings());
  if (!gate.ok) {
    await audit(id, 'INTEGRATION', `Hand-off blocked by contract filter — ${gate.checks.filter((c) => !c.pass).map((c) => `${c.rule} (is ${c.actual})`).join('; ')}`);
    revalidatePath(`/requests/${id}/booking`);
    return;
  }
  // Multi-TMC: resolve the single provider this request routes to.
  const { provider } = resolveTmcProvider(req);
  const contract = await getContractSettings();
  const meta = { messageId: randomUUID(), sentAt: new Date().toISOString(), sourceStatus: req.status, contractVersion: CONTRACT_VERSION, tmc: provider.id };
  // §9.3 group fan-out (AC15): one approval → one booking instruction per traveller.
  const { mode, instructions } = assembleOutboundInstructions(req, tmcEnabledSet(contract), meta);
  const payloadObj = mode === 'GROUP_FANOUT'
    ? { meta, mode, authorisationNumber: req.authorisationNo ?? '', instructionCount: instructions.length, instructions }
    : instructions[0];
  await prisma.integrationMessage.create({ data: { requestId: id, direction: 'OUTBOUND', kind: 'TMC_HANDOFF', tmcProviderId: provider.id, payload: JSON.stringify(payloadObj, null, 2) } });
  await prisma.travelRequest.update({ where: { id }, data: { bookingStatus: BOOKING_STATUS.SentToTMC } });
  await audit(id, 'INTEGRATION', mode === 'GROUP_FANOUT'
    ? `Outbound booking fan-out sent to ${provider.name} (mock) — ${instructions.length} traveller instruction(s)`
    : `Outbound booking payload sent to ${provider.name} (mock)`);
  revalidatePath(`/requests/${id}/booking`);
}

export async function receiveBooking(id: string, fd: FormData) {
  const req = await loadRequest(id);
  const out = req?.messages.find((m) => m.kind === 'TMC_HANDOFF');
  if (!req || !out) return;
  // Multi-TMC: process the response with the adapter of the provider this request was sent to.
  const providerId = out.tmcProviderId ?? resolveTmcProvider(req).provider.id;
  const adapter = adapterFor(tmcProvider(providerId)?.adapterKey);
  // Idempotency — a booking already received is not reprocessed (prevents duplicate rows).
  if (req.bookingStatus === BOOKING_STATUS.Booked) {
    await audit(id, 'INTEGRATION', 'Inbound response ignored — booking already received');
    revalidatePath(`/requests/${id}/booking`);
    return;
  }
  // §13.9 parameter filters — only accept a response when the inbound guards all pass.
  const gate = evaluateFlow(req, 'INBOUND', await getGuardSettings());
  if (!gate.ok) {
    await audit(id, 'INTEGRATION', `Inbound response rejected by contract filter — ${gate.checks.filter((c) => !c.pass).map((c) => `${c.rule} (is ${c.actual})`).join('; ')}`);
    revalidatePath(`/requests/${id}/booking`);
    return;
  }
  // §6.4 the TMC may report a FAILED booking — record it and allow a re-send.
  if (fd && str(fd, 'outcome') === 'FAILED') {
    const failMeta = { messageId: randomUUID(), receivedAt: new Date().toISOString(), correlationId: JSON.parse(out.payload).meta?.messageId ?? null, sourceStatus: req.status, contractVersion: CONTRACT_VERSION, tmc: providerId };
    await prisma.integrationMessage.create({ data: { requestId: id, direction: 'INBOUND', kind: 'TMC_RESPONSE', tmcProviderId: providerId, payload: JSON.stringify({ meta: failMeta, authorisationNumber: req.authorisationNo, bookingStatus: BOOKING_STATUS.Failed, reason: str(fd, 'reason') || 'TMC could not fulfil the itinerary' }, null, 2) } });
    await prisma.travelRequest.update({ where: { id }, data: { bookingStatus: BOOKING_STATUS.Failed } });
    await audit(id, 'INTEGRATION', 'TMC reported booking FAILED — awaiting re-send');
    revalidatePath(`/requests/${id}/booking`);
    return;
  }
  const overFarePct = fd ? num(fd, 'overFarePct') : 0;
  const outbound = JSON.parse(out.payload);
  // §9.3 a group fan-out hand-off returns one booking per traveller instruction (AC15);
  // an individual hand-off returns a single booking. Normalise to a list either way.
  const isFanout = outbound.mode === 'GROUP_FANOUT' && Array.isArray(outbound.instructions);
  const instructions: Array<Record<string, unknown>> = isFanout ? outbound.instructions : [outbound];

  const inbounds = instructions.map((inst, i) => {
    const sim = adapter.simulateInbound(inst as never, { overFarePct });
    // Make each traveller's PNR/ticket unique within the fan-out.
    if (isFanout) {
      sim.pnr = `${sim.pnr}-${i + 1}`;
      sim.ticketNumbers = sim.ticketNumbers.map((tk) => `${tk}-${i + 1}`);
    }
    return { travellerId: (inst as { travellerRef?: string }).travellerRef ?? null, inbound: sim };
  });

  // §6.4 booking-deviation check (AC10) — on the aggregate booked airfare.
  const tol = EcsPolicy.tolerances();
  const approvedAir = req.expenses.filter((e) => e.category === EXPENSE_CATEGORY.Airfare).reduce((s, e) => s + e.sgdAmount, 0);
  const bookedAir = inbounds.reduce((s, b) => s + b.inbound.fareSgd + b.inbound.taxesSgd + b.inbound.feesSgd, 0);
  const allowed = approvedAir + Math.min(approvedAir * tol.bookingFarePct / 100, tol.bookingFareAbsSgd);
  const deviation = approvedAir > 0 && bookedAir > allowed;

  const inboundMeta = { messageId: randomUUID(), receivedAt: new Date().toISOString(), correlationId: outbound.meta?.messageId ?? null, sourceStatus: req.status, contractVersion: CONTRACT_VERSION, tmc: providerId };
  const responsePayload = isFanout
    ? { meta: inboundMeta, mode: 'GROUP_FANOUT', authorisationNumber: req.authorisationNo ?? '', bookings: inbounds.map((b) => b.inbound) }
    : { ...inbounds[0].inbound, meta: inboundMeta };

  // Atomic: response + bookings + segments + deviation + status succeed or fail together.
  await prisma.$transaction(async (tx) => {
    await tx.integrationMessage.create({ data: { requestId: id, direction: 'INBOUND', kind: 'TMC_RESPONSE', tmcProviderId: providerId, payload: JSON.stringify(responsePayload, null, 2) } });
    for (const { travellerId, inbound } of inbounds) {
      const booking = await tx.travelBooking.create({
        data: {
          requestId: id, travellerId, tmcProviderId: providerId, pnr: inbound.pnr, ticketNo: inbound.ticketNumbers[0], channel: 'TMC',
          fare: inbound.fareSgd, taxes: inbound.taxesSgd, fees: inbound.feesSgd,
          hotelRate: inbound.segments.find((s: { type: string }) => s.type === 'HOTEL')?.roomRateSgd, status: inbound.bookingStatus,
        },
      });
      for (const s of inbound.segments) {
        await tx.bookingSegment.create({ data: { bookingId: booking.id, type: s.type, originCode: s.origin, destCode: s.destination, bookedClassId: s.bookedClass, departDate: s.departDate ? new Date(s.departDate) : null, amount: s.amountSgd ?? s.roomRateSgd } });
      }
    }
    if (deviation) await tx.bookingDeviation.create({ data: { requestId: id, field: 'Airfare', approvedValue: approvedAir.toFixed(0), bookedValue: bookedAir.toFixed(0), material: true, action: 'Reapproval' } });
    await tx.travelRequest.update({ where: { id }, data: { bookingStatus: BOOKING_STATUS.Booked } });
  });
  await audit(id, 'INTEGRATION', isFanout
    ? `Inbound fan-out received — ${inbounds.length} booking(s) confirmed`
    : `Inbound booking received — PNR ${inbounds[0].inbound.pnr}`);
  revalidatePath(`/requests/${id}/booking`);
}

/** §30/§39 Advance the TMC booking lifecycle to a valid in-flight status (Received by
 *  TMC / Booking In Progress / Traveller Action Required / Partially Booked), or mark a
 *  booked trip as Travel Completed. Only valid transitions are accepted. */
export async function setBookingTmcStatus(id: string, fd: FormData) {
  const req = await loadRequest(id);
  if (!req) return;
  const to = str(fd, 'tmcStatus');
  const inFlightFrom = [BOOKING_STATUS.SentToTMC, ...TMC_INFLIGHT_STATUSES] as string[];
  const allowed =
    (TMC_INFLIGHT_STATUSES.includes(to) && inFlightFrom.includes(req.bookingStatus)) ||
    (to === BOOKING_STATUS.TravelCompleted && req.bookingStatus === BOOKING_STATUS.Booked);
  if (!allowed) { await audit(id, 'INTEGRATION', `TMC status change blocked — ${req.bookingStatus} → ${to} is not a valid transition`); return; }
  await prisma.travelRequest.update({ where: { id }, data: { bookingStatus: to } });
  await audit(id, 'INTEGRATION', `TMC booking status updated — ${req.bookingStatus} → ${to}`);
  revalidatePath(`/requests/${id}/booking`);
  revalidatePath('/dashboard');
}

export async function markSelfBooked(id: string) {
  await prisma.travelBooking.create({ data: { requestId: id, channel: 'SELF_BOOKED', status: BOOKING_STATUS.SelfBooked } });
  await prisma.travelRequest.update({ where: { id }, data: { bookingStatus: BOOKING_STATUS.SelfBooked, bookingArrangement: BOOKING_ARRANGEMENT.SelfBooked, bookingMethod: null } });
  await audit(id, 'STATUS', 'Traveller marked trip as self-booked (§13.17)');
  revalidatePath(`/requests/${id}/booking`);
}

/** §36 Post the booked airfare directly to ERP (SAP) against the trip's cost objects.
 *  Only applies when the Airfare-treatment setting is DIRECT_SAP and a TMC booking exists;
 *  idempotent (a posting already made is not repeated). */
export async function postAirfareToSap(id: string) {
  const req = await loadRequest(id);
  if (!req) return;
  const settings = await getSettings();
  if (settings.airfareTreatment !== 'DIRECT_SAP') {
    await audit(id, 'INTEGRATION', `Airfare SAP posting skipped — airfare treatment is ${settings.airfareTreatment}, not DIRECT_SAP`);
    revalidatePath(`/requests/${id}/booking`);
    return;
  }
  if (req.messages.some((m) => m.kind === 'SAP_AIRFARE_POST')) {
    await audit(id, 'INTEGRATION', 'Airfare SAP posting skipped — already posted');
    revalidatePath(`/requests/${id}/booking`);
    return;
  }
  const posting = buildSapAirfarePosting(req);
  if (!posting) {
    await audit(id, 'INTEGRATION', 'Airfare SAP posting skipped — no TMC booking to post');
    revalidatePath(`/requests/${id}/booking`);
    return;
  }
  await prisma.integrationMessage.create({ data: { requestId: id, direction: 'OUTBOUND', kind: 'SAP_AIRFARE_POST', payload: JSON.stringify(posting, null, 2) } });
  await audit(id, 'INTEGRATION', `Airfare posted directly to ERP (mock) — ${posting.glAccount}, SGD ${posting.amount.totalSgd.toFixed(2)} across ${posting.costObjects.length} cost object(s)`);
  revalidatePath(`/requests/${id}/booking`);
}

/** Retry a failed TMC hand-off: reset to Not Sent, discard the stale outbound, re-send. */
export async function resendToTmc(id: string) {
  const req = await loadRequest(id);
  if (!req || req.bookingStatus !== BOOKING_STATUS.Failed) return;
  await prisma.integrationMessage.deleteMany({ where: { requestId: id, kind: 'TMC_HANDOFF' } });
  await prisma.travelRequest.update({ where: { id }, data: { bookingStatus: BOOKING_STATUS.NotSent } });
  await audit(id, 'INTEGRATION', 'Re-sending to TMC after failed booking');
  await handoffToTmc(id);
}

/* ---------------------------------------- §4.13 visa letter notification */
/** Daily visa-letter batch: notify the org-unit-mapped immigration office for every
 *  approved request that flagged a visa letter and has not yet been notified. Idempotent
 *  (notified requests carry `visaLetterNotifiedAt`); failures are logged and left pending. */
export async function runVisaLetterBatch() {
  const pending = await prisma.travelRequest.findMany({
    where: { status: REQUEST_STATUS.Approved, visaLetterRequired: true, visaLetterNotifiedAt: null },
    include: { allocations: true },
  });
  const d = (x: Date | null) => (x ? x.toISOString().slice(0, 10) : '—');
  let sent = 0, failed = 0;
  for (const req of pending) {
    const rec = visaLetterRecipientFor(req.departmentId);
    if (!rec?.email) {
      await audit(req.id, 'INTEGRATION', `Visa letter notification FAILED — no recipient office mapped for ${req.requestNumber} (§4.13)`);
      failed++; continue;
    }
    const city = EcsReference.city(req.destCity ?? '')?.name ?? req.destCity ?? '—';
    const country = EcsReference.country(req.destCountry ?? '')?.name ?? '';
    const payload = {
      documentType: 'VISA_LETTER_NOTIFICATION',
      travelRequestRef: req.requestNumber,
      authorisationNumber: req.authorisationNo,
      traveller: travellerName(req),
      destination: `${city}${country ? `, ${country}` : ''}`,
      travelDates: `${d(req.startDate)} → ${d(req.endDate)}`,
      travelPurpose: EcsReference.travelPurpose(req.purposeId ?? '')?.name ?? '—',
      fundingSource: req.allocations.map((a) => a.chargingCode).join(', ') || '—',
      recipient: rec,
      generatedAt: new Date().toISOString(),
    };
    await prisma.integrationMessage.create({ data: { requestId: req.id, direction: 'OUTBOUND', kind: 'VISA_LETTER', payload: JSON.stringify(payload, null, 2) } });
    await prisma.travelRequest.update({ where: { id: req.id }, data: { visaLetterNotifiedAt: new Date() } });
    await audit(req.id, 'STATUS', `Visa letter notification sent to ${rec.office} (${rec.email}) for ${req.authorisationNo} — daily batch (§4.13)`);
    sent++;
  }
  await audit(null, 'INTEGRATION', `Visa letter daily batch — ${sent} sent, ${failed} failed, ${pending.length} candidate(s) (§4.13)`);
  revalidatePath('/visa-letters');
  revalidatePath('/notifications');
}

/* ------------------------------------ comments / attachments (§13.21) */
export async function addComment(id: string, fd: FormData) {
  const body = str(fd, 'comment');
  if (!body) return;
  const persona = await currentPersonaId();
  await prisma.auditEvent.create({ data: { requestId: id, actorId: persona, kind: 'COMMENT', summary: body } });
  revalidatePath(`/requests/${id}`);
}

export async function addAttachment(id: string, fd: FormData) {
  const persona = await currentPersonaId();
  // §2 real upload — read the posted file's bytes and store them (prototype stores in-row).
  const file = fd.get('file');
  const ALLOWED = ['application/pdf', 'image/png', 'image/jpeg'];
  const maxMb = (await getSettings()).attachmentMaxMb; // §43 configurable upload limit
  const MAX_BYTES = maxMb * 1024 * 1024;
  if (file && typeof file === 'object' && 'arrayBuffer' in file && (file as File).size > 0) {
    const f = file as File;
    if (!ALLOWED.includes(f.type)) { await audit(id, 'AMEND', `Attachment rejected — unsupported type ${f.type || 'unknown'} (PDF/PNG/JPEG only)`); revalidatePath(`/requests/${id}`); return; }
    if (f.size > MAX_BYTES) { await audit(id, 'AMEND', `Attachment rejected — ${(f.size / 1048576).toFixed(1)} MB exceeds the ${maxMb} MB limit`); revalidatePath(`/requests/${id}`); return; }
    const bytes = Buffer.from(await f.arrayBuffer());
    await prisma.attachment.create({
      data: { requestId: id, docType: str(fd, 'docType') || 'Other', fileName: f.name, sizeKb: Math.max(1, Math.round(f.size / 1024)), contentType: f.type, content: bytes, uploadedById: persona },
    });
    await audit(id, 'AMEND', `Attachment uploaded: ${f.name} (${Math.max(1, Math.round(f.size / 1024))} KB)`);
    revalidatePath(`/requests/${id}`);
    return;
  }
  // Fallback: metadata-only entry (no file chosen).
  const fileName = str(fd, 'fileName');
  if (!fileName) return;
  await prisma.attachment.create({
    data: { requestId: id, docType: str(fd, 'docType') || 'Other', fileName, sizeKb: Math.max(1, Math.round(num(fd, 'sizeKb')) || 120), uploadedById: persona },
  });
  await audit(id, 'AMEND', `Attachment added: ${fileName}`);
  revalidatePath(`/requests/${id}`);
}

/** §13.21 Copy to new request — clone the header, itinerary, estimates and charging
 *  into a fresh Draft. */
export async function copyToNewRequest(id: string) {
  const src = await loadRequest(id);
  if (!src) return;
  const requestorId = await currentPersonaId();
  const requestNumber = await nextRequestNumber(yr());
  const copy = await prisma.travelRequest.create({
    data: {
      requestNumber, requestorId, travellerId: src.travellerId, isGroup: src.isGroup,
      entityId: src.entityId, departmentId: src.departmentId, isResearch: src.isResearch,
      status: REQUEST_STATUS.Draft, bookingStatus: BOOKING_STATUS.NotSent,
      purposeId: src.purposeId, description: src.description, destCountry: src.destCountry, destCity: src.destCity,
      startDate: src.startDate, endDate: src.endDate, travelClassId: src.travelClassId,
      entitledClassId: src.entitledClassId, classBasis: src.classBasis, bookingMethod: src.bookingMethod,
      travellers: { create: src.travellers.map((t) => ({ employeeId: t.employeeId, isRequestor: t.isRequestor, sharePct: t.sharePct })) },
      legs: { create: src.legs.map((l) => ({ seq: l.seq, originCode: l.originCode, destCode: l.destCode, departDate: l.departDate, arriveDate: l.arriveDate, transportMode: l.transportMode, durationHours: l.durationHours, isPersonal: l.isPersonal, nights: l.nights, travelClassId: l.travelClassId, entitledClassId: l.entitledClassId, chosenClassId: l.chosenClassId })) },
      allocations: { create: src.allocations.map((a) => ({ chargingCode: a.chargingCode, percent: a.percent, chargingType: a.chargingType, companyCode: a.companyCode, businessArea: a.businessArea, isResearch: a.isResearch })) },
    },
  });
  for (const e of src.expenses) {
    const ne = await prisma.estimatedExpense.create({ data: { requestId: copy.id, travellerId: e.travellerId, category: e.category, expenseTypeId: e.expenseTypeId, currency: e.currency, foreignAmount: e.foreignAmount, sgdAmount: e.sgdAmount, sponsorForeign: e.sponsorForeign, sponsorSgd: e.sponsorSgd, estimateBasis: e.estimateBasis, isShared: e.isShared, originCode: e.originCode, destCode: e.destCode, proposedClassId: e.proposedClassId } });
    if (e.accommodation) await prisma.accommodationEstimate.create({ data: { expenseId: ne.id, city: e.accommodation.city, nights: e.accommodation.nights, personalNights: e.accommodation.personalNights, quotedNightly: e.accommodation.quotedNightly, capNightly: e.accommodation.capNightly, budgetedNightly: e.accommodation.budgetedNightly, capVariance: e.accommodation.capVariance, exceptionOutcome: e.accommodation.exceptionOutcome } });
    if (e.oda) await prisma.oDAEstimate.create({ data: { expenseId: ne.id, country: e.oda.country, city: e.oda.city, arrive: e.oda.arrive, depart: e.oda.depart, eligibleDays: e.oda.eligibleDays, personalDays: e.oda.personalDays, dailyRate: e.oda.dailyRate } });
  }
  await audit(copy.id, 'CREATE', `Copied from ${src.requestNumber}`);
  redirect(`/requests/${copy.id}`);
}

/* ------------------------------------------------ group travel (§13.13/§13.14) */

/** Create a group draft: a requestor (who may not be a traveller) names travellers. */
export async function createGroupDraft(fd: FormData) {
  const requestorId = await currentPersonaId();
  const travellerIds = (fd.getAll('travellerIds') as string[]).map((s) => s.trim()).filter(Boolean);
  // §13.14 a group needs at least two travellers (consistent with removeGroupTraveller),
  // and the requestor must be authorised for each (§13.13).
  if (travellerIds.length < 2) return;
  if (!travellerIds.every((t) => canCreateFor(requestorId, t))) return;
  const primary = travellerIds[0];
  const primaryEmp = EcsIdentity.employee(primary);
  const requestNumber = await nextRequestNumber(yr());
  const req = await prisma.travelRequest.create({
    data: {
      requestNumber, requestorId, travellerId: primary, isGroup: true,
      entityId: EcsIdentity.entity().id, departmentId: primaryEmp?.departmentId,
      status: REQUEST_STATUS.Draft, bookingStatus: BOOKING_STATUS.NotSent,
      travellers: {
        create: travellerIds.map((eid) => ({
          employeeId: eid,
          isRequestor: eid === requestorId,
          confirmed: false,
          sharePct: Math.round((100 / travellerIds.length) * 100) / 100,
        })),
      },
    },
  });
  await audit(req.id, 'CREATE', `Group draft ${requestNumber} created for ${travellerIds.length} travellers`, requestorId);
  redirect(`/requests/${req.id}/trip`);
}

export async function addGroupTraveller(id: string, fd: FormData) {
  const employeeId = str(fd, 'employeeId');
  if (!employeeId) return;
  const req = await loadRequest(id);
  if (!req || (!isFreeEditState(req.status) && !isAmendableState(req.status))) return;
  const exists = await prisma.travelRequestTraveller.findFirst({ where: { requestId: id, employeeId } });
  if (exists) return;
  await prisma.travelRequestTraveller.create({ data: { requestId: id, employeeId, confirmed: false } });
  await audit(id, 'AMEND', `Traveller ${EcsIdentity.employee(employeeId)?.name ?? employeeId} added to group`);
  // §13.14 adding a traveller after approval is a material amendment → reapproval.
  if (!isFreeEditState(req.status)) await applyMaterialAmendment(id, `traveller added (${EcsIdentity.employee(employeeId)?.name ?? employeeId})`);
  revalidatePath(`/requests/${id}`);
  revalidatePath('/dashboard');
}

/** §13.14 removing a traveller before travel releases their share and voids confirmation. */
export async function removeGroupTraveller(id: string, travellerRowId: string) {
  const req = await loadRequest(id);
  const row = await prisma.travelRequestTraveller.findUnique({ where: { id: travellerRowId } });
  if (!req || !row || (!isFreeEditState(req.status) && !isAmendableState(req.status))) return;
  if (req.travellers.length <= 2) return; // a group must keep at least two travellers
  await prisma.estimatedExpense.deleteMany({ where: { requestId: id, travellerId: row.employeeId } });
  await prisma.travelRequestTraveller.delete({ where: { id: travellerRowId } });
  await audit(id, 'AMEND', `Traveller ${EcsIdentity.employee(row.employeeId)?.name ?? row.employeeId} removed from group; share released and confirmation voided`);
  // §13.14 removing a traveller after approval is a material amendment → reapproval.
  if (!isFreeEditState(req.status)) await applyMaterialAmendment(id, `traveller removed (${EcsIdentity.employee(row.employeeId)?.name ?? row.employeeId})`);
  revalidatePath(`/requests/${id}`);
  revalidatePath('/dashboard');
}

/** §13.19 set a group traveller's chosen class + upgrade justification. A change post
 *  approval is a material amendment (it can alter the exception route). */
