// §13.19/§4.5 LIVE policy outcome for the estimate cost-items table — evaluated from the current
// lines (not the persisted policy checks the Review step reads), so a deviation shows the moment it
// is entered on the Estimates / Charging steps. Covers: travel class above the derived entitlement,
// and accommodation above the city cap. Shared by the Estimates and Charging steps' CostItems tables.
import { EcsTravelClassRegister, EcsReference } from '@/shared/ecs/services';
import { effectiveLegs, sharedLegs } from './group';
import { EXPENSE_CATEGORY, POLICY_OUTCOME } from '@/shared/enums';
import type { FullRequest } from './queries';

type Expense = FullRequest['expenses'][number];

/** The traveller's derived travel-class entitlement for this itinerary (per traveller for a group). */
export function makeEntitledClassFor(req: FullRequest): (employeeId: string) => string {
  const onDate = req.startDate ?? new Date();
  const fallback = req.destCity ? [{ durationHours: EcsReference.flightHours(req.destCity), destCode: req.destCity, isPersonal: false }] : [];
  return (employeeId: string) => {
    const legs = req.isGroup
      ? (effectiveLegs(req, employeeId).length ? effectiveLegs(req, employeeId) : fallback)
      : (sharedLegs(req).length ? sharedLegs(req) : fallback);
    return EcsTravelClassRegister.entitledForItinerary(employeeId, legs, onDate).classId;
  };
}

/** True when an airfare line's proposed class outranks the traveller's derived entitlement (upgrade). */
export function makeAirfareOverClass(req: FullRequest): (e: Expense) => boolean {
  const entitledFor = makeEntitledClassFor(req);
  return (e: Expense) => {
    if (e.category !== EXPENSE_CATEGORY.Airfare || !e.proposedClassId) return false;
    const employeeId = (req.isGroup ? e.travellerId : null) ?? req.travellerId;
    return EcsTravelClassRegister.rank(e.proposedClassId) > EcsTravelClassRegister.rank(entitledFor(employeeId));
  };
}

/** Per-expense-type live outcome for CostItems — { exc, label }. */
export function makeOutcomeFor(req: FullRequest): (category: string, lines: Expense[]) => { exc: boolean; label: string } {
  const over = makeAirfareOverClass(req);
  return (category: string, lines: Expense[]) => {
    let excLines = 0;
    if (category === EXPENSE_CATEGORY.Airfare) excLines = lines.filter(over).length;
    else if (category === EXPENSE_CATEGORY.Accommodation) excLines = lines.filter((l) => l.accommodation?.exceptionOutcome === POLICY_OUTCOME.Exception).length;
    const exc = excLines > 0;
    return { exc, label: !exc ? 'Within Policy' : req.isGroup ? `${excLines} traveller${excLines > 1 ? 's' : ''} with Exception` : 'Exception' };
  };
}
