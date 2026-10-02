// Approver-review helpers (OpenAI design): estimated SGD impact and severity for each
// policy exception, plus a booking-deadline countdown. Impact bases:
//  - Travel class above entitlement: airfare gross × (1 − entitledIndex / chosenIndex)
//    using the class cost index (fare premium of the chosen class over entitlement).
//  - Hotel cap exceeded: the stored cap variance ((quoted − cap) × chargeable nights).
//  - Offline / process exceptions: no direct cost impact.
import { EcsReference, EcsTravelClassRegister, EcsIdentity } from '@/shared/ecs/services';
import { travelClasses } from '@/data/travelClass';
import { policyThresholds as PT } from '@/config/policyThresholds';
import { EXPENSE_CATEGORY, POLICY_OUTCOME } from '@/shared/enums';
import { effectiveLegs } from './group';
import type { FullRequest } from './queries';

export type Severity = 'Low' | 'Medium' | 'High';

export interface ExceptionView {
  code: string;
  label: string;
  detail: string;
  travellerId: string | null;
  travellerName?: string;
  impactSgd: number;
  severity: Severity;
}

const costIndex = (id: string) => travelClasses.find((c) => c.id === id)?.costIndex ?? 1;

function severityFor(impact: number): Severity {
  if (impact >= PT.severityHighSgd) return 'High';
  if (impact >= PT.severityMediumSgd) return 'Medium';
  return 'Low';
}

/** Estimated fare premium of a class upgrade for a traveller (or the whole request). */
export function classUpgradeImpact(req: FullRequest, travellerId: string | null): number {
  const empId = travellerId ?? req.travellerId;
  const chosenId = travellerId
    ? req.travellers.find((t) => t.employeeId === travellerId)?.chosenClassId ?? req.travelClassId
    : req.travelClassId;
  if (!chosenId) return 0;
  const onDate = req.startDate ?? new Date();
  const entitled = EcsTravelClassRegister.entitledForItinerary(
    empId,
    effectiveLegs(req, empId).map((l) => ({ durationHours: l.durationHours, isPersonal: l.isPersonal, destCode: EcsReference.airport(l.destCode)?.cityCode ?? l.destCode })),
    onDate,
  );
  const airfare = req.expenses
    .filter((e) => e.category === EXPENSE_CATEGORY.Airfare && (!travellerId || e.travellerId === travellerId || !e.travellerId))
    .reduce((s, e) => s + e.sgdAmount, 0);
  const factor = Math.max(0, 1 - costIndex(entitled.classId) / costIndex(chosenId));
  return Math.round(airfare * factor);
}

/** Hotel-cap overage for a traveller (or across shared accommodation lines). */
export function hotelCapImpact(req: FullRequest, travellerId: string | null): number {
  return req.expenses
    .filter((e) => e.category === EXPENSE_CATEGORY.Accommodation && e.accommodation && (!travellerId || e.travellerId === travellerId || e.isShared))
    .reduce((s, e) => s + Math.max(0, e.accommodation!.capVariance), 0);
}

/** Build the enriched exception views for the review page. */
export function exceptionViews(req: FullRequest): ExceptionView[] {
  return req.policyChecks
    .filter((c) => c.outcome === POLICY_OUTCOME.Exception)
    .map((c) => {
      let impactSgd = 0;
      if (c.code === 'CLASS') impactSgd = classUpgradeImpact(req, c.travellerId);
      else if (c.code === 'HOTEL_CAP') impactSgd = hotelCapImpact(req, c.travellerId);
      return {
        code: c.code,
        label: c.label,
        detail: c.detail ?? '',
        travellerId: c.travellerId,
        travellerName: c.travellerId ? EcsIdentity.employee(c.travellerId)?.name : undefined,
        impactSgd,
        severity: severityFor(impactSgd),
      } as ExceptionView;
    });
}

/** Days remaining to book, from the booking deadline (approved requests) or a
 *  projected deadline (bookingDeadlineDays before departure). */
export function daysToBook(req: FullRequest, bookingDeadlineDays: number, now = new Date()): { days: number; deadline: Date | null } {
  const deadline = req.bookingDeadline ?? (req.startDate ? new Date(req.startDate.getTime() - bookingDeadlineDays * 86400000) : null);
  if (!deadline) return { days: 0, deadline: null };
  return { days: Math.max(0, Math.round((deadline.getTime() - now.getTime()) / 86400000)), deadline };
}
