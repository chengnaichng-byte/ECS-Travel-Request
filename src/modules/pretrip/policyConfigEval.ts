// §6.3 Configured-policy evaluator. Supplies each POLICY FIELD from a request (request-scope once,
// line-scope per estimate line) and runs every active Policy Configuration's rules with the shared
// engine (evalExpr). A matching rule emits a PolicyCheck per its Actions (warning / hard stop /
// exception), and collects any named exception approvers for routing. Pure except for reading the
// active policy configs from the service.
import { EcsReference, EcsTravelClassRegister } from '@/shared/ecs/services';
import { POLICY_OUTCOME, EXPENSE_CATEGORY } from '@/shared/enums';
import type { FullRequest } from './queries';
import type { EvaluatedCheck } from './policy';
import { computeSummary } from './pricing';
import { sharedLegs } from './group';
import { isResearchRequest } from './route';
import { highRiskDestinationsForRequest } from './risk';
import { evalExpr, type Ctx } from './workflowRules';
import { isLineField } from '@/config/policyFields';
import { ACTION_OUTCOME } from '@/config/policyConfigs';
import { listActivePolicyConfigs } from './policyConfigService';

const REQUEST_COMPANY = 'NTU';   // the prototype's entity company code (ECS INTU/NTU scope)

/** Non-group travel class above the derived entitlement (the field the ECS cap/class policies test). */
function classAboveEntitlement(req: FullRequest): boolean {
  if (req.isGroup || !req.travelClassId) return false;
  const onDate = req.startDate ?? new Date();
  const legs = sharedLegs(req).length ? sharedLegs(req) : (req.destCity ? [{ durationHours: EcsReference.flightHours(req.destCity), destCode: req.destCity, isPersonal: false }] : []);
  const entitled = EcsTravelClassRegister.entitledForItinerary(req.travellerId, legs, onDate);
  return EcsTravelClassRegister.rank(req.travelClassId) > EcsTravelClassRegister.rank(entitled.classId);
}

export function computeRequestFields(req: FullRequest, approvalAmountBasis: string): Ctx {
  const now = new Date();
  const dur = req.startDate && req.endDate ? Math.round((req.endDate.getTime() - req.startDate.getTime()) / 86400000) + 1 : 0;
  const lead = req.startDate ? Math.round((req.startDate.getTime() - now.getTime()) / 86400000) : Number.NaN;
  return {
    approvalAmountSgd: computeSummary(req.expenses, approvalAmountBasis).approvalAmount,
    tripDurationDays: dur,
    leadDays: lead,
    bookingMethod: req.bookingMethod ?? '',
    isResearch: isResearchRequest(req),
    isGroup: req.isGroup,
    classAboveEntitlement: classAboveEntitlement(req),
    highRiskDestination: highRiskDestinationsForRequest(req).length > 0,
    destCountry: req.destCountry ?? '',
    travelPurpose: req.purposeId ?? '',
  };
}

function computeLineFields(e: FullRequest['expenses'][number]): Ctx {
  return {
    expenseItemType: e.expenseTypeId,
    expenseItemAmountSgd: e.sgdAmount,
    accommodationAboveCap: e.accommodation?.exceptionOutcome === POLICY_OUTCOME.Exception,
    odaDurationDays: e.oda?.eligibleDays ?? 0,
  };
}

/** Evaluate all active Policy Configurations against a request. Returns the emitted PolicyChecks and
 *  any named exception approvers (for the approval route). */
export async function evaluateConfiguredPolicies(req: FullRequest, approvalAmountBasis: string): Promise<{ checks: EvaluatedCheck[]; exceptionApproverIds: string[] }> {
  const configs = await listActivePolicyConfigs(REQUEST_COMPANY);
  const reqCtx = computeRequestFields(req, approvalAmountBasis);
  const lineCtxs = req.expenses.map((e) => ({ e, ctx: { ...reqCtx, ...computeLineFields(e) } }));
  const checks: EvaluatedCheck[] = [];
  const exceptionApproverIds: string[] = [];

  for (const p of configs) {
    for (const rule of p.rules) {
      if (!rule.conditions.length) continue;
      const lineScoped = rule.conditions.some((c) => isLineField(c.fact));
      const targets = lineScoped ? lineCtxs : [{ e: null as FullRequest['expenses'][number] | null, ctx: reqCtx }];
      for (const t of targets) {
        if (!evalExpr({ all: rule.conditions }, t.ctx)) continue;
        for (const a of rule.actions) {
          checks.push({ code: rule.code, label: rule.description, outcome: ACTION_OUTCOME[a.type], detail: a.message ?? rule.description, travellerId: t.e?.travellerId ?? null });
          if (a.type === 'EXCEPTION_APPROVERS' && a.approverIds?.length) exceptionApproverIds.push(...a.approverIds);
        }
      }
    }
  }
  return { checks, exceptionApproverIds };
}
