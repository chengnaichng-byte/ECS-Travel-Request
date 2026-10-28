// §6.3 ECS Policy Configuration — the FIELD catalogue a policy rule tests (mirrors the ECS "Edit
// Policy Rule" Field dropdown). Each field is REQUEST-scope (evaluated once per request) or LINE-scope
// (evaluated per estimate line). Values are typed so the editor can offer the right operator/value
// control; enum fields carry their options. The evaluator (policyConfigEval.ts) supplies these from a
// request and runs the configured conditions with the shared engine (workflowRules.ts).
import type { Cmp } from '@/modules/pretrip/workflowRules';
import { expenseTypes } from '@/data/expenseTypes';
import { travelPurposes } from '@/data/travelPurposes';
import { BOOKING_METHOD, BOOKING_METHOD_LABEL } from '@/shared/enums';

export interface PolicyField {
  key: string;
  label: string;
  type: 'number' | 'enum' | 'bool' | 'text';
  scope: 'REQUEST' | 'LINE';
  source: string;
  options?: { value: string; label: string }[];
  unit?: string;
}

export const POLICY_FIELDS: PolicyField[] = [
  // ---- Request-scope ----
  { key: 'approvalAmountSgd', label: 'Approval amount (SGD)', type: 'number', scope: 'REQUEST', source: 'Request' },
  { key: 'tripDurationDays', label: 'Trip duration (days)', type: 'number', scope: 'REQUEST', source: 'Request' },
  { key: 'leadDays', label: 'Days to departure', type: 'number', scope: 'REQUEST', source: 'Request' },
  { key: 'bookingMethod', label: 'Booking method', type: 'enum', scope: 'REQUEST', source: 'Request', options: Object.values(BOOKING_METHOD).map((v) => ({ value: v, label: BOOKING_METHOD_LABEL[v] ?? v })) },
  { key: 'isResearch', label: 'Research funding', type: 'bool', scope: 'REQUEST', source: 'Charging' },
  { key: 'isGroup', label: 'Group request', type: 'bool', scope: 'REQUEST', source: 'Request' },
  { key: 'classAboveEntitlement', label: 'Travel class above entitlement', type: 'bool', scope: 'REQUEST', source: 'Policy' },
  { key: 'highRiskDestination', label: 'High-risk destination', type: 'bool', scope: 'REQUEST', source: 'Policy' },
  { key: 'destCountry', label: 'Destination country', type: 'text', scope: 'REQUEST', source: 'Request' },
  // ---- Line-scope ----
  { key: 'expenseItemType', label: 'Expense item type', type: 'enum', scope: 'LINE', source: 'Expense', options: expenseTypes.map((e) => ({ value: e.id, label: e.name })) },
  { key: 'expenseItemAmountSgd', label: 'Expense item amount (SGD)', type: 'number', scope: 'LINE', source: 'Expense' },
  { key: 'accommodationAboveCap', label: 'Accommodation above cap', type: 'bool', scope: 'LINE', source: 'Policy' },
  { key: 'odaDurationDays', label: 'ODA duration (days)', type: 'number', scope: 'LINE', source: 'Expense' },
  { key: 'travelPurpose', label: 'Travel Purpose', type: 'enum', scope: 'REQUEST', source: 'Request', options: travelPurposes.map((p) => ({ value: p.id, label: p.name })) },
];

export const OPS_FOR_TYPE: Record<string, Cmp[]> = { number: ['gt', 'gte', 'lt', 'lte', 'between', 'eq', 'ne'], enum: ['eq', 'ne', 'in'], text: ['eq', 'ne'], bool: ['is'] };
export const policyField = (key: string) => POLICY_FIELDS.find((f) => f.key === key);
export const policyFieldLabel = (key: string) => policyField(key)?.label ?? key;
export const isLineField = (key: string) => policyField(key)?.scope === 'LINE';
