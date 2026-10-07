// §13.7 / §13.16 personas. Employee, organisation, reporting line and roles are
// ECS/HR-derived (§2). RO is derived from reportingOfficerId; DOA from charging
// department + amount band (see src/data/organisation.ts and workflow.ts).
import { ROLE, type Role } from '@/shared/enums';

export interface Employee {
  id: string;
  name: string;
  title: string;
  departmentId: string;
  reportingOfficerId: string | null; // RO derivation source
  roles: Role[];
  isTraveller: boolean;
  travelPolicyGroup: string;         // §13.7 travel-class entitlement group
  // §7 traveller prepopulation — ECS/HR-derived profile carried onto the request.
  workerType?: 'ACADEMIC' | 'RESEARCH' | 'ADMIN' | 'EXECUTIVE';
  email?: string;
  businessArea?: string;             // SAP business area (cost context)
  defaultChargingCode?: string;      // default CC/WBS pre-filled on new requests
  travelEligible?: boolean;          // HR travel eligibility flag
}

/** §7 derive a default ntu.edu.sg email from the display name (mock HR). */
function ntuEmail(name: string): string {
  return `${name.replace(/^(Dr|Prof|Mr|Ms|Mrs)\s+/i, '').toLowerCase().replace(/[^a-z]+/g, '.')}@ntu.edu.sg`;
}

const baseEmployees: Employee[] = [
  { id: 'E-TRAV',  name: 'Dr Alice Tan',      title: 'Senior Lecturer',            departmentId: 'SCH-CS', reportingOfficerId: 'E-RO',   roles: [ROLE.Traveller], isTraveller: true,  travelPolicyGroup: 'FACULTY' },
  { id: 'E-TRAV2', name: 'Dr Grace Ho',        title: 'Lecturer',                   departmentId: 'SCH-CS', reportingOfficerId: 'E-RO',   roles: [ROLE.Traveller], isTraveller: true,  travelPolicyGroup: 'FACULTY' },
  { id: 'E-TRAV3', name: 'Dr Henry Ong',       title: 'Research Fellow',            departmentId: 'RI-AI',  reportingOfficerId: 'E-RO2',  roles: [ROLE.Traveller], isTraveller: true,  travelPolicyGroup: 'RESEARCH' },
  { id: 'E-TRAV4', name: 'Dr Jason Lee',       title: 'Assistant Professor',        departmentId: 'SCH-CS', reportingOfficerId: 'E-RO',   roles: [ROLE.Traveller], isTraveller: true,  travelPolicyGroup: 'FACULTY' },
  { id: 'E-TRAV5', name: 'Dr Karen Yeo',       title: 'Senior Research Fellow',     departmentId: 'RI-AI',  reportingOfficerId: 'E-RO2',  roles: [ROLE.Traveller], isTraveller: true,  travelPolicyGroup: 'RESEARCH' },
  { id: 'E-TRAV6', name: 'Dr Leon Tan',        title: 'Lecturer',                   departmentId: 'SCH-CS', reportingOfficerId: 'E-RO',   roles: [ROLE.Traveller], isTraveller: true,  travelPolicyGroup: 'FACULTY' },
  { id: 'E-TRAV7', name: 'Dr Mabel Ng',        title: 'Research Fellow',            departmentId: 'RI-AI',  reportingOfficerId: 'E-RO2',  roles: [ROLE.Traveller], isTraveller: true,  travelPolicyGroup: 'RESEARCH' },
  { id: 'E-TRAV8', name: 'Dr Nadia Rahman',    title: 'Senior Lecturer',            departmentId: 'SCH-CS', reportingOfficerId: 'E-RO',   roles: [ROLE.Traveller], isTraveller: true,  travelPolicyGroup: 'FACULTY' },
  { id: 'E-PA',    name: 'Priya Nair',         title: 'Admin Executive (PA)',       departmentId: 'SCH-CS', reportingOfficerId: 'E-RO',   roles: [ROLE.TravelRequestor], isTraveller: false, travelPolicyGroup: 'ADMIN' },
  { id: 'E-RO',    name: 'Prof Ben Lim',       title: 'Head, SCSE',                 departmentId: 'SCH-CS', reportingOfficerId: 'E-DEAN', roles: [ROLE.RO, ROLE.Traveller], isTraveller: true, travelPolicyGroup: 'SENIOR' },
  { id: 'E-RO2',   name: 'Prof Ivy Chua',      title: 'Director, RI-AI',            departmentId: 'RI-AI',  reportingOfficerId: 'E-RDIR', roles: [ROLE.RO, ROLE.Traveller], isTraveller: true, travelPolicyGroup: 'SENIOR' },
  { id: 'E-DOA',   name: 'Prof Carol Wong',    title: 'Associate Dean (Finance)',   departmentId: 'SCH-CS', reportingOfficerId: 'E-DEAN', roles: [ROLE.DOA], isTraveller: false, travelPolicyGroup: 'SENIOR' },
  { id: 'E-DEAN',  name: 'Prof Daniel Sim',    title: 'Dean, College of Engineering', departmentId: 'SCH-CS', reportingOfficerId: 'E-PROVOST', roles: [ROLE.DOA], isTraveller: false, travelPolicyGroup: 'SENIOR' },
  { id: 'E-PROVOST', name: 'Prof Quek Li Mei', title: 'Provost',                    departmentId: 'SCH-CS', reportingOfficerId: null,     roles: [ROLE.DOA], isTraveller: false, travelPolicyGroup: 'SENIOR' },
  { id: 'E-RDOA',  name: 'Prof Farah Aziz',    title: 'Associate Director (Research)', departmentId: 'RI-AI', reportingOfficerId: 'E-RDIR', roles: [ROLE.ResearchDOA, ROLE.DOA], isTraveller: false, travelPolicyGroup: 'SENIOR' },
  { id: 'E-RDIR',  name: 'Prof Raj Menon',     title: 'Research Director',          departmentId: 'RI-AI',  reportingOfficerId: 'E-PROVOST', roles: [ROLE.DOA], isTraveller: false, travelPolicyGroup: 'SENIOR' },
  { id: 'E-EXC',   name: 'Prof Eng Seng',      title: 'Policy Exception Approver',  departmentId: 'SCH-CS', reportingOfficerId: 'E-PROVOST', roles: [ROLE.ExceptionApprover], isTraveller: false, travelPolicyGroup: 'SENIOR' },
  { id: 'E-ADMIN', name: 'David Kumar',        title: 'Travel Administrator',       departmentId: 'SCH-CS', reportingOfficerId: 'E-RO',   roles: [ROLE.TravelAdmin], isTraveller: false, travelPolicyGroup: 'ADMIN' },
  { id: 'E-SYS',   name: 'System Administrator', title: 'ECS System Administrator', departmentId: 'SCH-CS', reportingOfficerId: 'E-RO',   roles: [ROLE.SystemAdmin], isTraveller: false, travelPolicyGroup: 'ADMIN' },
  { id: 'E-FIN',   name: 'Lim Mei Ling',        title: 'Finance Analyst (Travel)', departmentId: 'SCH-CS', reportingOfficerId: 'E-DOA',  roles: [ROLE.FinanceViewer], isTraveller: false, travelPolicyGroup: 'ADMIN' },
];

// §7 enrich each employee with HR-derived profile defaults (worker type, email, business
// area, default charging, eligibility) so new requests pre-populate a complete traveller.
const DEPT_BA: Record<string, string> = { 'SCH-CS': 'BA-CS', 'RI-AI': 'BA-AI' };
const DEPT_DEFAULT_CC: Record<string, string> = { 'SCH-CS': 'CC-1000', 'RI-AI': 'CC-2000' };
const WORKER_BY_GROUP: Record<string, Employee['workerType']> = { FACULTY: 'ACADEMIC', RESEARCH: 'RESEARCH', SENIOR: 'EXECUTIVE', ADMIN: 'ADMIN' };

export const employees: Employee[] = baseEmployees.map((e) => ({
  ...e,
  workerType: e.workerType ?? WORKER_BY_GROUP[e.travelPolicyGroup] ?? 'ADMIN',
  email: e.email ?? ntuEmail(e.name),
  businessArea: e.businessArea ?? DEPT_BA[e.departmentId] ?? undefined,
  defaultChargingCode: e.defaultChargingCode ?? DEPT_DEFAULT_CC[e.departmentId],
  travelEligible: e.travelEligible ?? e.isTraveller,
}));

/** The persona switcher offers these identities (§4.1 role/context). */
export const PERSONA_IDS = ['E-TRAV', 'E-TRAV2', 'E-TRAV3', 'E-PA', 'E-RO', 'E-RO2', 'E-DOA', 'E-DEAN', 'E-RDOA', 'E-RDIR', 'E-EXC', 'E-ADMIN', 'E-SYS', 'E-FIN'];
