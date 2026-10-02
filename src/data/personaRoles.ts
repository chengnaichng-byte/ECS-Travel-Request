// §4.1 Persona/role catalogue for the "Acting as" switcher. The ECS role model is
// reused and extended for the Pre-Trip Travel Request module: the first dropdown picks
// the ROLE, the second picks the PERSON assigned that role. Assignments are derived
// from the ECS employee roles and the delegation register (not hard-coded lists), so
// they map to the OutSystems role/assignment model.
import { employees, type Employee } from './employees';
import { delegations } from './delegations';
import { ROLE } from '@/shared/enums';

export type RoleStage = 'REQUEST' | 'CLAIM' | 'ADMIN';
export interface PersonaRoleDef { key: string; label: string; note: string; stage: RoleStage }

/** Stage groupings shown as optgroups in the role dropdown. */
export const STAGE_LABELS: Record<RoleStage, string> = {
  REQUEST: 'Travel request — raise & approve',
  CLAIM: 'Expense claim (after conversion)',
  ADMIN: 'Administration',
};
export const STAGE_ORDER: RoleStage[] = ['REQUEST', 'CLAIM', 'ADMIN'];

// Roles that participate in the TRAVEL-REQUEST route come first; the Verifier and
// Claimant are ECS CLAIM-stage roles (a Verifier is not configured to approve travel
// requests), so they are grouped separately.
export const PERSONA_ROLES: PersonaRoleDef[] = [
  { key: 'REQUESTOR', label: 'Requestor (traveller)', stage: 'REQUEST', note: 'Raises their own travel request; becomes the Claimant once it converts to a claim (§13.13).' },
  { key: 'PA', label: 'PA — Group Requestor', stage: 'REQUEST', note: 'Raises requests (including group) on behalf of travellers; is not a traveller (§13.14).' },
  { key: 'DELEGATE', label: 'Delegate', stage: 'REQUEST', note: 'Raises travel requests — and claims — on behalf of a traveller (the same ECS delegation, §13.13).' },
  { key: 'RO', label: 'Reporting Officer (RO)', stage: 'REQUEST', note: "First-line approver derived from the traveller's reporting line." },
  { key: 'ADDITIONAL_APPROVER', label: 'Additional Approver', stage: 'REQUEST', note: 'Optional extra approver inserted into the route (ECS approval role).' },
  { key: 'DOA', label: 'DOA (incl. Research DOA)', stage: 'REQUEST', note: 'Delegation-of-authority approver; the research line applies to research-charged requests.' },
  { key: 'EXCEPTION_APPROVER', label: 'Exception Approver', stage: 'REQUEST', note: 'Approves policy exceptions such as a class upgrade or hotel over cap.' },
  { key: 'CLAIMANT', label: 'Claimant', stage: 'CLAIM', note: 'The traveller who submits the expense claim after the trip (ECS claim role).' },
  { key: 'VERIFIER', label: 'Verifier', stage: 'CLAIM', note: 'Verifies the expense claim before DOA approval — an ECS claim-stage role, not a travel-request approver.' },
  { key: 'ADMIN', label: 'Travel Administrator', stage: 'ADMIN', note: 'Manages the workbench, overrides and integration contracts (§8.3).' },
  { key: 'SYSTEM_ADMIN', label: 'System Administrator', stage: 'ADMIN', note: 'Configures the Pre-Trip Module Settings (TR-19) — routing switches, thresholds, caps basis, declaration/COI text (§3.4/§43).' },
  { key: 'FINANCE_VIEWER', label: 'Finance (read-only)', stage: 'ADMIN', note: 'Read-only finance oversight — booking pipeline, commitments, cross-charge and exceptions (§41).' },
];

const delegateIds = new Set(delegations.map((d) => d.delegateId));

/** People assigned a given role, derived from ECS employee roles + delegations. */
export function peopleForRole(key: string): Employee[] {
  switch (key) {
    case 'REQUESTOR':
    case 'CLAIMANT': return employees.filter((e) => e.isTraveller);
    case 'PA': return employees.filter((e) => e.roles.includes(ROLE.TravelRequestor) && !e.isTraveller);
    case 'DELEGATE': return employees.filter((e) => delegateIds.has(e.id));
    case 'RO': return employees.filter((e) => e.roles.includes(ROLE.RO));
    case 'DOA': return employees.filter((e) => e.roles.includes(ROLE.DOA) || e.roles.includes(ROLE.ResearchDOA));
    case 'EXCEPTION_APPROVER': return employees.filter((e) => e.roles.includes(ROLE.ExceptionApprover));
    case 'ADMIN': return employees.filter((e) => e.roles.includes(ROLE.TravelAdmin));
    case 'SYSTEM_ADMIN': return employees.filter((e) => e.roles.includes(ROLE.SystemAdmin));
    case 'FINANCE_VIEWER': return employees.filter((e) => e.roles.includes(ROLE.FinanceViewer));
    // ECS additional approver — any approval-capable officer may be added to a route.
    case 'ADDITIONAL_APPROVER': {
      const approver = new Set<string>([ROLE.RO, ROLE.DOA, ROLE.ResearchDOA, ROLE.ExceptionApprover]);
      return employees.filter((e) => e.roles.some((r) => approver.has(r)));
    }
    // ECS verifier — the Travel Administrator performs verification in the prototype.
    case 'VERIFIER': return employees.filter((e) => e.roles.includes(ROLE.TravelAdmin));
    default: return [];
  }
}

/** role key → assignable people (id/name/title), for the switcher. */
export function peopleByRole(): Record<string, { id: string; name: string; title: string }[]> {
  return Object.fromEntries(
    PERSONA_ROLES.map((r) => [r.key, peopleForRole(r.key).map((e) => ({ id: e.id, name: e.name, title: e.title }))]),
  );
}

// Priority for choosing a person's "home" role as the default selection — most
// specific first, so a DOA lands on DOA rather than the broader Additional Approver.
const DEFAULT_ROLE_PRIORITY = ['SYSTEM_ADMIN', 'FINANCE_VIEWER', 'ADMIN', 'EXCEPTION_APPROVER', 'DOA', 'RO', 'PA', 'DELEGATE', 'VERIFIER', 'ADDITIONAL_APPROVER', 'REQUESTOR', 'CLAIMANT'];

/** The role a person is first offered under (drives the default role selection). */
export function defaultRoleFor(personId: string): string {
  for (const key of DEFAULT_ROLE_PRIORITY) if (peopleForRole(key).some((e) => e.id === personId)) return key;
  return 'REQUESTOR';
}
