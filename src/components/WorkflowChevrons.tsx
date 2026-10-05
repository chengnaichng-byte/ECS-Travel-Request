// §13.21 Workflow chevron progress bar — Submitted → (group Traveller Confirmation)
// → approval steps, in the same visual language as TE claims (Figures D6–D7):
// completed green, current amber, upcoming grey, terminal states red.
import { EcsIdentity } from '@/shared/ecs/services';
import { APPROVER_ROLE, REQUEST_STATUS } from '@/shared/enums';
import { isResearchRequest } from '@/modules/pretrip/route';
import type { FullRequest } from '@/modules/pretrip/queries';

const ROLE_LABEL: Record<string, string> = {
  [APPROVER_ROLE.RO]: 'RO', [APPROVER_ROLE.AdditionalApprover]: 'Additional Approver', [APPROVER_ROLE.DOA]: 'DOA', [APPROVER_ROLE.ResearchDOA]: 'Research DOA',
  [APPROVER_ROLE.Exception]: 'Exception', [APPROVER_ROLE.FundingOwner]: 'Funding Owner',
};

type State = 'done' | 'current' | 'todo' | 'stop';
interface Chev { label: string; sub: string; state: State }

function buildChevrons(req: FullRequest): Chev[] {
  if (req.status === REQUEST_STATUS.Draft) return [];
  const chevs: Chev[] = [];
  const requestor = EcsIdentity.employee(req.requestorId)?.name ?? req.requestorId;
  chevs.push({ label: 'Submitted', sub: `by ${requestor}`, state: 'done' });

  const steps = [...req.approvalSteps].sort((a, b) => a.seq - b.seq);
  const firstPending = steps.find((s) => s.status === 'Pending');
  for (const s of steps) {
    const name = EcsIdentity.employee(s.approverId ?? '')?.name ?? 'TBD';
    const role = ROLE_LABEL[s.roleType] ?? s.roleType;
    let state: State = 'todo';
    let label = `Pending ${role}`;
    if (s.status === 'Approved') { state = 'done'; label = `${role} Approved`; }
    else if (s.status === 'Rejected') { state = 'stop'; label = `${role} Rejected`; }
    else if (s.status === 'SentBack') { state = 'stop'; label = `${role} Sent Back`; }
    else if (s.status === 'Pending') { state = s.id === firstPending?.id ? 'current' : 'todo'; }
    chevs.push({ label, sub: name, state });
  }

  // Terminal / header states
  if (req.status === REQUEST_STATUS.Approved) chevs.push({ label: 'Approved', sub: req.authorisationNo ?? '', state: 'done' });
  if (req.status === REQUEST_STATUS.Rejected) chevs.push({ label: 'Rejected', sub: '', state: 'stop' });
  if (req.status === REQUEST_STATUS.SentBack) chevs.push({ label: 'Sent Back', sub: 'to traveller', state: 'stop' });
  if (req.status === REQUEST_STATUS.Withdrawn) chevs.push({ label: 'Withdrawn', sub: '', state: 'todo' });
  if (req.status === REQUEST_STATUS.Expired) chevs.push({ label: 'Expired', sub: '', state: 'stop' });
  if (req.status === REQUEST_STATUS.AmendmentInProgress) chevs.unshift({ label: 'Amendment', sub: 'reapproval', state: 'current' });
  return chevs;
}

const CLS: Record<State, string> = { done: 'chev-done', current: 'chev-current', todo: 'chev-todo', stop: 'chev-stop' };

export function WorkflowChevrons({ req }: { req: FullRequest }) {
  const chevs = buildChevrons(req);
  if (chevs.length === 0) return null;
  return (
    <div className="card p-4">
      <div className="text-xs font-semibold text-[var(--ecs-muted)] mb-2">
        Workflow{isResearchRequest(req) && <span className="ml-1 pill-navy">Research</span>}
      </div>
      <div className="chev-row overflow-x-auto">
        {chevs.map((c, i) => (
          <div key={i} className="flex items-center">
            {i > 0 && <span className="chev-conn" />}
            <div className={`chev ${CLS[c.state]}`}>
              <div className="font-semibold">{c.label}</div>
              {c.sub && <div className="opacity-80">{c.sub}</div>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
