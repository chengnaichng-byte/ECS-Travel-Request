// §6.3 Policy engine. Produces PolicyCheck rows with outcomes Pass / Warning /
// Exception / Hard stop. Hard stop blocks submission (AC06); Exception is allowed
// through exception approval (§6.2); Warning is informational.
import { EcsPolicy, EcsReference, EcsCharging, EcsTravelClassRegister, EcsIdentity } from '@/shared/ecs/services';
import { POLICY_OUTCOME, EXPENSE_CATEGORY } from '@/shared/enums';
import type { FullRequest } from './queries';
import { effectiveLegs, sharedLegs } from './group';
import { ruleActive } from '@/config/policyRules';
import { highRiskDestinationsForRequest } from './risk';
import { isGuestRequest } from './traveller';
import { airfareUpgrade } from './upgrade';
import type { UpgradeCheckCtx } from './upgradeConfig';

export interface EvaluatedCheck {
  code: string;
  label: string;
  outcome: string;
  detail: string;
  travellerId?: string | null;
}

export function evaluatePolicies(req: FullRequest, approvalAmountBasis: string, upgradeCtx?: UpgradeCheckCtx): EvaluatedCheck[] {
  const checks: EvaluatedCheck[] = [];
  const now = new Date();

  // ---- Hard stops -------------------------------------------------------------
  if (!req.startDate || !req.endDate) {
    checks.push({ code: 'DATES', label: 'Official travel dates', outcome: POLICY_OUTCOME.HardStop, detail: 'Start and end dates are required.' });
  } else if (req.startDate > req.endDate) {
    checks.push({ code: 'DATES', label: 'Official travel dates', outcome: POLICY_OUTCOME.HardStop, detail: 'Return date is before departure date.' });
  } else {
    checks.push({ code: 'DATES', label: 'Official travel dates', outcome: POLICY_OUTCOME.Pass, detail: 'Dates are valid.' });
  }

  // A pre-trip request cannot be raised for a trip that has already started — catches a mis-keyed
  // year/month that the short-lead (LEAD) check lets through (it guards leadDays >= 0). Compared at
  // start-of-today so a same-day departure is not flagged. Drafts are exempt at the save/submit gate.
  if (ruleActive('DATE_PAST', now) && req.startDate) {
    const today0 = new Date(now); today0.setHours(0, 0, 0, 0);
    if (req.startDate < today0) {
      checks.push({ code: 'DATE_PAST', label: 'Departure date is in the past', outcome: POLICY_OUTCOME.HardStop, detail: `The official start date ${req.startDate.toISOString().slice(0, 10)} is in the past — correct the travel dates on the Trip step.` });
    }
  }

  // Itinerary overlap (hard stop) — a leg cannot depart a city before the previous leg arrives
  // there. Enforced only when the previous leg's arrival date is present (arrival dates are often
  // left blank; the Trip-step depart-order guard remains the floor). Shared/ordered legs only.
  if (ruleActive('LEG_OVERLAP', now)) {
    const ordered = req.legs.filter((l) => !l.travellerId).sort((a, b) => a.seq - b.seq);
    for (let i = 1; i < ordered.length; i++) {
      const prevArrive = ordered[i - 1].arriveDate, dep = ordered[i].departDate;
      if (prevArrive && dep && dep < prevArrive) {
        checks.push({ code: 'LEG_OVERLAP', label: 'Itinerary legs overlap', outcome: POLICY_OUTCOME.HardStop, detail: `Leg ${i + 1} departs ${dep.toISOString().slice(0, 10)} but you do not arrive on leg ${i} until ${prevArrive.toISOString().slice(0, 10)} — fix the itinerary dates.` });
      }
    }
  }

  const allocTotal = req.allocations.reduce((s, a) => s + a.percent, 0);
  if (req.allocations.length === 0) {
    checks.push({ code: 'ALLOC', label: 'Charging allocation', outcome: POLICY_OUTCOME.HardStop, detail: 'No charging allocation entered.' });
  } else if (Math.abs(allocTotal - 100) > 0.001) {
    checks.push({ code: 'ALLOC', label: 'Charging allocation', outcome: POLICY_OUTCOME.HardStop, detail: `Allocations total ${allocTotal.toFixed(1)}%; must equal 100%.` });
  } else {
    checks.push({ code: 'ALLOC', label: 'Charging allocation', outcome: POLICY_OUTCOME.Pass, detail: 'Allocations total 100%.' });
  }

  const badCode = req.allocations.find((a) => !EcsCharging.code(a.chargingCode));
  if (badCode) {
    checks.push({ code: 'FUNDING', label: 'Funding source', outcome: POLICY_OUTCOME.HardStop, detail: `Unknown charging code ${badCode.chargingCode}.` });
  }
  // §25 inactive/closed charging code — cannot be charged.
  if (ruleActive('FUNDING_INACTIVE', now)) {
    const inactive = req.allocations.map((a) => EcsCharging.code(a.chargingCode)).find((c) => c && c.active === false);
    if (inactive) {
      checks.push({ code: 'FUNDING_INACTIVE', label: 'Inactive charging code', outcome: POLICY_OUTCOME.HardStop, detail: `${inactive.code} — ${inactive.name} is closed${inactive.validTo ? ` (valid to ${inactive.validTo})` : ''}; select an active account.` });
    }
  }

  if (req.expenses.length === 0) {
    checks.push({ code: 'ESTIMATE', label: 'Estimated costs', outcome: POLICY_OUTCOME.HardStop, detail: 'At least one estimated cost line is required.' });
  }

  // #14 NTU-funded travel-class upgrade differential → M6 account. The amount is derived (Model B);
  // only the account routing needs the traveller's choice. Hard-stop when the governing BA offers
  // more than one M6 account and none is selected (or has none configured, or an invalid one).
  if (ruleActive('UPGRADE_M6', now) && upgradeCtx?.enabled) {
    const govBA = (req.allocations.find((a) => a.isMain) ?? req.allocations[0])?.businessArea ?? null;
    const pool = upgradeCtx.accounts.filter((a) => a.active && a.businessArea === govBA);
    for (const e of req.expenses) {
      if (e.category !== EXPENSE_CATEGORY.Airfare) continue;
      const u = airfareUpgrade({ sgdAmount: e.sgdAmount, entitlementFareSgd: e.entitlementFareSgd, upgradeFunding: e.upgradeFunding, upgradeDeltaCode: e.upgradeDeltaCode });
      if (!u.isUpgrade || u.funding !== 'NTU') continue;
      if (pool.length === 0) {
        checks.push({ code: 'UPGRADE_M6', label: 'No M6 differential account configured', outcome: POLICY_OUTCOME.HardStop, detail: `No active M6 account is configured for business area ${govBA ?? '—'} — add one in Setup → M6 Accounts.`, travellerId: e.travellerId });
      } else if (e.upgradeDeltaCode && !pool.some((a) => a.code === e.upgradeDeltaCode)) {
        checks.push({ code: 'UPGRADE_M6', label: 'M6 account not valid for this BA', outcome: POLICY_OUTCOME.HardStop, detail: `${e.upgradeDeltaCode} is not an active M6 account for business area ${govBA ?? '—'} — reselect one on the Charging step.`, travellerId: e.travellerId });
      } else if (!e.upgradeDeltaCode && pool.length > 1 && upgradeCtx.selectionRequired) {
        checks.push({ code: 'UPGRADE_M6', label: 'Select the M6 differential account', outcome: POLICY_OUTCOME.HardStop, detail: `The M6 entitlement differential must be charged to an M6 account — select one for business area ${govBA ?? '—'} on the Charging step.`, travellerId: e.travellerId });
      }
    }
  }

  // ---- Exceptions -------------------------------------------------------------
  if (ruleActive('HOTEL_CAP', now)) for (const e of req.expenses) {
    if (e.category === EXPENSE_CATEGORY.Accommodation && e.accommodation) {
      if (e.accommodation.exceptionOutcome === POLICY_OUTCOME.Exception) {
        checks.push({
          code: 'HOTEL_CAP', label: 'Accommodation above cap', outcome: POLICY_OUTCOME.Exception,
          detail: `${e.accommodation.city}: quoted SGD ${e.accommodation.quotedNightly}/night exceeds cap SGD ${e.accommodation.capNightly}/night.${e.accommodation.conferenceHotel ? ' Conference hotel — the conference-venue designation is the justification.' : ''}`,
          travellerId: e.travellerId,
        });
        // §4.5 an above-cap rate cannot be submitted without a justification (mirrors the class
        // upgrade hard-stop, CLASS_JUSTIFY) — the note travels to the approver with the exception.
        // A CONFERENCE HOTEL is self-justifying (the venue is the reason), so it needs no written
        // justification; the above-cap line still routes as an exception for audit/approval.
        if (!e.accommodation.conferenceHotel && (!e.notes || e.notes.trim() === '')) {
          const where = EcsReference.city(e.accommodation.city)?.name ?? e.accommodation.city;
          checks.push({
            code: 'HOTEL_JUSTIFY', label: 'Above-cap accommodation justification required', outcome: POLICY_OUTCOME.HardStop,
            detail: `${where}: the nightly rate SGD ${e.accommodation.quotedNightly} is above the cap SGD ${e.accommodation.capNightly} — a justification is required${req.isGroup && e.travellerId ? ` (${EcsIdentity.employee(e.travellerId)?.name})` : ''}.`,
            travellerId: e.travellerId,
          });
        }
      }
    }
  }

  // Travel class above entitlement (§13.19) — per traveller for group requests.
  // Entitlement is derived from the Travel Class register evaluated per flight leg.
  const onDate = req.startDate ?? new Date();
  const fallbackLegs = req.destCity ? [{ durationHours: EcsReference.flightHours(req.destCity), destCode: req.destCity, isPersonal: false }] : [];
  if (ruleActive('CLASS', now)) for (const t of (req.isGroup ? req.travellers : [{ employeeId: req.travellerId, chosenClassId: req.travelClassId }])) {
    const chosenId = req.isGroup ? (t as { chosenClassId?: string | null }).chosenClassId ?? req.travelClassId : req.travelClassId;
    if (!chosenId) continue;
    // Each traveller's entitlement is evaluated against their effective itinerary (own
    // sub-itinerary if any, else the shared group legs) — §13.20.
    const legsForClass = req.isGroup ? (effectiveLegs(req, t.employeeId).length ? effectiveLegs(req, t.employeeId) : fallbackLegs) : (sharedLegs(req).length ? sharedLegs(req) : fallbackLegs);
    const entitled = EcsTravelClassRegister.entitledForItinerary(t.employeeId, legsForClass, onDate);
    const chosen = EcsReference.travelClass(chosenId);
    const entName = EcsReference.travelClass(entitled.classId)?.name;
    if (chosen && EcsTravelClassRegister.rank(chosenId) > EcsTravelClassRegister.rank(entitled.classId)) {
      checks.push({
        code: 'CLASS', label: 'Travel class above entitlement', outcome: POLICY_OUTCOME.Exception,
        detail: `${chosen.name} requested; entitlement is ${entName} (${entitled.basis}).`,
        travellerId: req.isGroup ? t.employeeId : null,
      });
      // §13.19 / AC39 — an upgrade cannot be submitted without a justification comment
      // (per traveller for group requests).
      const justification = req.isGroup ? (t as { classJustification?: string | null }).classJustification : req.classJustification;
      if (!justification || justification.trim() === '') {
        checks.push({
          code: 'CLASS_JUSTIFY', label: 'Class upgrade justification required', outcome: POLICY_OUTCOME.HardStop,
          detail: `Selecting a class above the derived entitlement requires a justification comment${req.isGroup ? ` (${EcsIdentity.employee(t.employeeId)?.name})` : ''}.`,
          travellerId: req.isGroup ? t.employeeId : null,
        });
      }
      // §8 / DD-25 a GUEST upgrade additionally requires a selected Provost (host-school list) to
      // authorise the above-Economy class; the Provost step is inserted ahead of the host DOA.
      if (!req.isGroup && isGuestRequest(req) && !req.provostId) {
        checks.push({
          code: 'CLASS_PROVOST', label: 'Provost authorisation required (guest upgrade)', outcome: POLICY_OUTCOME.HardStop,
          detail: 'A guest booked above Economy must have a Provost selected to authorise the upgrade (§8 / DD-25).',
          travellerId: null,
        });
      }
    }
  }

  // §6.3 OFFLINE / LEAD / LONG / HIGH are now DATA-DRIVEN via Policy Configuration (the
  // "NTU_Travel Advisories" policy, evaluated by policyConfigEval) — their outcome, threshold and
  // message are runtime-editable. Structural + entangled checks stay in this engine.

  // ---- Warnings ---------------------------------------------------------------

  // Itinerary route continuity (advisory) — each leg should depart from where the previous leg
  // arrived; a mismatch (e.g. land in Tokyo, next leg leaves from Osaka) is usually a data-entry
  // slip, but a self-arranged ground hop is legitimate, so this is a WARNING not a block. Evaluated
  // on the shared/ordered itinerary (travellerId null), consistent with the other leg logic.
  if (ruleActive('ROUTE_GAP', now)) {
    const ordered = req.legs.filter((l) => !l.travellerId).sort((a, b) => a.seq - b.seq);
    for (let i = 1; i < ordered.length; i++) {
      const prev = ordered[i - 1], cur = ordered[i];
      if (prev.destCode && cur.originCode && prev.destCode !== cur.originCode) {
        checks.push({
          code: 'ROUTE_GAP', label: 'Itinerary route is not connected', outcome: POLICY_OUTCOME.Warning,
          detail: `Leg ${i + 1} departs ${cur.originCode} but leg ${i} arrived in ${prev.destCode} — check for a missing connection.`,
        });
      }
    }
  }

  // §4.8 high-risk destination — surface the advisory; traveller + approver acknowledgements
  // are enforced separately at submission and approval.
  if (ruleActive('HIGH_RISK', now)) {
    for (const h of highRiskDestinationsForRequest(req)) {
      checks.push({ code: 'HIGH_RISK', label: `High-risk destination — ${h.name} (${h.riskLevel})`, outcome: POLICY_OUTCOME.Warning, detail: `${h.advisory} Source: ${h.source}.` });
    }
  }

  return checks;
}

export function worstOutcome(checks: { outcome: string }[]): string {
  if (checks.some((c) => c.outcome === POLICY_OUTCOME.HardStop)) return POLICY_OUTCOME.HardStop;
  if (checks.some((c) => c.outcome === POLICY_OUTCOME.Exception)) return POLICY_OUTCOME.Exception;
  if (checks.some((c) => c.outcome === POLICY_OUTCOME.Warning)) return POLICY_OUTCOME.Warning;
  return POLICY_OUTCOME.Pass;
}

export function hasHardStop(checks: { outcome: string }[]): boolean {
  return checks.some((c) => c.outcome === POLICY_OUTCOME.HardStop);
}

export function hasException(checks: { outcome: string }[]): boolean {
  return checks.some((c) => c.outcome === POLICY_OUTCOME.Exception);
}
