import { POLICY_OUTCOME } from '@/shared/enums';

const OUTCOME_CLASS: Record<string, string> = {
  [POLICY_OUTCOME.Pass]: 'pill-pass',
  [POLICY_OUTCOME.Warning]: 'pill-warn',
  [POLICY_OUTCOME.Exception]: 'pill-exc',
  [POLICY_OUTCOME.HardStop]: 'pill-stop',
};
const OUTCOME_LABEL: Record<string, string> = {
  [POLICY_OUTCOME.Pass]: 'Pass',
  [POLICY_OUTCOME.Warning]: 'Warning',
  [POLICY_OUTCOME.Exception]: 'Exception',
  [POLICY_OUTCOME.HardStop]: 'Hard stop',
};

export function OutcomePill({ outcome }: { outcome: string }) {
  return <span className={OUTCOME_CLASS[outcome] ?? 'pill-info'}>{OUTCOME_LABEL[outcome] ?? outcome}</span>;
}

const STATUS_CLASS: Record<string, string> = {
  Draft: 'pill-info',
  Approved: 'pill-pass',
  Rejected: 'pill-stop',
  'Sent Back': 'pill-warn',
  Withdrawn: 'pill-info',
  'Amendment In Progress': 'pill-warn',
  Cancelled: 'pill-stop',
  Expired: 'pill-warn',
  Closed: 'pill-navy',
};

export function StatusPill({ status }: { status: string }) {
  const cls = STATUS_CLASS[status] ?? (status.startsWith('Pending') ? 'pill-warn' : 'pill-navy');
  return <span className={cls}>{status}</span>;
}

export function TreatmentPill({ treatment }: { treatment: string }) {
  const map: Record<string, string> = { LOCKED: 'pill-navy', EDITABLE: 'pill-pass', REFERENCE: 'pill-info', EXCLUDED: 'pill-stop' };
  const label: Record<string, string> = { LOCKED: 'Locked', EDITABLE: 'Editable', REFERENCE: 'Reference', EXCLUDED: 'Excluded' };
  return <span className={map[treatment] ?? 'pill-info'}>{label[treatment] ?? treatment}</span>;
}
