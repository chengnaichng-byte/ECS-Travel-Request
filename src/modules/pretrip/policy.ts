// §6.3 Policy engine. Produces PolicyCheck rows with outcomes Pass / Warning /
// Exception / Hard stop. Hard stop blocks submission (AC06); Exception is allowed
// through exception approval (§6.2); Warning is informational.
import { EcsPolicy, EcsReference, EcsCharging, EcsTravelClassRegister, EcsIdentity } from '@/shared/ecs/services';
import { POLICY_OUTCOME, EXPENSE_CATEGORY, BOOKING_METHOD } from '@/shared/enums';
import type { FullRequest } from './queries';
import { computeSummary } from './pricing';
import { effectiveLegs, sharedLegs } from './group';
import { policyThresholds as PT } from '@/config/policyThresholds';
import { ruleActive } from '@/config/policyRules';

export interface EvaluatedCheck {
  code: string;
  label: string;
  outcome: string;
  detail: string;
  travellerId?: string | null;
}

export function evaluatePolicies(req: FullRequest, approvalAmountBasis: string): EvaluatedCheck[] {
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

  // ---- Exceptions -------------------------------------------------------------
  if (ruleActive('HOTEL_CAP', now)) for (const e of req.expenses) {
    if (e.category === EXPENSE_CATEGORY.Accommodation && e.accommodation) {
      if (e.accommodation.exceptionOutcome === POLICY_OUTCOME.Exception) {
        checks.push({
          code: 'HOTEL_CAP', label: 'Accommodation above cap', outcome: POLICY_OUTCOME.Exception,
          detail: `${e.accommodation.city}: quoted SGD ${e.accommodation.quotedNightly}/night exceeds cap SGD ${e.accommodation.capNightly}/night.`,
          travellerId: e.travellerId,
        });
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
    }
  }

  if (ruleActive('OFFLINE', now) && req.bookingMethod === BOOKING_METHOD.Offline) {
    checks.push({ code: 'OFFLINE', label: 'Offline booking', outcome: POLICY_OUTCOME.Exception, detail: 'Offline booking requires a supporting quotation and approval.' });
  }

  // ---- Warnings ---------------------------------------------------------------
  if (ruleActive('LEAD', now) && req.startDate) {
    const leadDays = Math.round((req.startDate.getTime() - now.getTime()) / 86400000);
    if (leadDays >= 0 && leadDays < PT.shortLeadDays) {
      checks.push({ code: 'LEAD', label: 'Short lead time', outcome: POLICY_OUTCOME.Warning, detail: `Departure is in ${leadDays} day(s); recommended lead time is ${PT.shortLeadDays} days.` });
    }
  }
  if (ruleActive('LONG', now) && req.startDate && req.endDate) {
    const durDays = Math.round((req.endDate.getTime() - req.startDate.getTime()) / 86400000) + 1;
    if (durDays > PT.longTripDays) checks.push({ code: 'LONG', label: 'Long trip', outcome: POLICY_OUTCOME.Warning, detail: `Trip spans ${durDays} days.` });
  }
  const summary = computeSummary(req.expenses, approvalAmountBasis);
  if (ruleActive('HIGH', now) && summary.approvalAmount > PT.highEstimateSgd) {
    checks.push({ code: 'HIGH', label: 'High estimate', outcome: POLICY_OUTCOME.Warning, detail: `Approval amount SGD ${summary.approvalAmount.toFixed(0)} is above SGD ${PT.highEstimateSgd.toLocaleString('en-SG')}.` });
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
