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
import { computeSummary, computeAccommodation, computeOda, computeOdaTiered } from './pricing';
import { evaluatePolicies, hasHardStop, hasException } from './policy';
import { buildRoute, statusForStep, doaCandidatesFor } from './route';
import { sharedLegs, travellerNightsAtCity, computeTravellerShares, guestAttributionViolations } from './group';
import { findBlockingDuplicates } from './duplicates';
import { applyMaterialAmendment, isFreeEditState, isAmendableState } from './amend';
import { EcsIdentity, EcsReference, EcsFx, EcsPolicy, EcsCharging, EcsTravelClassRegister } from '@/shared/ecs/services';
import { REQUEST_STATUS, BOOKING_STATUS, TMC_INFLIGHT_STATUSES, EXPENSE_CATEGORY, APPROVER_ROLE, BOOKING_METHOD, BOOKING_ARRANGEMENT, POLICY_OUTCOME } from '@/shared/enums';
import { isTmcArrangement, providerFromArrangement } from './booking';
import { GUEST_TRAVELLER_ID, travellerName, isGuestRequest } from './traveller';
import { hasEmergencyApproval, emergencyMethodAllowed, withinEmergencyWindow, leadTimeDays, EMERGENCY_OOW_MIN_JUSTIFICATION } from './emergency';
import { ruleActive } from '@/config/policyRules';
import { upgradeCheckCtx, applyDefaultDeltaCodes, listUpliftRates, upliftPctFrom, deriveEntitlementSgd, listUpgradeAccounts, accountsForBA } from './upgradeConfig';
import { evaluateConfiguredPolicies } from './policyConfigEval';
import { getActiveWorkflowScenario } from './workflowConfig';
import { isHighRisk, highRiskDestinationsForRequest } from './risk';
import { visaLetterRecipient } from '@/config/visaLetter';
import { randomUUID } from 'node:crypto';
import { adapterFor } from '@/integrations/tmc/adapter';
import { obtToEcsBookingStatus } from '@/integrations/tmc/vocab';
import type { CanonicalInbound } from '@/integrations/tmc/contract';
import { assignGroupLineNos } from './groupLines';
import { assembleOutboundInstructions } from './tmcPayload';
import { buildSapAirfarePosting } from '@/integrations/sap/posting';
import { postCtaChargesForRequest, reverseCtaChargesForRequest } from './ctaPosting';
import { resolveTmcProvider } from './tmcRouting';
import { bookingsForAuthorisation } from './tmcRetrieval';
import { assessHandoffRouting, channelLabel } from './handoffRouting';
import { resolveChargingRows } from './chargingRollup';
import { tmcProvider } from '@/data/tmcProviders';
import { getContractSettings, tmcEnabledSet, getGuardSettings, evaluateFlow } from './integration';
import { CONTRACT_VERSION } from '@/config/integrationContracts';
import { actionAllowed, canActOnStep, canCreateFor, canCreateTravelRequest, canEditRequest } from './guards';

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
  const checks = evaluatePolicies(req, settings.approvalAmountBasis, await upgradeCheckCtx(settings));
  // §6.3 data-driven policy checks from the ECS Policy Configuration (advisories, offline, and any
  // configured rule) — evaluated alongside the structural engine checks.
  checks.push(...(await evaluateConfiguredPolicies(req, settings.approvalAmountBasis)).checks);

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
  // §13.9 auto hand-off on final approval — Travel Admin no longer triggers the send. Idempotent
  // (a booking already sent/booked/in-flight is skipped), and only TMC-arranged bookings are sent
  // (self-booked / host-arranged are not). A re-opened booking (Not Sent) on reapproval re-sends.
  if (approved && isTmcArrangement(approved.bookingArrangement)) await handoffToTmc(id);
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
  // Seed the default charging allocation from the traveller's profile cost object, so the request
  // always has a charging line (editable on the Charging step). Without this, going straight to
  // Policy Review without opening the Charging step raises a "no charging allocation" hard stop even
  // though the Charging step shows a default account. A Charging-step save replaces this row.
  await seedDefaultCharging(req.id, traveller?.defaultChargingCode);
  await audit(req.id, 'CREATE', `Draft ${requestNumber} created for ${traveller?.name ?? travellerId}`, requestorId !== travellerId ? travellerId : null);
  redirect(`/requests/${req.id}/trip`);
}

/** Create a 100% main charging allocation from a cost-object code, if one is given and not already
 *  present. Used at request creation so a draft is never left with no charging line. */
async function seedDefaultCharging(requestId: string, code: string | undefined | null) {
  if (!code) return;
  if (await prisma.chargingAllocation.count({ where: { requestId } })) return;
  const master = EcsCharging.code(code);
  await prisma.chargingAllocation.create({
    data: {
      requestId, chargingCode: code, percent: 100, isMain: true,
      chargingType: master?.type ?? 'CC', companyCode: master?.companyCode, businessArea: master?.businessArea,
      isResearch: master?.isResearch ?? false,
    },
  });
}

/** §8 Create a guest / non-employee travel request (AC7). The host (requestor) is an
 *  employee; the guest has no ECS/HR profile, so their identity is captured here and the
 *  trip is charged to the host's department. */
export async function createGuestDraft(fd: FormData) {
  const requestorId = await currentPersonaId();
  const host = EcsIdentity.employee(requestorId);
  // §13.13 / DD-24 separation of duties — an approver-only persona may not originate a request.
  if (!canCreateTravelRequest(requestorId)) return;
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
  // §8 a guest's trip is charged to the host's department cost object — seed it as the default.
  await seedDefaultCharging(req.id, host?.defaultChargingCode);
  await audit(req.id, 'CREATE', `Guest travel draft ${requestNumber} created for ${guestName}${str(fd, 'guestOrg') ? ` (${str(fd, 'guestOrg')})` : ''}`, null);
  redirect(`/requests/${req.id}/trip`);
}

/* ------------------------------------------------------------- trip (TR-04) */
export async function saveTrip(id: string, fd: FormData) {
  if (!(await requireEdit(id))) return;
  // "Save as draft" persists whatever has been entered and returns to the dashboard — mandatory-
  // field and date validation are deferred to Submit, so a partial step can be parked as a draft.
  const draft = str(fd, 'saveMode') === 'draft';
  const purposeId = str(fd, 'purposeId');
  const purpose = EcsReference.travelPurpose(purposeId);
  const req0 = await loadRequest(id);
  const start = dateOrNull(fd, 'startDate');
  const end = dateOrNull(fd, 'endDate');
  // §4.4/§13.20 ONE always-on itinerary for every trip type. The leg builder submits the legs;
  // the trip type is only a preset/label (Round-trip = 2 legs, One-way = 1, Multi-city = user-
  // determined). The main destination is derived uniformly from the longest-stay non-personal leg.
  const tripType = str(fd, 'tripType') === 'ONE_WAY' ? 'ONE_WAY' : str(fd, 'tripType') === 'MULTI_CITY' ? 'MULTI_CITY' : 'ROUND_TRIP';
  type FormLeg = { originCode: string; destCode: string; departDate: string; arriveDate: string; nights: number; durationHours: string; isPersonal: boolean };
  let formLegs: FormLeg[] = [];
  try { formLegs = (JSON.parse(str(fd, 'legsJson') || '[]') as FormLeg[]).filter((l) => l.destCode); } catch { formLegs = []; }
  const cityOf = (ap: string) => EcsReference.airport(ap)?.cityCode ?? ap;
  const countryOf = (city: string) => EcsReference.city(city)?.countryCode ?? '';
  // Main destination = longest-stay non-personal leg (fall back to the first leg), for all types.
  const mainLeg = [...formLegs].filter((l) => !l.isPersonal).sort((a, b) => b.nights - a.nights)[0] ?? formLegs[0];
  let destCity = ''; let destCountry = '';
  if (mainLeg) { destCity = cityOf(mainLeg.destCode); destCountry = countryOf(destCity); }
  // Server-side validation (the browser `required` attributes are only a first gate).
  const missing: string[] = [];
  if (!purposeId) missing.push('travel purpose');
  if (formLegs.length === 0) missing.push('at least one itinerary leg with a destination');
  if (!start || !end) missing.push('travel dates');
  if (!str(fd, 'bookingArrangement')) missing.push('booking arrangement');
  if (!draft && missing.length) redirect(`/requests/${id}/trip?error=${encodeURIComponent('Please provide: ' + missing.join(', ') + '.')}`);

  // §4.4/§4.5 cross-field date validation — authoritative mirror of the in-form checks. The
  // legs must sit inside the travel window (widened by any personal extension on either side),
  // run in order, and the personal extension cannot overlap the official travel dates.
  const pStart = dateOrNull(fd, 'personalStart');
  const pEnd = dateOrNull(fd, 'personalEnd');
  const evStart = dateOrNull(fd, 'eventStartDate');
  const evEnd = dateOrNull(fd, 'eventEndDate');
  const parse = (s: string) => (s ? new Date(s) : null);
  const invalid: string[] = [];
  if (start && end && end < start) invalid.push('the official end date is before the official start date');
  // A pre-trip request cannot be raised for a trip that has already started (a mis-keyed year/month);
  // compared at start-of-today so a same-day departure is fine. Drafts are exempt (checked below).
  const today0 = new Date(); today0.setHours(0, 0, 0, 0);
  if (start && start < today0) invalid.push('the official start date is in the past — correct the travel dates');
  if (evStart && evEnd && evEnd < evStart) invalid.push('the event end is before the event start');
  // §10 the event is a segment within the official travel window.
  if (start && end && evStart && (evStart < start || evStart > end)) invalid.push('the event start is outside the official travel dates');
  if (start && end && evEnd && (evEnd < start || evEnd > end)) invalid.push('the event end is outside the official travel dates');
  if (pStart && pEnd && pEnd < pStart) invalid.push('the personal extension end is before its start');
  if (start && end && (pStart || pEnd)) {
    const pS = pStart ?? pEnd!, pE = pEnd ?? pStart!;
    if (!(pE <= start || pS >= end)) invalid.push('the personal extension overlaps the official travel dates (it must fall before the start or after the end)');
  }
  const winStart = pStart && start && pStart < start ? pStart : start;
  const winEnd = pEnd && end && pEnd > end ? pEnd : end;
  let prevDepart: Date | null = null;
  let prevArrive: Date | null = null;
  formLegs.forEach((l, i) => {
    const dDep = parse(l.departDate), dArr = parse(l.arriveDate);
    if (dDep && dArr && dArr < dDep) invalid.push(`leg ${i + 1}'s arrival is before its departure`);
    if (dDep && winStart && winEnd && (dDep < winStart || dDep > winEnd)) invalid.push(`leg ${i + 1} departs outside the travel window`);
    if (dDep && prevDepart && dDep < prevDepart) invalid.push(`leg ${i + 1} departs before the previous leg`);
    // Overlap: a leg cannot depart a city before the previous leg arrives there (being in two
    // places at once). Only enforced when the previous leg's arrival date is present — arrival
    // dates are often left blank, in which case the depart-order check above remains the floor.
    if (dDep && prevArrive && dDep < prevArrive) invalid.push(`leg ${i + 1} departs before you arrive on the previous leg`);
    if (dDep) prevDepart = dDep;
    prevArrive = dArr; // immediately-previous leg's arrival only (null when blank → overlap check no-ops)
  });
  if (!draft && invalid.length) redirect(`/requests/${id}/trip?error=${encodeURIComponent('Please fix the dates: ' + invalid.join('; ') + '.')}`);
  // §13.19 entitlement is derived across the WHOLE itinerary — each flown leg's duration gives
  // its entitled class and the highest wins (longest-duration leg drives the class), not just
  // the main destination. Falls back to the main destination when no legs carry a duration.
  const hours = EcsReference.flightHours(destCity);
  const flownLegs = formLegs.filter((l) => !l.isPersonal).map((l) => { const c = cityOf(l.destCode); return { durationHours: EcsReference.flightHours(c), destCode: c }; });
  const legsForEntitlement = flownLegs.length ? flownLegs : [{ durationHours: hours, destCode: destCity }];
  const derived = EcsTravelClassRegister.entitledForItinerary(req0?.travellerId ?? 'E-TRAV', legsForEntitlement, start ?? new Date());
  const isGroupReq = !!req0?.isGroup;
  // §13.14/§13.19 Group travel books EACH traveller at their own entitled class (the requestor
  // can't justify an upgrade on a traveller's behalf). For a group there is no shared chosen
  // class or justification; the request-level class carries the lead's entitlement for display.
  // Individual requests keep the traveller-chosen class + any higher-class justification.
  const chosenClass = isGroupReq ? derived.classId : (str(fd, 'travelClassId') || derived.classId);
  const bookingArr = str(fd, 'bookingArrangement') || BOOKING_ARRANGEMENT.Auto;

  await prisma.travelRequest.update({
    where: { id },
    data: {
      purposeId,
      isResearch: purpose?.isResearch ?? false,
      description: str(fd, 'description'),
      tripType,
      destCountry,
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
      classJustification: isGroupReq ? null : (str(fd, 'classJustification') || null),
    },
  });
  // §13.14 Group: set each traveller's booked class to their OWN entitlement for this itinerary
  // (longest-duration leg). No per-traveller upgrade here — that is handled by removing the
  // traveller from the group and raising a single request.
  if (isGroupReq) {
    const travellers = await prisma.travelRequestTraveller.findMany({ where: { requestId: id } });
    for (const t of travellers) {
      // §8 guest members have no entitlement profile → Economy by default (AC7).
      const guest = t.travellerType === 'GUEST' || t.employeeId.startsWith('G-');
      const ent = guest
        ? { classId: 'TC-ECO' }
        : EcsTravelClassRegister.entitledForItinerary(t.employeeId, legsForEntitlement, start ?? new Date());
      await prisma.travelRequestTraveller.update({ where: { id: t.id }, data: { chosenClassId: ent.classId, entitledClassId: ent.classId } });
      // Keep any already-added airfare lines in sync with the (re-derived) entitlement so the
      // line class never drifts from the itinerary after it changes (§13.19).
      await prisma.estimatedExpense.updateMany({ where: { requestId: id, travellerId: t.employeeId, category: EXPENSE_CATEGORY.Airfare }, data: { proposedClassId: ent.classId } });
    }
  }
  // §4.4/§13.20 Rebuild the shared itinerary from the submitted legs (same for every trip type).
  // Each leg's flight duration is derived from its destination city (not trusted from the form).
  await prisma.itineraryLeg.deleteMany({ where: { requestId: id, travellerId: null } });
  type NewLeg = { originCode: string; destCode: string; departDate: Date | null; arriveDate: Date | null; durationHours: number | null; nights: number; isPersonal: boolean };
  const newLegs: NewLeg[] = formLegs.map((l) => ({
    originCode: l.originCode || 'SIN',
    destCode: l.destCode,
    departDate: l.departDate ? new Date(l.departDate) : null,
    arriveDate: l.arriveDate ? new Date(l.arriveDate) : (l.departDate ? new Date(l.departDate) : null),
    durationHours: EcsReference.flightHours(cityOf(l.destCode)),
    nights: l.nights || 0,
    isPersonal: !!l.isPersonal,
  }));
  // Backstop: for a ROUND_TRIP/ONE_WAY preset, keep the mirrored legs tracking the official
  // dates even when the client did not sync (e.g. an official-date change during an amendment) —
  // a leg that was empty or still on the OLD official date follows; a deliberate date is kept.
  if (tripType === 'ROUND_TRIP' || tripType === 'ONE_WAY') {
    const sameDay = (a: Date | null, b: Date | null) => !!a && !!b && a.getTime() === b.getTime();
    const oldStart = req0?.startDate ?? null, oldEnd = req0?.endDate ?? null;
    if (newLegs[0] && start && (!newLegs[0].departDate || sameDay(newLegs[0].departDate, oldStart))) {
      if (!newLegs[0].arriveDate || sameDay(newLegs[0].arriveDate, oldStart)) newLegs[0].arriveDate = start;
      newLegs[0].departDate = start;
    }
    if (tripType === 'ROUND_TRIP' && newLegs.length >= 2 && end) {
      const ret = newLegs[newLegs.length - 1];
      if (!ret.departDate || sameDay(ret.departDate, oldEnd)) {
        if (!ret.arriveDate || sameDay(ret.arriveDate, oldEnd)) ret.arriveDate = end;
        ret.departDate = end;
      }
    }
  }
  let seq = 1;
  for (const l of newLegs) {
    const ent = EcsTravelClassRegister.entitledForDuration(req0?.travellerId ?? 'E-TRAV', l.durationHours ?? hours, start ?? new Date());
    await prisma.itineraryLeg.create({ data: { requestId: id, seq: seq++, originCode: l.originCode, destCode: l.destCode, departDate: l.departDate, arriveDate: l.arriveDate, transportMode: 'AIR', durationHours: l.durationHours, nights: l.nights, isPersonal: l.isPersonal, travelClassId: chosenClass, entitledClassId: ent, chosenClassId: chosenClass } });
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
  // §4.5 Auto-derive ODA + per-stop hotel lines from the (just-saved) itinerary. A hotel rate edit
  // is reset to the city cap only when the dates/legs actually changed (a dates change supersedes a
  // prior rate edit); an unrelated trip edit keeps the edited rate.
  const legSig = (ls: { destCode: string; nights: number; isPersonal: boolean }[]) =>
    ls.map((l) => `${l.destCode}:${l.nights}:${l.isPersonal ? 1 : 0}`).join('|');
  const oldSig = `${req0?.startDate?.getTime() ?? 0}:${req0?.endDate?.getTime() ?? 0}:${legSig((req0?.legs ?? []).filter((l) => !l.travellerId).sort((a, b) => a.seq - b.seq))}`;
  const newSig = `${start?.getTime() ?? 0}:${end?.getTime() ?? 0}:${legSig(newLegs)}`;
  await syncAutoEstimates(id, oldSig !== newSig);
  if (draft) { await audit(id, 'STATUS', 'Saved as draft'); revalidatePath('/dashboard'); redirect('/dashboard'); }
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
/** §13.14 group fan-out for an individual estimate line. When the traveller select is set to
 *  the "All travellers" sentinel, return one id per group traveller so the caller creates a
 *  line for each; otherwise the single chosen traveller (or null for a non-group request). */
const ALL_TRAVELLERS = '__ALL__';
async function travellerFanout(id: string, fd: FormData): Promise<(string | null)[]> {
  if (str(fd, 'travellerId') !== ALL_TRAVELLERS) return [str(fd, 'travellerId') || null];
  const ts = await prisma.travelRequestTraveller.findMany({ where: { requestId: id } });
  return ts.length ? ts.map((t) => t.employeeId) : [null];
}

export async function addAirfare(id: string, fd: FormData) {
  if (!(await requireEdit(id))) return;
  const currency = str(fd, 'currency') || 'SGD';
  const foreign = num(fd, 'amount');
  if (foreign <= 0) redirect(`/requests/${id}/estimates?error=${encodeURIComponent('Airfare amount must be greater than 0.')}`);
  const now = new Date();
  const sgd = EcsFx.toSgd(foreign, currency, now); // §13.4 converted at the entry-date rate; re-locked at submission
  const spForeign = num(fd, 'sponsorship');
  const upFunding = (str(fd, 'upgradeFunding') || '').toUpperCase();
  const upgradeFunding = upFunding === 'NTU' || upFunding === 'SELF' ? upFunding : null;
  // #14 Model B — the entitlement fare is DERIVED from the chosen fare and the configured uplift %
  // for the class step (entitled → proposed): entitlement = chosen / (1 + pct), delta = chosen −
  // entitlement. No second quote is captured; a missing rate for the step blocks the add.
  const proposed = str(fd, 'proposedClassId');
  const reqRow = await prisma.travelRequest.findUnique({ where: { id }, select: { entitledClassId: true } });
  const entitledId = reqRow?.entitledClassId ?? 'TC-ECO';
  const isClassUpgrade = !!proposed && EcsTravelClassRegister.rank(proposed) > EcsTravelClassRegister.rank(entitledId);
  let entFareSgd: number | null = null;
  if (isClassUpgrade) {
    const pct = upliftPctFrom(await listUpliftRates(), entitledId, proposed);
    if (pct == null) {
      const fromN = EcsReference.travelClass(entitledId)?.name ?? entitledId;
      const toN = EcsReference.travelClass(proposed)?.name ?? proposed;
      redirect(`/requests/${id}/estimates?error=${encodeURIComponent(`No upgrade uplift rate is configured for ${fromN} → ${toN} — add it in Setup → Upgrade Uplift Rates before adding this airfare.`)}`);
    }
    entFareSgd = deriveEntitlementSgd(sgd, pct);
  }
  const tids = await travellerFanout(id, fd);
  // §13.19 enforce the class-upgrade justification at the point of adding the airfare (individual
  // lines) — resolved here, not deferred to a policy-review hard stop.
  if (tids.length === 1 && tids[0] === null && isClassUpgrade && !(str(fd, 'classJustification') || '').trim()) {
    const propName = EcsReference.travelClass(proposed)?.name ?? proposed;
    const entName = EcsReference.travelClass(entitledId)?.name ?? 'your entitlement';
    redirect(`/requests/${id}/estimates?error=${encodeURIComponent(`${propName} is above your ${entName} entitlement — enter a justification for the higher class before adding this airfare.`)}`);
  }
  // §13.14 for a group, default each line's proposed class to that traveller's booked (entitled)
  // class so estimates match what each person will fly, without re-keying per traveller.
  const classByTraveller: Record<string, string | null> = {};
  if (tids.some((t) => t)) {
    const ts = await prisma.travelRequestTraveller.findMany({ where: { requestId: id } });
    ts.forEach((t) => { classByTraveller[t.employeeId] = t.chosenClassId; });
  }
  for (const tid of tids) {
    await prisma.estimatedExpense.create({
      data: {
        requestId: id, category: EXPENSE_CATEGORY.Airfare, expenseTypeId: 'ET-AIR',
        currency, foreignAmount: foreign, sgdAmount: sgd,
        sponsorForeign: spForeign, sponsorSgd: EcsFx.toSgd(spForeign, currency, now),
        estimateBasis: 'QUOTED', expectedDate: dateOrNull(fd, 'expectedDate'),
        originCode: str(fd, 'originCode'), destCode: str(fd, 'destCode'),
        proposedClassId: (tid && classByTraveller[tid]) || str(fd, 'proposedClassId'), fareCeiling: sgd, handoffStatus: 'Pending',
        notes: str(fd, 'notes'),
        // #7/#14 upgrade split is captured on the individual airfare line only (groups fly entitlement).
        entitlementFareSgd: tid === null ? entFareSgd : null,
        upgradeFunding: tid === null ? upgradeFunding : null,
        travellerId: tid, // §13.14 airfare is always individual
      },
    });
  }
  // §13.19 individual request: the traveller sets the proposed class on the airfare line and
  // records the request-level class + any higher-class justification here (groups book each
  // traveller at their own entitlement, so they have no single chosen class to justify).
  if (tids.length === 1 && tids[0] === null) {
    await prisma.travelRequest.update({
      where: { id },
      data: {
        ...(proposed ? { travelClassId: proposed } : {}),
        classJustification: str(fd, 'classJustification') || null,
        // §8 / DD-25 guest airfare form carries the selected Provost for an above-Economy upgrade.
        ...(fd.has('provostId') ? { provostId: str(fd, 'provostId') || null } : {}),
      },
    });
  }
  await audit(id, 'AMEND', `Airfare estimate added (${currency} ${foreign})${tids.length > 1 ? ` — one per traveller (${tids.length})` : ''}`);
  revalidatePath(`/requests/${id}/estimates`);
  redirect(`/requests/${id}/estimates`);   // land on a clean URL (clears any prior ?error= banner)
}

/** §13.19 Update the class-upgrade justification on an existing airfare (individual) without
 *  removing and re-adding the line. Used by the standalone justification field on the Estimates step. */
export async function updateClassJustification(id: string, fd: FormData) {
  if (!(await requireEdit(id))) return;
  const j = (str(fd, 'classJustification') || '').trim();
  await prisma.travelRequest.update({ where: { id }, data: { classJustification: j || null } });
  await audit(id, 'AMEND', j ? 'Class-upgrade justification updated' : 'Class-upgrade justification cleared');
  revalidatePath(`/requests/${id}/estimates`);
  revalidatePath(`/requests/${id}/review`);
}

/** §6.3 Resolve the outstanding policy justifications in one go from the Policy Review step — the
 *  class-upgrade justification (request level) and each above-cap accommodation justification (the
 *  line's note) — then re-run the policy checks so the hard stops clear without leaving the page. */
export async function resolveJustifications(id: string, fd: FormData) {
  if (!(await requireEdit(id))) return;
  if (fd.has('classJustification')) {
    await prisma.travelRequest.update({ where: { id }, data: { classJustification: (str(fd, 'classJustification') || '').trim() || null } });
  }
  for (const [k, v] of fd.entries()) {
    if (k.startsWith('hotelNote_') && typeof v === 'string' && v.trim()) {
      await prisma.estimatedExpense.update({ where: { id: k.slice('hotelNote_'.length) }, data: { notes: v.trim() } });
    }
  }
  await persistPolicy(id);
  await audit(id, 'AMEND', 'Policy justifications resolved from the Policy Review step');
  revalidatePath(`/requests/${id}/policy`);
  revalidatePath(`/requests/${id}/review`);
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
  // §13.14 accommodation is per-traveller — each books, pays and claims their own room, so a
  // line is created per selected traveller (or all). No shared/apportioned hotel line.
  const tids = await travellerFanout(id, fd);
  for (const tid of tids) {
    const exp = await prisma.estimatedExpense.create({
      data: {
        requestId: id, category: EXPENSE_CATEGORY.Accommodation, expenseTypeId: 'ET-ACC',
        currency: 'SGD', foreignAmount: calc.sgdAmount, sgdAmount: calc.sgdAmount,
        estimateBasis: settings.hotelEstimateBasis, expectedDate: dateOrNull(fd, 'checkIn'),
        notes: str(fd, 'notes'),
        travellerId: tid,
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
  }
  await audit(id, 'AMEND', `Accommodation estimate added (${city}, ${nights} nights)${tids.length > 1 ? ` — one per traveller (${tids.length})` : ''}`);
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
  const tids = await travellerFanout(id, fd);
  // §8 guests receive no ODA — a per-diem is not a guest entitlement and has no settlement
  // path (no claim, not TMC-billed). Exclude guests from the fan-out and reject a guest pick.
  const guestIds = new Set((await prisma.travelRequestTraveller.findMany({ where: { requestId: id } })).filter((t) => t.travellerType === 'GUEST' || t.employeeId.startsWith('G-')).map((t) => t.employeeId));
  const odaTids = tids.filter((t) => !(t && guestIds.has(t)));
  if (odaTids.length === 0) redirect(`/requests/${id}/estimates?error=${encodeURIComponent('ODA does not apply to guests — select an employee traveller (§8).')}`);
  for (const tid of odaTids) {
    const exp = await prisma.estimatedExpense.create({
      data: {
        requestId: id, category: EXPENSE_CATEGORY.ODA, expenseTypeId: 'ET-ODA',
        currency: 'SGD', foreignAmount: calc.sgdAmount, sgdAmount: calc.sgdAmount,
        estimateBasis: 'RATE', expectedDate: arrive, notes: str(fd, 'notes'),
        travellerId: tid, // §13.14 ODA is always individual
      },
    });
    await prisma.oDAEstimate.create({
      data: { expenseId: exp.id, country, city: str(fd, 'city'), arrive, depart, eligibleDays: calc.eligibleDays, personalDays, dailyRate: calc.dailyRate, ratePct: 100 },
    });
  }
  await audit(id, 'AMEND', `ODA estimate added (${country}, ${calc.eligibleDays} eligible days)${tids.length > 1 ? ` — one per traveller (${tids.length})` : ''}`);
  revalidatePath(`/requests/${id}/estimates`);
}

/** §4.5 Auto-derive the POLICY-based estimate lines from the itinerary:
 *   • ODA — one line per employee traveller (guests get none), computed over the official dates.
 *   • Accommodation — ONE line per overnight, non-personal stop (excluding the return home),
 *     per traveller, at the stop city's cap.
 *  These are re-derived whenever the dates/legs change. `resetRates=true` resets an edited hotel
 *  nightly rate back to the city cap (a dates change supersedes a prior rate edit); `false` keeps
 *  an existing auto line's rate (unrelated trip edit). Manual lines (autoDerived=false) are never
 *  touched. Keyed by (travellerId, legSeq) for hotels and (travellerId) for ODA so the reconcile
 *  can update in place, add for a new stop/traveller and delete for a removed one. */
export async function syncAutoEstimates(id: string, resetRates: boolean) {
  const req = await loadRequest(id);
  if (!req) return;
  const settings = await getSettings();
  const key = (tid: string | null, legSeq: number | null | undefined) => `${tid ?? ''}|${legSeq ?? ''}`;
  const DAY = 86400000;

  // ---- Per-CITY stops, derived from the itinerary leg DATES (robust — does NOT rely on the stored
  // per-leg nights, which the trip form may leave at 0). A leg's destination city is a stop unless it
  // is the home leg (Singapore). From = arrival at that city; To = the next leg's departure onward
  // (the last stop ends at the trip's end date). Nights = (To − From) in days; ODA days = nights. ----
  const home = 'SIN';
  const legs = req.legs.filter((l) => l.travellerId === null && !l.isPersonal).sort((a, b) => a.seq - b.seq);
  type Stop = { legSeq: number; city: string; country: string; from: Date; to: Date; nights: number };
  const stops: Stop[] = [];
  for (let i = 0; i < legs.length; i++) {
    const l = legs[i];
    const city = EcsReference.airport(l.destCode)?.cityCode ?? l.destCode;
    if (!city || city === home) continue; // the return-home leg is not a stop
    const from = l.arriveDate ?? l.departDate ?? null;
    const next = legs[i + 1];
    const to = next?.departDate ?? next?.arriveDate ?? req.endDate ?? null;
    if (!from || !to) continue;
    const nights = Math.max(Math.round((to.getTime() - from.getTime()) / DAY), 0);
    if (nights <= 0) continue;
    const country = EcsReference.city(city)?.countryCode ?? req.destCountry ?? '';
    stops.push({ legSeq: l.seq, city, country, from, to, nights });
  }

  const guestIds = new Set(req.travellers.filter((t) => t.travellerType === 'GUEST' || t.employeeId.startsWith('G-')).map((t) => t.employeeId));
  const hotelTids: (string | null)[] = req.isGroup ? req.travellers.map((t) => t.employeeId) : [null];
  // §8 ODA is an employee entitlement only — guests get none.
  const odaTids: (string | null)[] = req.isGroup
    ? req.travellers.filter((t) => !guestIds.has(t.employeeId)).map((t) => t.employeeId)
    : (isGuestRequest(req) ? [] : [null]);

  // ---- HOTEL: one line per stop × traveller (city cap × nights; nightly rate editable) ----
  const autoHotels = req.expenses.filter((e) => e.autoDerived && e.category === EXPENSE_CATEGORY.Accommodation);
  const wantHotel = new Set<string>();
  for (const tid of hotelTids) for (const s of stops) {
    wantHotel.add(key(tid, s.legSeq));
    const existing = autoHotels.find((e) => (e.travellerId ?? '') === (tid ?? '') && e.accommodation?.legSeq === s.legSeq);
    const cap = EcsPolicy.hotelCap(s.city) ?? 0;
    const rate = (!resetRates && existing?.accommodation?.quotedNightly ? existing.accommodation.quotedNightly : cap) || cap;
    const calc = computeAccommodation({ cityCode: s.city, nights: s.nights, personalNights: 0, quotedNightly: rate, basis: settings.hotelEstimateBasis });
    const accData = { city: s.city, legSeq: s.legSeq, checkIn: s.from, checkOut: s.to, nights: s.nights, personalNights: 0, quotedNightly: rate, capNightly: calc.capNightly, budgetedNightly: calc.budgetedNightly, capVariance: calc.capVariance, exceptionOutcome: calc.outcome };
    if (existing) {
      await prisma.estimatedExpense.update({ where: { id: existing.id }, data: { sgdAmount: calc.sgdAmount, foreignAmount: calc.sgdAmount, estimateBasis: settings.hotelEstimateBasis, expectedDate: s.from } });
      await prisma.accommodationEstimate.update({ where: { expenseId: existing.id }, data: accData });
    } else {
      const exp = await prisma.estimatedExpense.create({ data: { requestId: id, category: EXPENSE_CATEGORY.Accommodation, expenseTypeId: 'ET-ACC', currency: 'SGD', foreignAmount: calc.sgdAmount, sgdAmount: calc.sgdAmount, estimateBasis: settings.hotelEstimateBasis, expectedDate: s.from, autoDerived: true, travellerId: tid } });
      await prisma.accommodationEstimate.create({ data: { expenseId: exp.id, conferenceHotel: false, ...accData } });
    }
  }
  for (const e of autoHotels) if (!wantHotel.has(key(e.travellerId, e.accommodation?.legSeq))) await prisma.estimatedExpense.delete({ where: { id: e.id } });

  // ---- ODA: one line per stop × employee traveller (country daily rate × nights, FULL day rate, no
  // proportioning). A country with no configured ODA rate yields no line. ----
  const autoOda = req.expenses.filter((e) => e.autoDerived && e.category === EXPENSE_CATEGORY.ODA);
  const wantOda = new Set<string>();
  for (const tid of odaTids) for (const s of stops) {
    const dailyRate = EcsPolicy.odaRate(s.country) ?? 0;
    if (dailyRate <= 0) continue;
    wantOda.add(key(tid, s.legSeq));
    // §13.7 ECS duration tiers: days 1–15 @ 100%, 16–31 @ 75%, 32+ at the monthly allowance rate.
    const monthlyRate = EcsPolicy.odaMonthlyRate(s.country) ?? 0;
    const calc = computeOdaTiered({ days: s.nights, dailyRate, monthlyRate });
    const amount = calc.sgdAmount;
    const ratePct = s.nights > 0 ? Math.round((amount / (s.nights * dailyRate)) * 100) : 100;
    const existing = autoOda.find((e) => (e.travellerId ?? '') === (tid ?? '') && e.oda?.legSeq === s.legSeq);
    const odaData = { country: s.country, city: s.city, legSeq: s.legSeq, arrive: s.from, depart: s.to, eligibleDays: s.nights, personalDays: 0, dailyRate, ratePct };
    if (existing) {
      await prisma.estimatedExpense.update({ where: { id: existing.id }, data: { sgdAmount: amount, foreignAmount: amount, expectedDate: s.from } });
      await prisma.oDAEstimate.update({ where: { expenseId: existing.id }, data: odaData });
    } else {
      const exp = await prisma.estimatedExpense.create({ data: { requestId: id, category: EXPENSE_CATEGORY.ODA, expenseTypeId: 'ET-ODA', currency: 'SGD', foreignAmount: amount, sgdAmount: amount, estimateBasis: 'RATE', expectedDate: s.from, autoDerived: true, travellerId: tid } });
      await prisma.oDAEstimate.create({ data: { expenseId: exp.id, ...odaData } });
    }
  }
  for (const e of autoOda) if (!wantOda.has(key(e.travellerId, e.oda?.legSeq))) await prisma.estimatedExpense.delete({ where: { id: e.id } });

  revalidatePath(`/requests/${id}/estimates`);
}

/** DD-19 Set the hotel payment channel: CTA (central-billed, reference-only in the claim) vs
 *  INDIVIDUAL (employee pays & claims). CTA is only accepted for a TMC arrangement — a self-
 *  arranged room cannot be central-billed — otherwise it is forced to INDIVIDUAL. Airfare is
 *  always central; ODA is always individual; this toggle covers the hotel only. Applies to
 *  individual and group bookings alike (whole-trip, all hotel lines). */
export async function setHotelSettlement(id: string, fd: FormData) {
  if (!(await requireEdit(id))) return;
  const req = await loadRequest(id);
  if (!req) return;
  const value = str(fd, 'hotelSettlement') === 'CTA' && isTmcArrangement(req.bookingArrangement) ? 'CTA' : 'INDIVIDUAL';
  await prisma.travelRequest.update({ where: { id }, data: { hotelSettlement: value } });
  await audit(id, 'AMEND', `Hotel payment channel set to ${value === 'CTA' ? 'Central Travel Account (CTA)' : 'Individual (employee claim)'}`);
  revalidatePath(`/requests/${id}/estimates`);
}

/** Edit ONLY the nightly rate of an auto hotel line (the stay — nights/dates — is derived from the
 *  itinerary and stays locked). The line remains auto-derived, so a later dates change re-derives it
 *  back to policy (resetting this edit) per the agreed behaviour. */
export async function updateAccommodationRate(id: string, expenseId: string, fd: FormData) {
  if (!(await requireEdit(id))) return;
  const settings = await getSettings();
  const rate = num(fd, 'quotedNightly');
  if (rate <= 0) redirect(`/requests/${id}/estimates?error=${encodeURIComponent('Nightly rate must be greater than 0.')}`);
  const acc = await prisma.accommodationEstimate.findUnique({ where: { expenseId } });
  if (!acc) return;
  const calc = computeAccommodation({ cityCode: acc.city, nights: acc.nights, personalNights: acc.personalNights, quotedNightly: rate, basis: settings.hotelEstimateBasis });
  // §4.5 an above-cap rate carries a mandatory justification (also hard-stopped at submit by the
  // HOTEL_JUSTIFY policy check). Captured here on the line's note; cleared when at/under cap.
  const justification = str(fd, 'justification').trim();
  const overCap = calc.capNightly > 0 && rate > calc.capNightly;
  await prisma.estimatedExpense.update({ where: { id: expenseId }, data: { sgdAmount: calc.sgdAmount, foreignAmount: calc.sgdAmount, notes: justification || null } });
  await prisma.accommodationEstimate.update({ where: { expenseId }, data: { quotedNightly: rate, budgetedNightly: calc.budgetedNightly, capVariance: calc.capVariance, exceptionOutcome: calc.outcome } });
  await audit(id, 'AMEND', `Hotel nightly rate updated for ${EcsReference.city(acc.city)?.name ?? acc.city} → SGD ${rate.toFixed(0)}/night${overCap ? (justification ? ' (above cap — justification provided)' : ' (above cap — justification required)') : ''}`);
  revalidatePath(`/requests/${id}/estimates`);
}

export async function addOther(id: string, fd: FormData) {
  if (!(await requireEdit(id))) return;
  const currency = str(fd, 'currency') || 'SGD';
  const foreign = num(fd, 'amount');
  if (foreign <= 0) redirect(`/requests/${id}/estimates?error=${encodeURIComponent('Amount must be greater than 0.')}`);
  const typeId = str(fd, 'expenseTypeId') || 'ET-OTH';
  const type = EcsReference.expenseType(typeId);
  const isShared = str(fd, 'shared') === 'on';
  const tids = isShared ? [null] : await travellerFanout(id, fd);
  for (const tid of tids) {
    await prisma.estimatedExpense.create({
      data: {
        requestId: id, category: type?.category ?? EXPENSE_CATEGORY.Other, expenseTypeId: typeId,
        currency, foreignAmount: foreign, sgdAmount: EcsFx.toSgd(foreign, currency, new Date()),
        estimateBasis: 'QUOTED', notes: str(fd, 'notes'),
        travellerId: tid,
        isShared,
      },
    });
  }
  await audit(id, 'AMEND', `${type?.name ?? 'Other'} estimate added${tids.length > 1 ? ` — one per traveller (${tids.length})` : ''}`);
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
  const draft = str(fd, 'saveMode') === 'draft'; // "Save as draft" → persist then return to the dashboard
  const req = await prisma.travelRequest.findUnique({ where: { id }, include: { expenses: { include: { accommodation: true, oda: true } } } });
  if (!req) return;
  const settings = await getSettings();
  const ntuFunded = computeSummary(req.expenses, settings.approvalAmountBasis).ntuFunded;
  const raw = resolveChargingRows(fd, req.expenses, ntuFunded, EcsIdentity.employee(req.travellerId)?.defaultChargingCode ?? '');

  // §17 ITEM mode persists each line's (possibly multi-account) split; other modes clear them.
  if (raw.mode === 'ITEM') {
    for (const e of req.expenses) {
      const allocs = raw.lineAllocs[e.id] ?? [];
      await prisma.estimatedExpense.update({
        where: { id: e.id },
        data: {
          chargingCode: raw.lineMap[e.id] || null,
          allocJson: allocs.length > 1 ? JSON.stringify(allocs) : null, // store only genuine splits
        },
      });
    }
  } else {
    await prisma.estimatedExpense.updateMany({ where: { requestId: id }, data: { chargingCode: null, allocJson: null } });
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
  // #14 resolve the M6 account on NTU-funded upgrade lines (auto when the governing BA has one;
  // left unset — hard stop — when a choice is required) before re-running policy.
  await applyDefaultDeltaCodes(id);
  await persistPolicy(id);
  if (draft) { await audit(id, 'STATUS', 'Saved as draft'); revalidatePath('/dashboard'); redirect('/dashboard'); }
  revalidatePath(`/requests/${id}/charging`);
  redirect(`/requests/${id}/policy`);
}

/** #14 Set (or clear) the traveller-selected M6 account for an NTU-funded upgrade airfare line, from
 *  the Charging step. Validates the account belongs to the line's governing BA, then re-runs policy so
 *  the hard stop clears without leaving the page. */
export async function setUpgradeDeltaAccount(id: string, expenseId: string, code: string) {
  if (!(await requireEdit(id))) return;
  const req = await prisma.travelRequest.findUnique({ where: { id }, include: { allocations: true } });
  const exp = await prisma.estimatedExpense.findUnique({ where: { id: expenseId } });
  if (!req || !exp || exp.requestId !== id) return;
  const govBA = (req.allocations.find((a) => a.isMain) ?? req.allocations[0])?.businessArea ?? null;
  const pool = accountsForBA(await listUpgradeAccounts(), govBA);
  const next = code && pool.some((a) => a.code === code) ? code : null;
  await prisma.estimatedExpense.update({ where: { id: expenseId }, data: { upgradeDeltaCode: next } });
  await audit(id, 'AMEND', next ? `Upgrade differential routed to ${next}` : 'Upgrade differential account cleared');
  await persistPolicy(id);
  revalidatePath(`/requests/${id}/charging`);
  revalidatePath(`/requests/${id}/policy`);
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
  await assignGroupLineNos(id); // §13.14 freeze group line numbers (TA/0n) at submission
  const settings = await getSettings();

  // §13.x duplicate guard — block if a LIVE request already covers the same traveller(s), the
  // same destination and overlapping dates (prevents two live authorisations / TAs for one trip
  // after a re-raise). The traveller must cancel or amend the original first.
  const blocking = await findBlockingDuplicates(req);
  if (blocking.length) {
    const d = blocking[0];
    await audit(id, 'STATUS', `Submission blocked — duplicate of ${d.requestNumber} (${d.status})`);
    redirect(`/requests/${id}/review?error=${encodeURIComponent(`This trip duplicates an active request ${d.requestNumber} (${d.status}) — same traveller, ${d.destination}, overlapping dates ${d.dates}. Cancel or amend ${d.requestNumber} before resubmitting.`)}`);
  }

  // §4.4 a destination is MANDATORY for every travel request (all lanes) — the approver, the
  // policy engine and the TMC all key off it. Block submission when none has been captured.
  if (!req.destCity || !req.destCountry) {
    await audit(id, 'STATUS', 'Submission blocked — a destination is required');
    redirect(`/requests/${id}/review?error=${encodeURIComponent('A destination is required before submitting. Add the destination / itinerary on the Trip step.')}`);
  }

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
    // §13.x / DD-23 Emergency lane (book first, raise later) — a bounded, audited lane that changes
    // the TIMING of approval, not the SET of approvers: it needs a justification and a named
    // authorising officer (never the traveller) plus the authorising e-mail, and it permits a
    // book-first hand-off before approval. The FULL approval workflow still runs, retrospectively.
    if (str(fd, 'emergency') === 'on') {
      const ej = str(fd, 'emergencyJustification').trim();
      const ea = str(fd, 'emergencyAuthoriserId');
      if (!ej || !ea || ea === req.travellerId) {
        await audit(id, 'STATUS', 'Submission blocked — emergency lane requires a justification and an authorising officer (not the traveller)');
        redirect(`/requests/${id}/review?error=${encodeURIComponent('The emergency lane needs a justification and an authorising officer (not the traveller).')}`);
      }
      // §13.x / DD-23 the book-first lane is only for a TMC channel where an agent can hold/place a
      // booking ahead of approval — agent-assisted or offline. Block with guidance otherwise.
      if (!emergencyMethodAllowed(req)) {
        await audit(id, 'STATUS', `Submission blocked — emergency lane requires an agent-assisted or offline TMC booking (is ${req.bookingMethod ?? 'none'})`);
        redirect(`/requests/${id}/review?error=${encodeURIComponent('The emergency lane is only available for TMC agent-assisted or offline bookings — a human agent must be able to book ahead of approval. Change the booking method on the Trip step to agent-assisted or offline.')}`);
      }
      // §13.x / DD-23 a mandatory email approval (the authorising officer's e-mail) must be attached.
      if (!hasEmergencyApproval(req)) {
        await audit(id, 'STATUS', 'Submission blocked — emergency lane requires the authorising email approval to be attached');
        redirect(`/requests/${id}/review?error=${encodeURIComponent('Attach the mandatory email approval (the authorising officer’s e-mail) before submitting an emergency request.')}`);
      }
      // §13.x / DD-23 soft lead-time gate — within the configured window the lane is freely
      // available; outside it (ample runway to the earliest departure) a fuller justification and
      // an explicit confirmation are mandatory, and the request is flagged outside-window.
      const outsideWindow = !withinEmergencyWindow(req, settings.emergencyLeadDays);
      if (outsideWindow) {
        const ack = str(fd, 'emergencyOutOfWindowAck') === 'on';
        if (!ack || ej.length < EMERGENCY_OOW_MIN_JUSTIFICATION) {
          const lead = leadTimeDays(req);
          await audit(id, 'STATUS', `Submission blocked — emergency outside the ${settings.emergencyLeadDays}-day window (departs in ${lead ?? '—'} days) needs a detailed justification and the out-of-window confirmation`);
          redirect(`/requests/${id}/review?error=${encodeURIComponent(`This trip departs in about ${lead ?? '—'} day(s) — beyond the ${settings.emergencyLeadDays}-day standard window. Using the emergency lane here needs a detailed justification (at least ${EMERGENCY_OOW_MIN_JUSTIFICATION} characters) and the explicit out-of-window confirmation.`)}`);
        }
      }
      // §13.x the full workflow runs — preserve the traveller's selected DOA / additional approver.
      await prisma.travelRequest.update({ where: { id }, data: {
        isEmergency: true, isRetrospective: false, emergencyOutsideWindow: outsideWindow,
        emergencyJustification: ej, emergencyAuthoriserId: ea, emergencyRatified: false,
        additionalApproverId: aaId, selectedDoaId: str(fd, 'selectedDoaId') || null, personalAck, highRiskAck,
      } });
    } else {
      // §13.14 the traveller must select the approving DOA from the eligible candidates.
      const approvalAmount = computeSummary(req.expenses, settings.approvalAmountBasis).approvalAmount;
      const candidates = doaCandidatesFor(req, { approvalAmount, sameRouteResearch: settings.sameRouteResearch });
      const selDoa = str(fd, 'selectedDoaId');
      const doaOk = candidates.length === 0 || candidates.some((c) => c.id === selDoa);
      if (!doaOk) {
        await audit(id, 'STATUS', 'Submission blocked — please select the approving DOA');
        redirect(`/requests/${id}/review?error=${encodeURIComponent('Please select the approving DOA.')}`);
      }
      await prisma.travelRequest.update({ where: { id }, data: { isEmergency: false, emergencyOutsideWindow: false, additionalApproverId: aaId, selectedDoaId: selDoa || null, personalAck, highRiskAck } });
    }
  }

  // §13.4 lock foreign-currency estimates to the SGD rate effective on the submission date.
  const submitDate = new Date();
  const relocked = await relockFx(req, submitDate);
  if (relocked > 0) await audit(id, 'AMEND', `FX locked at submission — ${relocked} foreign-currency line(s) re-converted at the ${submitDate.toISOString().slice(0, 7)} rate (§13.4)`);

  // §8 a guest must carry no shared-incidental slice and no ODA — block submission if any
  // line attributes such cost to a guest (data-level safety net for the exclusion logic).
  const guestErrs = guestAttributionViolations(req);
  if (guestErrs.length) {
    await audit(id, 'STATUS', `Submission blocked — ${guestErrs[0]}`);
    redirect(`/requests/${id}/review?error=${encodeURIComponent(guestErrs[0])}`);
  }

  // Re-run policy (on the locked amounts); block on hard stop (AC06).
  const { hardStop } = await persistPolicy(id);
  if (hardStop) {
    revalidatePath(`/requests/${id}/review`);
    return; // UI shows the hard stops and disables submit
  }

  const fresh = await loadRequest(id);
  if (!fresh) return;
  const summary = computeSummary(fresh.expenses, settings.approvalAmountBasis);
  // §8 / DD-25 a GUEST travel-class upgrade routes to the selected host-school Provost ahead of
  // the DOA; that upgrade is the Provost's to authorise, so it is excluded from the generic
  // Exception step (other exceptions still insert one).
  const exceptionsOnReq = fresh.policyChecks.filter((c) => c.outcome === POLICY_OUTCOME.Exception);
  const travellerIds = fresh.isGroup ? fresh.travellers.map((t) => t.employeeId) : [fresh.travellerId];
  const guestUpgrade = isGuestRequest(fresh) && !fresh.isGroup && exceptionsOnReq.some((c) => c.code === 'CLASS');
  const guestUpgradeProvostId = guestUpgrade && fresh.provostId && !travellerIds.includes(fresh.provostId) ? fresh.provostId : null;
  const routeHasException = (guestUpgrade ? exceptionsOnReq.filter((c) => c.code !== 'CLASS') : exceptionsOnReq).length > 0;
  const steps = buildRoute(fresh, {
    exceptionApproverRequired: settings.exceptionApproverRequired,
    sameRouteResearch: settings.sameRouteResearch,
    approvalAmount: summary.approvalAmount,
    hasException: routeHasException,
    roRequirement: settings.roRequirement,
    guestUpgradeProvostId,
    researchPiSelfApproval: settings.researchPiSelfApproval,
    selfApprovalLimitSgd: settings.selfApprovalLimitSgd,
    emergency: fresh.isEmergency ? { authoriserId: fresh.emergencyAuthoriserId, retrospective: fresh.isRetrospective } : undefined,
    workflowScenario: await getActiveWorkflowScenario(),
  });
  // #1 Research PI self-approval — the DOA step is the traveller (the PI). When the PI raised the
  // request themselves, that step is auto-granted on submission; a delegate-raised one stays Pending
  // for the PI to approve from their queue.
  const travellerIsRequestor = fresh.requestorId === fresh.travellerId;
  const isPiSelfStep = (s: typeof steps[number]) => s.approverId === fresh.travellerId && s.roleType === APPROVER_ROLE.ResearchDOA && (s.note ?? '').includes('PI self-approval');
  const autoGrant = (s: typeof steps[number]) => travellerIsRequestor && isPiSelfStep(s);
  const pending = steps.filter((s) => !autoGrant(s));
  const firstStatus = pending.length ? statusForStep(pending[0].roleType) : REQUEST_STATUS.Approved;
  // Atomic: approval amount + rebuilt route + status move together (no half-built route).
  await prisma.$transaction([
    prisma.travelRequest.update({ where: { id }, data: { approvalAmountSgd: summary.approvalAmount } }),
    prisma.approvalStep.deleteMany({ where: { requestId: id } }),
    ...steps.map((s) => prisma.approvalStep.create({ data: { requestId: id, seq: s.seq, roleType: s.roleType, approverId: s.approverId, comments: autoGrant(s) ? `${s.note ?? ''} — self-approved on submission` : s.note, status: autoGrant(s) ? 'Approved' : 'Pending', decidedAt: autoGrant(s) ? new Date() : null } })),
    prisma.travelRequest.update({ where: { id }, data: { status: firstStatus } }),
  ]);

  await snapshot(fresh, 'SUBMISSION', false);
  const routeText = steps.map((s) => autoGrant(s) ? `${s.roleType} (self-approved)` : s.roleType).join(' → ');
  await audit(id, 'SUBMIT', `Submitted for approval — routed to ${routeText}`, req.requestorId !== req.travellerId ? req.travellerId : null);
  // If the PI self-approval cleared the only step, finalize now (issue the Travel Authorisation + hand-off).
  if (!pending.length) await finalizeApproval(id);

  // §4.8 notify the risk office when a high-risk destination is involved.
  if (highRisk) {
    const names = highRiskDestinationsForRequest(fresh).map((h) => `${h.name} (${h.riskLevel})`).join(', ');
    await audit(id, 'STATUS', `High-risk travel — ${names}; traveller acknowledged, Risk Management Office notified (§4.8)`);
  }

  // §13.x / DD-23 emergency = book first, raise later: hand off to the TMC automatically on
  // submit, ahead of the (now retrospective) approval workflow. Travel Admin does not trigger it.
  // handoffToTmc is idempotent and its emergency branch relaxes the "must be approved" gate.
  if (fresh.isEmergency) await handoffToTmc(id);

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

// §34 A TMC booking is "live" (handed off / in flight / ticketed) when it must be cancelled
// through the TMC rather than locally. A FAILED booking never ticketed, so it has nothing live
// to cancel at the TMC (it is cancelled locally, like a not-yet-sent request).
const TMC_LIVE_BOOKING_STATUSES: string[] = [BOOKING_STATUS.SentToTMC, BOOKING_STATUS.Booked, ...TMC_INFLIGHT_STATUSES];

/** §34 Cancel an approved/expired request (or one in amendment), with the two-way booking
 *  lifecycle (DD-22):
 *   • before hand-off / no live booking (Not Sent, Self-Booked, Failed) → cancel LOCALLY,
 *     booking straight to Cancelled, no TMC message and no fee;
 *   • after transmitted / booked → send a TMC cancellation REQUEST and hold the booking at
 *     "Cancellation Requested"; the actual fee/refund is settled when the TMC confirms
 *     (receiveCancellation). The request's authorisation is voided immediately either way,
 *     so the duplicate guard no longer blocks a re-raise. */
export async function cancelRequest(id: string, fd?: FormData) {
  const req = await loadRequest(id);
  if (!req) return;
  if (!actionAllowed('cancel', req.status)) { await audit(id, 'STATUS', `Cancel blocked — request is ${req.status}`); return; }
  const reason = fd ? str(fd, 'reason') : '';
  // Void the authorisation now (frees a re-raise past the duplicate guard) and skip pending steps.
  await prisma.travelRequest.update({ where: { id }, data: { status: REQUEST_STATUS.Cancelled } });
  await prisma.approvalStep.updateMany({ where: { requestId: id, status: 'Pending' }, data: { status: 'Skipped' } });

  const liveBooking = TMC_LIVE_BOOKING_STATUSES.includes(req.bookingStatus);
  if (liveBooking) {
    // Two-way: send the cancellation REQUEST to the TMC; the fee/refund is unknown until the
    // TMC confirms, so the booking waits at "Cancellation Requested" (not yet Cancelled).
    const booking = req.bookings.find((b) => b.channel === 'TMC');
    const cancelRef = `CXL-${booking?.pnr ?? req.authorisationNo?.replace(/\D/g, '').slice(-4) ?? '0000'}`;
    const meta = { messageId: randomUUID(), sentAt: new Date().toISOString(), sourceStatus: req.bookingStatus, contractVersion: CONTRACT_VERSION };
    await prisma.integrationMessage.create({ data: { requestId: id, direction: 'OUTBOUND', kind: 'TMC_CANCEL', payload: JSON.stringify({ meta, documentType: 'BOOKING_CANCEL_REQUEST', authorisationNumber: req.authorisationNo, cancelRef, pnr: booking?.pnr ?? null, wasTicketed: !!booking?.ticketNo, reason: reason || 'Request cancelled', requestedAt: meta.sentAt }, null, 2) } });
    await prisma.travelRequest.update({ where: { id }, data: { bookingStatus: BOOKING_STATUS.CancellationRequested } });
    await audit(id, 'INTEGRATION', `TMC cancellation requested — ${cancelRef}${booking?.pnr ? ` (PNR ${booking.pnr})` : ''}; awaiting confirmation`);
  } else {
    // No live TMC booking (Not Sent before hand-off, Self-Booked, or Failed): nothing to cancel
    // at the TMC — close the booking locally with no cancellation message and no fee.
    await prisma.travelRequest.update({ where: { id }, data: { bookingStatus: BOOKING_STATUS.Cancelled } });
    if (req.bookingStatus !== BOOKING_STATUS.NotSent) await audit(id, 'INTEGRATION', `Booking cancelled locally — no live TMC booking (${req.bookingStatus})`);
  }
  await audit(id, 'STATUS', `Request cancelled${reason ? `: ${reason}` : ''}`);
  revalidatePath(`/requests/${id}`);
  revalidatePath(`/requests/${id}/booking`);
  revalidatePath('/dashboard');
  redirect(`/requests/${id}`);
}

/** §34 Inbound: the TMC confirms a cancellation it was asked to make (two-way close-out,
 *  DD-22). Settles the actual airline/TMC cancellation fee and any refund, then marks the
 *  booking Cancelled. Only valid while a cancellation is in flight. */
export async function receiveCancellation(id: string, fd?: FormData) {
  const req = await loadRequest(id);
  if (!req) return;
  if (req.bookingStatus !== BOOKING_STATUS.CancellationRequested) {
    await audit(id, 'INTEGRATION', `Cancellation confirmation ignored — booking is ${req.bookingStatus}, no cancellation in flight`);
    revalidatePath(`/requests/${id}/booking`);
    return;
  }
  const booking = req.bookings.find((b) => b.channel === 'TMC');
  const ticketed = !!booking?.ticketNo;
  // Mock airline/TMC settlement: a ticketed fare incurs a cancellation penalty and refunds the
  // balance; an un-ticketed in-flight booking is voided at no cost.
  const booked = (booking?.fare ?? 0) + (booking?.taxes ?? 0) + (booking?.fees ?? 0);
  const feeSgd = ticketed ? 75 : 0;
  const refundSgd = ticketed ? Math.max(Math.round((booked - feeSgd) * 100) / 100, 0) : 0;
  const cancelOut = req.messages.find((m) => m.kind === 'TMC_CANCEL');
  const cancelRef = (() => { try { return cancelOut ? JSON.parse(cancelOut.payload).cancelRef : null; } catch { return null; } })()
    ?? `CXL-${booking?.pnr ?? req.authorisationNo?.replace(/\D/g, '').slice(-4) ?? '0000'}`;
  const correlationId = (() => { try { return cancelOut ? JSON.parse(cancelOut.payload).meta?.messageId ?? null : null; } catch { return null; } })();
  const meta = { messageId: randomUUID(), receivedAt: new Date().toISOString(), correlationId, sourceStatus: req.status, contractVersion: CONTRACT_VERSION };
  await prisma.$transaction(async (tx) => {
    await tx.integrationMessage.create({ data: { requestId: id, direction: 'INBOUND', kind: 'TMC_CANCEL_CONFIRM', payload: JSON.stringify({ meta, documentType: 'BOOKING_CANCEL_CONFIRMATION', authorisationNumber: req.authorisationNo, cancelRef, pnr: booking?.pnr ?? null, ticketVoided: ticketed, cancellationFeeSgd: feeSgd, refundSgd, confirmedAt: meta.receivedAt }, null, 2) } });
    await tx.travelBooking.updateMany({ where: { requestId: id, channel: 'TMC' }, data: { status: BOOKING_STATUS.Cancelled } });
    await tx.travelRequest.update({ where: { id }, data: { bookingStatus: BOOKING_STATUS.Cancelled } });
  });
  // DD-31 reverse the CTA postings using the feed's split: the refund reverses, the penalty stays.
  await reverseCtaChargesForRequest(id, { penaltySgd: feeSgd, dateIso: meta.receivedAt.slice(0, 10) });
  await audit(id, 'INTEGRATION', `TMC confirmed cancellation — ${cancelRef}${feeSgd ? `, fee SGD ${feeSgd}, refund SGD ${refundSgd}` : ' (no fee)'}`);
  revalidatePath(`/requests/${id}`);
  revalidatePath(`/requests/${id}/booking`);
  revalidatePath('/dashboard');
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
  // §13.9 parameter filters — only hand off when the outbound guards all pass. Exception: a
  // §13.x / DD-23 emergency book-first request may be handed off before full approval, on the
  // named authorising officer's authority, with the DOA ratification still pending (audited).
  const gate = evaluateFlow(req, 'OUTBOUND', await getGuardSettings());
  const emergencyBookFirst = req.isEmergency && !!req.emergencyAuthoriserId; // book first, raise later (DD-23)
  if (!gate.ok && !emergencyBookFirst) {
    await audit(id, 'INTEGRATION', `Hand-off blocked by contract filter — ${gate.checks.filter((c) => !c.pass).map((c) => `${c.rule} (is ${c.actual})`).join('; ')}`);
    revalidatePath(`/requests/${id}/booking`);
    return;
  }
  if (!gate.ok && emergencyBookFirst) {
    await audit(id, 'INTEGRATION', `Emergency book-first — authorised by ${EcsIdentity.employee(req.emergencyAuthoriserId ?? '')?.name ?? req.emergencyAuthoriserId}; handing off before DOA ratification (DD-23)`);
  }
  // §13.9 / DD-18 Deterministic hand-off routing — the TMC channel follows the itinerary's
  // determinism (straight-through online only when nothing needs an agent). Enforced on the
  // outbound instruction so the TMC receives it on the correct channel.
  const routing = assessHandoffRouting(req);
  if (req.bookingMethod !== routing.channel) {
    await prisma.travelRequest.update({ where: { id }, data: { bookingMethod: routing.channel } });
    req.bookingMethod = routing.channel; // reflect in the payload build below
    await audit(id, 'INTEGRATION', `Hand-off channel ${routing.deterministic ? 'deterministic → straight-through' : 'forced to agent/offline'} — ${channelLabel(routing.channel)}${routing.reasons.length ? `: ${routing.reasons.join('; ')}` : ''}`);
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

  // §13.x A traveller's trip may be ticketed as MULTIPLE PNRs (DD-17) — a multi-city itinerary
  // is commonly split by the TMC across PNRs for competitive fares. Each instruction therefore
  // expands to one-or-more PNRs (each its own booking row), keeping 1 request → 1 claim.
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const multiCity = req.tripType === 'MULTI_CITY';
  // §7.3 re-point a booking's trace onto ITS OWN (suffixed) pnr + e-ticket, so each per-traveller /
  //  per-PNR booking's segment → PNR → ticket trace matches the booking row (not the base feed values).
  const applyTrace = (inb: CanonicalInbound): CanonicalInbound => {
    const tkt = inb.ticketNumbers[0];
    inb.segments = inb.segments.map((s) => ({ ...s, pnr: inb.pnr, ...(s.ticketNumber ? { ticketNumber: tkt } : {}) }));
    if (inb.charges) inb.charges = inb.charges.map((c) => ({ ...c, pnr: inb.pnr, ...(c.ticketNumber ? { ticketNumber: tkt } : {}) }));
    return inb;
  };
  const inbounds = instructions.flatMap((inst, i) => {
    const sim = adapter.simulateInbound(inst as never, { overFarePct });
    const travellerId = (inst as { travellerRef?: string }).travellerRef ?? null;
    // §13.14 the traveller's frozen group line number (TA/0n) — denotes which traveller in the group;
    // the per-traveller PNR is suffixed by it so each booking is distinguishable at a glance.
    const lineNo = isFanout ? ((inst as { instructionSeq?: number }).instructionSeq ?? i + 1) : null;
    const suffix = isFanout ? `-${lineNo}` : '';
    const air = sim.segments.filter((s) => s.type === 'AIR');
    const hotel = sim.segments.filter((s) => s.type === 'HOTEL');
    // Split a genuine multi-city itinerary into two PNRs (air split by journey; hotel on PNR A).
    if (multiCity && air.length >= 3) {
      const mid = Math.ceil(air.length / 2);
      const sh = mid / air.length;
      const mk = (tag: string, segs: typeof sim.segments, f: number, t: number, e: number) => ({ travellerId, lineNo, inbound: applyTrace({
        ...sim, pnr: `${sim.pnr}${suffix}-${tag}`, ticketNumbers: sim.ticketNumbers.map((tk: string) => `${tk}${suffix}-${tag}`),
        segments: segs, fareSgd: f, taxesSgd: t, feesSgd: e,
        // DD-31: the feed's charges[] carry the FULL-PNR amounts; on a multi-city split each PNR
        // instead derives its charges from its own split fare/taxes/fees (so amounts aren't doubled).
        charges: undefined,
      }) });
      return [
        mk('A', [...air.slice(0, mid), ...hotel], r2(sim.fareSgd * sh), r2(sim.taxesSgd * sh), r2(sim.feesSgd * sh)),
        mk('B', air.slice(mid), r2(sim.fareSgd * (1 - sh)), r2(sim.taxesSgd * (1 - sh)), r2(sim.feesSgd * (1 - sh))),
      ];
    }
    sim.pnr = `${sim.pnr}${suffix}`;
    sim.ticketNumbers = sim.ticketNumbers.map((tk: string) => `${tk}${suffix}`);
    return [{ travellerId, lineNo, inbound: applyTrace(sim) }];
  });

  // §6.4 booking-deviation check (AC10) — on the aggregate booked airfare.
  const tol = EcsPolicy.tolerances();
  const approvedAir = req.expenses.filter((e) => e.category === EXPENSE_CATEGORY.Airfare).reduce((s, e) => s + e.sgdAmount, 0);
  const bookedAir = inbounds.reduce((s, b) => s + b.inbound.fareSgd + b.inbound.taxesSgd + b.inbound.feesSgd, 0);
  const allowed = approvedAir + Math.min(approvedAir * tol.bookingFarePct / 100, tol.bookingFareAbsSgd);
  const deviation = approvedAir > 0 && bookedAir > allowed;

  const inboundMeta = { messageId: randomUUID(), receivedAt: new Date().toISOString(), correlationId: outbound.meta?.messageId ?? null, sourceStatus: req.status, contractVersion: CONTRACT_VERSION, tmc: providerId };
  // §13.x list form whenever there is more than one booking (a group fan-out, or multiple PNRs).
  const responsePayload = (isFanout || inbounds.length > 1)
    ? { meta: inboundMeta, mode: isFanout ? 'GROUP_FANOUT' : 'MULTI_PNR', authorisationNumber: req.authorisationNo ?? '', bookings: inbounds.map((b) => b.inbound) }
    : { ...inbounds[0].inbound, meta: inboundMeta };

  // Atomic: response + bookings + segments + deviation + status succeed or fail together.
  await prisma.$transaction(async (tx) => {
    await tx.integrationMessage.create({ data: { requestId: id, direction: 'INBOUND', kind: 'TMC_RESPONSE', tmcProviderId: providerId, payload: JSON.stringify(responsePayload, null, 2) } });
    for (const { travellerId, lineNo, inbound } of inbounds) {
      const booking = await tx.travelBooking.create({
        data: {
          requestId: id, travellerId, travellerLineNo: lineNo, tmcProviderId: providerId, pnr: inbound.pnr, invoiceNo: inbound.invoiceNumber ?? null, ticketNo: inbound.ticketNumbers[0], channel: 'TMC',
          fare: inbound.fareSgd, taxes: inbound.taxesSgd, fees: inbound.feesSgd,
          hotelRate: inbound.segments.find((s: { type: string }) => s.type === 'HOTEL')?.roomRateSgd, status: obtToEcsBookingStatus(inbound.bookingStatus),
          ctaAccountId: inbound.ctaAccountId ?? null,   // DD-30 feed-reported CTA account the central charges hit
          ctaCharged: inbound.ctaCharged ?? false, ctaChargeDate: inbound.ctaChargeDate ? new Date(inbound.ctaChargeDate) : null,
        },
      });
      for (const s of inbound.segments) {
        await tx.bookingSegment.create({ data: { bookingId: booking.id, type: s.type, originCode: s.origin, destCode: s.destination, bookedClassId: s.bookedClass, departDate: s.departDate ? new Date(s.departDate) : null, arriveDate: s.arriveDate ? new Date(s.arriveDate) : (s.departDate ? new Date(s.departDate) : null), amount: s.amountSgd ?? s.roomRateSgd, segmentRef: s.segmentRef ?? null, pnr: s.pnr ?? inbound.pnr, segmentStatus: s.segmentStatus ?? null, ticketNumber: s.ticketNumber ?? null, couponNumber: s.couponNumber ?? null } });
      }
      // DD-31 persist the feed's per-charge CTA breakdown — the authoritative basis for the SAP posting.
      for (const c of inbound.charges ?? []) {
        await tx.bookingCharge.create({ data: { bookingId: booking.id, type: c.type, expenseTypeId: c.expenseTypeId, amountSgd: c.amountSgd, gstCode: c.gstCode, gstAmountSgd: c.gstAmountSgd, gstClaimable: c.gstClaimable ?? true, pnr: c.pnr ?? inbound.pnr, ticketNumber: c.ticketNumber ?? null, segmentRef: c.segmentRef ?? null } });
      }
    }
    if (deviation) await tx.bookingDeviation.create({ data: { requestId: id, field: 'Airfare', approvedValue: approvedAir.toFixed(0), bookedValue: bookedAir.toFixed(0), material: true, action: 'Reapproval' } });
    await tx.travelRequest.update({ where: { id }, data: { bookingStatus: BOOKING_STATUS.Booked } });
  });
  await audit(id, 'INTEGRATION', isFanout
    ? `Inbound fan-out received — ${inbounds.length} booking(s) confirmed`
    : inbounds.length > 1
      ? `Inbound received — ${inbounds.length} PNRs (${inbounds.map((b) => b.inbound.pnr).join(', ')})`
      : `Inbound booking received — PNR ${inbounds[0].inbound.pnr}`);
  await postCtaChargesForRequest(id);   // DD-31 post settled CTA charges to SAP on receipt
  revalidatePath(`/requests/${id}/booking`);
}

/** DD-17 / §13.9 TA-keyed pull: re-fetch the latest bookings from the TMC for this request's
 *  Travel Authorisation (the "bookings by TA number" retrieval). Push (receiveBooking) is the
 *  primary feed; this is the fallback refresh for the freshest actuals. Idempotent — an
 *  already-received booking is not duplicated (receiveBooking no-ops once Booked). */
export async function refreshBookingsFromTmc(id: string) {
  const req = await loadRequest(id);
  if (!req) return;
  if (!req.authorisationNo) {
    await audit(id, 'INTEGRATION', 'Refresh from TMC skipped — no Travel Authorisation yet');
    revalidatePath(`/requests/${id}/booking`);
    return;
  }
  // Re-ingest any in-flight booking for this TA (idempotent). A self-booked or already-booked
  // request simply returns the current set without creating duplicates.
  await receiveBooking(id, new FormData());
  const set = bookingsForAuthorisation((await loadRequest(id))!);
  await audit(id, 'INTEGRATION', `Refreshed bookings from TMC by ${req.authorisationNo} — ${set.pnrCount} PNR(s) retrieved`);
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

/** §6.4 recovery after a failed booking — reopen the approved request for amendment and
 *  restart the approval route (the "update the TR and re-route" path), then land the traveller
 *  on the trip step to adjust the itinerary. The alternative recovery is cancel-and-re-raise. */
export async function amendAfterFailedBooking(id: string) {
  if (!(await requireEdit(id))) return;
  const req = await loadRequest(id);
  if (!req || req.bookingStatus !== BOOKING_STATUS.Failed) return;
  await applyMaterialAmendment(id, 'booking failed — itinerary reopened for amendment and re-approval');
  redirect(`/requests/${id}/trip`);
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
  // §4.13 the notification informs the HR officer configured in the module settings.
  const settings = await getSettings();
  const rec = visaLetterRecipient(settings);
  const d = (x: Date | null) => (x ? x.toISOString().slice(0, 10) : '—');
  let sent = 0;
  if (!rec.email) {
    await audit(null, 'INTEGRATION', 'Visa letter batch aborted — no HR officer email configured (§4.13)');
    revalidatePath('/visa-letters'); revalidatePath('/notifications');
    return;
  }
  for (const req of pending) {
    const city = EcsReference.city(req.destCity ?? '')?.name ?? req.destCity ?? '—';
    const country = EcsReference.country(req.destCountry ?? '')?.name ?? '';
    const payload = {
      documentType: 'VISA_LETTER_NOTIFICATION',
      to: `${rec.office} <${rec.email}>`,
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
    await audit(req.id, 'STATUS', `Visa letter notification sent to HR — ${rec.office} (${rec.email}) for ${req.authorisationNo} — daily batch (§4.13)`);
    sent++;
  }
  await audit(null, 'INTEGRATION', `Visa letter daily batch — ${sent} sent to HR (${rec.email}), ${pending.length} candidate(s) (§4.13)`);
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
  // §13.13 / DD-24 separation of duties — an approver-only persona may not originate a request.
  if (!canCreateTravelRequest(requestorId)) redirect(`/requests/new?error=${encodeURIComponent('You do not have authority to raise a travel request.')}`);
  const travellerIds = (fd.getAll('travellerIds') as string[]).map((s) => s.trim()).filter(Boolean);
  // §8 a group may also include guest members (non-employees), captured inline.
  let guests: { name: string; email?: string; org?: string }[] = [];
  try { guests = (JSON.parse(str(fd, 'guestsJson') || '[]') as typeof guests).filter((g) => g.name?.trim()); } catch { guests = []; }
  const total = travellerIds.length + guests.length;
  const settings = await getSettings();
  // §13.14 a group needs ≥2 members and may not exceed the configured TMC group-booking limit.
  if (total < 2) redirect(`/requests/new?error=${encodeURIComponent('A group needs at least two members.')}`);
  // §8 mixing guests into a group may be disabled in configuration — then a group is
  // employees-only and guests must be raised on a separate guest request.
  if (!settings.groupGuestMixAllowed && guests.length > 0) {
    redirect(`/requests/new?error=${encodeURIComponent('Guests cannot be added to a group booking — raise a separate guest request. (Mixing employees and guests is disabled in configuration.)')}`);
  }
  if (total > settings.groupMaxTravellers) redirect(`/requests/new?error=${encodeURIComponent(`A group booking is limited to ${settings.groupMaxTravellers} travellers (TMC group limit). You selected ${total}.`)}`);
  // §13.14 a group may name ANY employee traveller — cross-department routing and the per-member
  // inclusion confirmation (§13.13) are the controls, so the individual per-member remit check is
  // intentionally NOT applied here (it silently rejected cross-department members the UI offers).
  const invalidMembers = travellerIds.filter((t) => !EcsIdentity.employee(t)?.isTraveller);
  if (invalidMembers.length) redirect(`/requests/new?error=${encodeURIComponent('One or more selected members are not valid travellers.')}`);
  const sharePct = Math.round((100 / total) * 100) / 100;
  const guestRows = guests.map((g, i) => ({
    employeeId: `G-${Date.now().toString(36)}${i}`, travellerType: 'GUEST',
    guestName: g.name.trim(), guestEmail: g.email?.trim() || null, guestOrg: g.org?.trim() || null,
    isRequestor: false, confirmed: true, sharePct, // §13.13 host confirms the guest offline
  }));
  // Routing anchors on an employee member when present; department falls back to the host's.
  const primary = travellerIds[0] ?? requestorId;
  const primaryDept = EcsIdentity.employee(travellerIds[0] ?? '')?.departmentId ?? EcsIdentity.employee(requestorId)?.departmentId;
  const requestNumber = await nextRequestNumber(yr());
  const req = await prisma.travelRequest.create({
    data: {
      requestNumber, requestorId, travellerId: primary, isGroup: true,
      entityId: EcsIdentity.entity().id, departmentId: primaryDept,
      status: REQUEST_STATUS.Draft, bookingStatus: BOOKING_STATUS.NotSent,
      travellers: {
        create: [
          ...travellerIds.map((eid) => ({ employeeId: eid, travellerType: 'EMPLOYEE', isRequestor: eid === requestorId, confirmed: false, sharePct })),
          ...guestRows,
        ],
      },
    },
  });
  await audit(req.id, 'CREATE', `Group draft ${requestNumber} created for ${total} travellers${guests.length ? ` (incl. ${guests.length} guest${guests.length > 1 ? 's' : ''})` : ''}`, requestorId);
  redirect(`/requests/${req.id}/trip`);
}

export async function addGroupTraveller(id: string, fd: FormData) {
  const employeeId = str(fd, 'employeeId');
  if (!employeeId) return;
  const req = await loadRequest(id);
  if (!req || (!isFreeEditState(req.status) && !isAmendableState(req.status))) return;
  const exists = await prisma.travelRequestTraveller.findFirst({ where: { requestId: id, employeeId } });
  if (exists) return;
  // §13.14 a group booking may not exceed the configured TMC group-booking limit.
  const settings = await getSettings();
  if (req.travellers.length >= settings.groupMaxTravellers) return;
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
