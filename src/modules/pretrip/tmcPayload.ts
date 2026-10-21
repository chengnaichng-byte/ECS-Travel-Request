// Assembles the canonical outbound TMC payload from a full request, honouring the
// admin Integration Contract (`enabled` field-key set). Shared by the live hand-off
// action (handoffToTmc) and the Integration Contracts preview so both show the same
// governed payload.
//
// §9.3 group fan-out (AC15): a group hand-off is NOT one message — a single approval
// produces one booking instruction PER traveller, each carrying that traveller's own
// effective itinerary (sub-itinerary or the shared legs), class, nights and cost share.
import { buildOutbound } from '@/integrations/tmc/adapter';
import type { OutboundMeta, CanonicalOutbound } from '@/integrations/tmc/contract';
import { EcsIdentity, EcsReference, EcsCharging } from '@/shared/ecs/services';
import { sharedLegs, effectiveLegs, travellerNightsAtCity, computeTravellerShares, hasPersonalExtension } from './group';
import { isGuestRequest, travellerName, isGuestMember, memberName } from './traveller';
import { hostCostObject, lineSettlement } from './settlement';
import { isEmergencyBookFirst } from './emergency';
import { EXPENSE_CATEGORY, POLICY_OUTCOME } from '@/shared/enums';
import type { FullRequest } from './queries';

function guestBlock(req: FullRequest) {
  return isGuestRequest(req)
    ? { bookingFor: 'GUEST' as const, guest: { name: req.guestName ?? 'Guest', email: req.guestEmail, organisation: req.guestOrg } }
    : { bookingFor: 'EMPLOYEE' as const };
}

// §8 / DD-21 The sensitive travel-profile fields the TMC collects directly from the guest
// (via its secure link). ECS never stores these — only name, e-mail and organisation.
export const GUEST_PROFILE_FIELDS = [
  'Full name (as in passport)', 'Passport number & expiry', 'Nationality',
  'Date of birth', 'Mobile contact', 'Frequent-flyer / dietary (optional)',
];

/** §8 / DD-21 PDPA guest-profile indicator: tells the TMC to e-mail the guest a secure
 *  link to capture the fields above directly. ECS retains name/e-mail/organisation only. */
export function guestProfileBlock(email?: string | null) {
  return {
    collectVia: 'TMC_SECURE_LINK' as const,
    deliverTo: email ?? null,
    tmcCollectedFields: GUEST_PROFILE_FIELDS,
    ecsRetains: 'name, e-mail & organisation only',
  };
}

/** §29/§36 Charging / cost objects carried to the TMC (primary = largest share, which
 *  bears the direct airfare posting to ERP). */
export function chargingBlock(req: FullRequest) {
  const top = [...req.allocations].sort((a, b) => b.percent - a.percent)[0];
  return req.allocations.map((a) => {
    const c = EcsCharging.code(a.chargingCode);
    return { code: a.chargingCode, type: a.chargingType, businessArea: a.businessArea ?? c?.businessArea ?? null, companyCode: a.companyCode ?? c?.companyCode ?? null, percent: a.percent, isResearch: a.isResearch, primary: a.id === top?.id };
  });
}

/** §29 Approval metadata — who approved and when. */
function approvalsBlock(req: FullRequest) {
  return req.approvalSteps
    .filter((s) => s.status === 'Approved')
    .map((s) => ({ role: s.roleType, approver: EcsIdentity.employee(s.approverId ?? '')?.name ?? s.approverId ?? '—', decidedAt: s.decidedAt ? s.decidedAt.toISOString() : null }));
}

function requestPersonal(req: FullRequest): boolean {
  return req.personalStart != null || req.personalEnd != null || req.legs.some((l) => l.isPersonal);
}

/** Single canonical outbound (individual request, or the Integration-Contract preview). */
export function assembleOutbound(req: FullRequest, enabled?: Set<string>, meta?: OutboundMeta): CanonicalOutbound {
  // DD-19 hotel payment channel — CTA (central-billed) vs TRAVELLER (employee pays & claims).
  // Airfare is always TMC/central; this flag tells the TMC who to bill for the room.
  const hotelBillTo: 'CTA' | 'TRAVELLER' = lineSettlement(req, EXPENSE_CATEGORY.Accommodation) === 'CENTRAL' ? 'CTA' : 'TRAVELLER';
  const acc = req.expenses
    .filter((e) => e.category === EXPENSE_CATEGORY.Accommodation && e.accommodation)
    .map((e) => ({ city: e.accommodation!.city, nights: e.accommodation!.nights, cappedNightlySgd: e.accommodation!.budgetedNightly, billTo: hotelBillTo }));
  const ceiling = req.expenses
    .filter((e) => e.category === EXPENSE_CATEGORY.Airfare || e.category === EXPENSE_CATEGORY.Accommodation)
    .reduce((s, e) => s + e.sgdAmount, 0);
  const exceptions = req.policyChecks.filter((c) => c.outcome === POLICY_OUTCOME.Exception).map((c) => c.label);
  // §8 / DD-25 when a guest upgrade was Provost-authorised, carry that authority to the TMC so the
  // agent may book the approved higher class against a named approver.
  if (isGuestRequest(req) && req.provostId && req.policyChecks.some((c) => c.code === 'CLASS' && c.outcome === POLICY_OUTCOME.Exception)) {
    exceptions.push(`Guest travel-class upgrade — Provost-approved (${EcsIdentity.employee(req.provostId)?.name ?? req.provostId})`);
  }
  const g = guestBlock(req);
  const emp = EcsIdentity.employee(req.travellerId);
  const out = buildOutbound({
    authorisationNo: req.authorisationNo, travellerId: req.travellerId, travellerName: travellerName(req),
    bookingFor: g.bookingFor, guest: 'guest' in g ? g.guest : undefined,
    travellers: req.travellers, bookingMethod: req.bookingMethod, bookingDeadline: req.bookingDeadline,
    approvedCostCeilingSgd: ceiling, approvedExceptions: exceptions, legs: sharedLegs(req), accommodation: acc,
    travelPurpose: EcsReference.travelPurpose(req.purposeId ?? '')?.name,
    eventStartDate: req.eventStartDate, eventEndDate: req.eventEndDate, approvalValidUntil: req.authorisationExpiry,
    charging: chargingBlock(req), approvals: approvalsBlock(req),
    travellerCategory: isGuestRequest(req) ? 'GUEST' : (emp?.travelPolicyGroup ?? 'STAFF'),
    travellerEmail: isGuestRequest(req) ? req.guestEmail : null,
    personalTravel: requestPersonal(req),
    guestProfile: isGuestRequest(req) ? guestProfileBlock(req.guestEmail) : undefined,
  }, enabled, meta);
  // §8 a guest request is host-settled: the TMC direct-bills the host cost object.
  if (isGuestRequest(req)) out.settlement = { mode: 'HOST_DIRECT_BILL', costObject: hostCostObject(req) };
  // §13.x / DD-23 emergency book-first: flag the instruction so the TMC reconciles to any space
  // already held and does not create a duplicate booking.
  if (isEmergencyBookFirst(req)) out.emergency = {
    lane: 'EMERGENCY_BOOK_FIRST',
    authorisedBy: EcsIdentity.employee(req.emergencyAuthoriserId ?? '')?.name ?? req.emergencyAuthoriserId ?? null,
    authorisationNumber: req.authorisationNo ?? '',
    reconcile: 'Authorised ahead of full approval — reconcile to any space already held during the emergency; do not create a duplicate booking.',
  };
  return out;
}

/** §9.3 Build one booking instruction per group traveller (AC15). For an individual
 *  request this returns the single canonical outbound (SINGLE mode). */
export function assembleOutboundInstructions(
  req: FullRequest,
  enabled?: Set<string>,
  meta?: OutboundMeta,
): { mode: 'SINGLE' | 'GROUP_FANOUT'; instructions: CanonicalOutbound[] } {
  if (!req.isGroup) return { mode: 'SINGLE', instructions: [assembleOutbound(req, enabled, meta)] };

  const on = (k: string) => !enabled || enabled.has(k);
  const shares = computeTravellerShares(req);
  const exceptions = req.policyChecks.filter((c) => c.outcome === POLICY_OUTCOME.Exception);
  const count = req.travellers.length;
  const charging = chargingBlock(req);
  const approvals = approvalsBlock(req);
  // DD-19 hotel payment channel (request-level, applies to every group traveller's room).
  const hotelBillTo: 'CTA' | 'TRAVELLER' = lineSettlement(req, EXPENSE_CATEGORY.Accommodation) === 'CENTRAL' ? 'CTA' : 'TRAVELLER';

  const instructions = req.travellers.map((t, i) => {
    const legs = effectiveLegs(req, t.employeeId).filter((l) => l.transportMode === 'AIR');
    // §8 guest members have no entitlement profile — Economy by default (AC7).
    const guest = isGuestMember(t);
    const classId = guest ? 'TC-ECO' : (t.chosenClassId ?? req.travelClassId);
    // Shared accommodation lines, each costed on this traveller's own nights; plus any
    // accommodation line attributed directly to them.
    const sharedAcc = req.expenses
      .filter((e) => e.isShared && e.category === EXPENSE_CATEGORY.Accommodation && e.accommodation)
      .map((e) => ({ city: e.accommodation!.city, nights: travellerNightsAtCity(req, t.employeeId, e.accommodation!.city), cappedNightlySgd: e.accommodation!.budgetedNightly, billTo: hotelBillTo }))
      .filter((a) => a.nights > 0);
    const ownAcc = req.expenses
      .filter((e) => !e.isShared && e.travellerId === t.employeeId && e.category === EXPENSE_CATEGORY.Accommodation && e.accommodation)
      .map((e) => ({ city: e.accommodation!.city, nights: e.accommodation!.nights, cappedNightlySgd: e.accommodation!.budgetedNightly, billTo: hotelBillTo }));
    const acc = [...sharedAcc, ...ownAcc];
    const share = shares.find((s) => s.employeeId === t.employeeId);

    const out: CanonicalOutbound = {
      authorisationNumber: req.authorisationNo ?? '',
      travellerRef: t.employeeId,
      travellerName: memberName(t),
      bookingFor: guest ? 'GUEST' : 'EMPLOYEE',
      ...(guest ? { guest: { name: memberName(t), email: t.guestEmail, organisation: t.guestOrg },
        settlement: { mode: 'HOST_DIRECT_BILL' as const, costObject: hostCostObject(req) },
        ...(on('guestProfile') ? { guestProfile: guestProfileBlock(t.guestEmail) } : {}) } : {}),
      instructionSeq: i + 1,
      instructionCount: count,
      bookingMethod: req.bookingMethod ?? 'TMC_ONLINE',
      segments: [
        ...(on('airSegments') ? legs.map((l) => ({
          type: 'AIR' as const, origin: l.originCode, destination: l.destCode,
          departDate: l.departDate ? l.departDate.toISOString().slice(0, 10) : null,
          approvedClass: on('airApprovedClass') ? EcsReference.travelClass((guest ? classId : (l.chosenClassId ?? classId)) ?? '')?.name : undefined,
        })) : []),
        ...(on('hotelSegments') ? acc.map((a) => ({ type: 'HOTEL' as const, city: a.city, nights: a.nights, cappedNightlySgd: a.cappedNightlySgd })) : []),
      ],
    };
    if (on('bookingDeadline')) out.bookingDeadline = req.bookingDeadline ? req.bookingDeadline.toISOString().slice(0, 10) : null;
    if (on('costCeiling')) out.costShareSgd = Math.round(share?.totalSgd ?? 0);
    // Per-traveller exceptions (plus any request-level exceptions that carry no traveller).
    if (on('approvedExceptions')) {
      out.approvedExceptions = exceptions.filter((c) => !c.travellerId || c.travellerId === t.employeeId).map((c) => c.label);
    }
    // §4.6 approved-request context (shared across the group).
    if (on('tripPurpose')) { const pn = EcsReference.travelPurpose(req.purposeId ?? '')?.name; if (pn) out.travelPurpose = pn; }
    if (on('eventDates') && (req.eventStartDate || req.eventEndDate)) {
      out.eventStartDate = req.eventStartDate ? req.eventStartDate.toISOString().slice(0, 10) : null;
      out.eventEndDate = req.eventEndDate ? req.eventEndDate.toISOString().slice(0, 10) : null;
    }
    if (on('approvalValidity')) out.approvalValidUntil = req.authorisationExpiry ? req.authorisationExpiry.toISOString().slice(0, 10) : null;
    // §29 enrichment — charging/approvals shared across the group; traveller context + personal flag per traveller.
    if (on('charging') && charging.length) out.charging = charging;
    if (on('approvalMetadata') && approvals.length) out.approvals = approvals;
    if (on('travellerCategory')) out.traveller = { category: guest ? 'GUEST' : (EcsIdentity.employee(t.employeeId)?.travelPolicyGroup ?? 'STAFF'), email: guest ? t.guestEmail : null };
    if (on('personalIndicator')) out.personalTravel = guest ? false : hasPersonalExtension(req, t.employeeId);
    return out;
  });

  return { mode: 'GROUP_FANOUT', instructions };
}
