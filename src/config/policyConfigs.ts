// §6.3 ECS Policy Configuration — the structured model behind the ECS "Policy Configurations" screen:
// a named, category- and company-scoped, effective-dated, enable-able Policy → ordered Policy Rules →
// each with ANDed Field/Operator/Value conditions and ordered Actions (Show warning / Hard stop / Add
// exception approvers). Rules compile to the shared engine's conditions (workflowRules.ts). The
// default below reproduces the discretionary advisory/exception checks that used to live in policy.ts,
// now configurable (edit the threshold, the outcome, or the message without a code change). #6.
import { POLICY_OUTCOME } from '@/shared/enums';
import { policyThresholds as PT } from '@/config/policyThresholds';
import { BOOKING_METHOD } from '@/shared/enums';
import type { Condition } from '@/modules/pretrip/workflowRules';

export type PolicyActionType = 'WARNING' | 'HARD_STOP' | 'EXCEPTION_APPROVERS';
export const POLICY_ACTION_LABEL: Record<PolicyActionType, string> = {
  WARNING: 'Show warning message', HARD_STOP: 'Hard stop', EXCEPTION_APPROVERS: 'Add exception approvers',
};
/** The PolicyCheck outcome an action maps to (for the engine + routing). */
export const ACTION_OUTCOME: Record<PolicyActionType, string> = {
  WARNING: POLICY_OUTCOME.Warning, HARD_STOP: POLICY_OUTCOME.HardStop, EXCEPTION_APPROVERS: POLICY_OUTCOME.Exception,
};

export interface PolicyAction { type: PolicyActionType; message?: string; approverIds?: string[] }
export interface PolicyRuleCfg { seq: number; code: string; description: string; conditions: Condition[]; actions: PolicyAction[] }
export interface PolicyConfig {
  code: string;
  name: string;
  documentType: string;     // §6.3 overarching scope — the DOCUMENT this policy applies to (TRAVEL_REQUEST | EXPENSE_CLAIM)
  category: string;
  companyCode: string;
  effectiveFrom: string;
  effectiveTo: string;
  enabled: boolean;
  rules: PolicyRuleCfg[];
}

// ECS policy categories (from the ECS Policy Configurations list).
export const POLICY_CATEGORIES = ['Accommodation', 'Audit rules', 'Entertainment', 'Event', 'ODA', 'Others', 'Procurement', 'Travel Purpose'] as const;
export const POLICY_COMPANY_CODES = ['NTU', 'INTU'] as const;

export const DEFAULT_POLICY_CONFIGS: PolicyConfig[] = [
  {
    code: 'TR_ADVISORIES', name: 'NTU_Travel Advisories', documentType: 'TRAVEL_REQUEST', category: 'Others', companyCode: 'NTU',
    effectiveFrom: '2024-04-01', effectiveTo: '2031-03-31', enabled: true,
    rules: [
      { seq: 1, code: 'LEAD', description: 'Short lead time',
        conditions: [{ fact: 'leadDays', op: 'gte', value: 0 }, { fact: 'leadDays', op: 'lt', value: PT.shortLeadDays }],
        actions: [{ type: 'WARNING', message: `Departure is within the recommended ${PT.shortLeadDays}-day advance-booking window.` }] },
      { seq: 2, code: 'LONG', description: 'Long trip',
        conditions: [{ fact: 'tripDurationDays', op: 'gt', value: PT.longTripDays }],
        actions: [{ type: 'WARNING', message: `Trip duration is beyond the ${PT.longTripDays}-day long-trip threshold.` }] },
      { seq: 3, code: 'HIGH', description: 'High estimate',
        conditions: [{ fact: 'approvalAmountSgd', op: 'gt', value: PT.highEstimateSgd }],
        actions: [{ type: 'WARNING', message: `Approval amount is above the high-estimate threshold of SGD ${PT.highEstimateSgd.toLocaleString('en-SG')}.` }] },
      { seq: 4, code: 'OFFLINE', description: 'Offline booking',
        conditions: [{ fact: 'bookingMethod', op: 'eq', value: BOOKING_METHOD.Offline }],
        actions: [{ type: 'EXCEPTION_APPROVERS', message: 'Offline booking requires a supporting quotation and approval.' }] },
    ],
  },
];
