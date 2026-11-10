'use client';
// TR-02 create form — Individual / Group / Guest (§13.14, §8). A GROUP roster may combine employees
// (from the ECS directory), students (an uploaded, non-validated list) and guests (uploaded non-
// employees: name / email / organisation), in any mix of >=2 members — employee-only, employee+student,
// employee+guest, all three, or students+guests with no staff. Student mixing is gated by the mixed-
// group setting and guest mixing by groupGuestMixAllowed; the one-traveller Guest tab is for a lone
// guest. The charging account is chosen on THIS screen (defaulted from the profile,
// overridable); its isResearch flag drives the Travel Classification badge and, downstream, research
// routing and non-term eligibility.
import { useState, useRef } from 'react';
import { createDraft, createGroupDraft, createGuestDraft } from '@/modules/pretrip/actions';

interface Charging { code: string; name: string; overridden?: boolean; workday?: string | null }
interface Account { code: string; name: string; isResearch: boolean }
interface Opt { id: string; name: string; title: string; dept: string; email?: string; delegated: boolean; roName?: string | null; charging?: Charging | null }
interface StudentRow { name: string; email: string; studentId: string; programme: string }
interface GuestRow { name: string; email: string; org: string }
const MODE_LABEL = { individual: 'Individual', group: 'Group', guest: 'Guest' } as const;
type Mode = keyof typeof MODE_LABEL;
type GroupKind = 'staff' | 'student';
type MemberTab = 'search' | 'bulk';
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024; // 5 MB

/** A read-only, ECS/HR-derived field (RO) — styled like the "Requestor (you)" box so it reads as
 *  derived, not an input. Muted text aligns with the provenance language (derived = muted). */
function DerivedField({ label, value, hint, muted, info }: { label: string; value: React.ReactNode; hint?: string; muted?: boolean; info?: boolean }) {
  return (
    <div>
      <label className="label inline-flex items-center gap-1">{label}{info && <InfoIcon />}</label>
      <div className={`text-sm px-3 py-2 bg-[var(--ecs-panel-2)] rounded border border-[var(--ecs-border)] ${muted ? 'text-[var(--ecs-muted)]' : ''}`}>{value}</div>
      {hint && <p className="text-xs text-[var(--ecs-muted)] mt-1">{hint}</p>}
    </div>
  );
}

const InfoIcon = () => (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="var(--prov-default)" strokeWidth="1.8" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 7.5v.5" /></svg>
);
const FlaskIcon = ({ color }: { color: string }) => (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 3h6M10 3v6l-4.5 8.2A2 2 0 0 0 7.3 20h9.4a2 2 0 0 0 1.8-2.8L14 9V3" /><path d="M8.2 14h7.6" /></svg>
);
const BuildingIcon = ({ color }: { color: string }) => (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="4" y="3" width="16" height="18" rx="1" /><path d="M8 7h2M14 7h2M8 11h2M14 11h2M8 15h2M14 15h2M10 21v-3h4v3" /></svg>
);
const ModeIcon = ({ m }: { m: Mode }) => {
  const c = 'currentColor';
  if (m === 'group') return <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke={c} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="9" cy="8" r="3" /><path d="M3.5 20a5.5 5.5 0 0 1 11 0" /><circle cx="17" cy="9" r="2.3" /><path d="M16 14.5a4.6 4.6 0 0 1 4.5 5.5" /></svg>;
  if (m === 'guest') return <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke={c} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="10" cy="8" r="3.2" /><path d="M4 20a6 6 0 0 1 12 0" /><path d="M18 7v6M21 10h-6" /></svg>;
  return <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke={c} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="3.2" /><path d="M5.5 20a6.5 6.5 0 0 1 13 0" /></svg>;
};

/** Travel Classification — read-only, derived from the selected charging account's isResearch flag.
 *  Research (research WBS) → flask, green; otherwise → building, neutral. The same flag governs
 *  research approval routing and non-term research eligibility downstream. */
function TravelClassification({ isResearch }: { isResearch: boolean }) {
  const green = '#1f7a4d';
  return (
    <div className={`rounded-md border p-3 mt-4 ${isResearch ? 'border-[#bfe3cc] bg-[#eef7f1]' : 'border-[var(--ecs-border)] bg-[var(--ecs-panel-2)]'}`}>
      <div className="label inline-flex items-center gap-1 mb-2" style={isResearch ? { color: green } : undefined}>Travel Classification <InfoIcon /></div>
      <div className="flex items-center gap-3">
        <span className={`inline-flex items-center justify-center w-10 h-10 rounded-md ${isResearch ? 'bg-[#d8eede]' : 'bg-[var(--ecs-panel)]'}`}>
          {isResearch ? <FlaskIcon color={green} /> : <BuildingIcon color="var(--ecs-muted)" />}
        </span>
        <span className={isResearch ? 'pill-pass' : 'pill-info'}>{isResearch ? 'Research Travel' : 'Non-Research Travel'}</span>
        <span className="border-l border-[var(--ecs-border)] pl-3 text-sm text-[var(--ecs-muted)]">Automatically derived from the selected charging account.</span>
      </div>
    </div>
  );
}

export function NewRequestForm({ persona, isRequestor, options, groupOptions, groupMax, groupEnabled, studentGroupEnabled, mixedGroupEnabled, groupGuestMixAllowed, requestorCharging, chargingAccounts, entityName }: {
  persona: { name: string; title: string }; isRequestor: boolean;
  options: Opt[]; groupOptions: Opt[]; groupMax: number; groupEnabled: boolean; studentGroupEnabled: boolean; mixedGroupEnabled: boolean; groupGuestMixAllowed: boolean;
  requestorCharging?: Charging | null; chargingAccounts: Account[]; entityName: string;
}) {
  const [mode, setMode] = useState<Mode>('individual');
  const defaultTraveller = options[0]?.id;
  const [travellerId, setTravellerId] = useState<string>(defaultTraveller ?? '');
  const selectedTraveller = options.find((o) => o.id === travellerId) ?? options[0];
  const modes: Mode[] = groupEnabled ? ['individual', 'group', 'guest'] : ['individual', 'guest'];

  const firstCode = chargingAccounts[0]?.code ?? '';
  // Default charging codes per context (individual → traveller's profile account; group/guest →
  // the requestor/host's). Fall back to the first active account when none is on the profile.
  const indivDefaultCode = selectedTraveller?.charging?.code ?? firstCode;
  const requestorDefaultCode = requestorCharging?.code ?? firstCode;
  const [chargingCode, setChargingCode] = useState<string>(indivDefaultCode);
  const researchOf = (code: string) => !!chargingAccounts.find((a) => a.code === code)?.isResearch;

  // Switching the traveller (individual) re-defaults the charging account to that traveller's profile.
  const onTraveller = (id: string) => { setTravellerId(id); setChargingCode(options.find((o) => o.id === id)?.charging?.code ?? firstCode); };
  // Switching mode re-defaults the charging account to that context's default.
  const switchMode = (m: Mode) => { setMode(m); setChargingCode(m === 'individual' ? (selectedTraveller?.charging?.code ?? firstCode) : requestorDefaultCode); };

  const [groupKind, setGroupKind] = useState<GroupKind>('staff');
  const [memberTab, setMemberTab] = useState<MemberTab>('search');

  // Staff-group employee selection
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [importNote, setImportNote] = useState<string>('');
  const [importErrors, setImportErrors] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [focused, setFocused] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Student-group state (uploaded, non-validated student rows)
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [studentTab, setStudentTab] = useState<MemberTab>('search'); // 'search' == manual add
  const [studentNote, setStudentNote] = useState<string>('');
  const [studentErrors, setStudentErrors] = useState<string[]>([]);
  const studentFileRef = useRef<HTMLInputElement>(null);
  const setStudent = (i: number, p: Partial<StudentRow>) => setStudents((s) => s.map((r, j) => j === i ? { ...r, ...p } : r));
  const addStudent = () => setStudents((s) => [...s, { name: '', email: '', studentId: '', programme: '' }]);
  const delStudent = (i: number) => setStudents((s) => s.filter((_, j) => j !== i));
  const namedStudents = students.filter((s) => s.name.trim());
  const studentTotal = namedStudents.length;
  const studentOver = studentTotal > groupMax;
  const studentTooFew = studentTotal < 2;

  // §8 Guest-member state (uploaded, non-validated guest rows — name / email / organisation). Like
  // students, guests carry no cost share and file no claim; passport/DOB are collected later by the TMC.
  const [guests, setGuests] = useState<GuestRow[]>([]);
  const [guestTab, setGuestTab] = useState<MemberTab>('search');
  const [guestNote, setGuestNote] = useState<string>('');
  const [guestErrors, setGuestErrors] = useState<string[]>([]);
  const guestFileRef = useRef<HTMLInputElement>(null);
  const setGuest = (i: number, p: Partial<GuestRow>) => setGuests((g) => g.map((r, j) => j === i ? { ...r, ...p } : r));
  const addGuest = () => setGuests((g) => [...g, { name: '', email: '', org: '' }]);
  const delGuest = (i: number) => setGuests((g) => g.filter((_, j) => j !== i));
  const namedGuests = guests.filter((g) => g.name.trim());
  const guestTotal = namedGuests.length;

  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const total = selected.size;
  const over = total > groupMax;
  const tooFew = total < 2;
  // §13.14/§8 mixed group — the group roster may combine employees, students (when the mixed-group
  // setting is on) and guests (when guest-mixing is on), so the party total counts all three. A group
  // may be any mix of >=2 categories, and students + guests may form a group with no staff.
  const studentsIncluded = mixedGroupEnabled && studentGroupEnabled;
  const guestsIncluded = groupGuestMixAllowed;
  const grpTotal = total + (studentsIncluded ? studentTotal : 0) + (guestsIncluded ? guestTotal : 0);
  const grpOver = grpTotal > groupMax;
  const grpTooFew = grpTotal < 2;

  const optById = new Map(groupOptions.map((o) => [o.id, o] as const));
  const q = query.trim().toLowerCase();
  const matchesAll = groupOptions.filter((o) => !selected.has(o.id)
    && (!q || [o.name, o.dept, o.title, o.id, o.email ?? ''].some((v) => v.toLowerCase().includes(q))));
  const matches = matchesAll.slice(0, 8);
  const moreCount = matchesAll.length - matches.length;
  const addEmployee = (id: string) => { setSelected((s) => new Set(s).add(id)); setQuery(''); };

  const resolveEmp = (key: string): Opt | undefined => {
    const k = key.trim().toLowerCase();
    if (!k) return undefined;
    return groupOptions.find((o) => o.id.toLowerCase() === k)
      ?? groupOptions.find((o) => (o.email ?? '').toLowerCase() === k)
      ?? groupOptions.find((o) => o.name.toLowerCase() === k);
  };

  // Bulk-import EMPLOYEE members from Excel/CSV. Columns (case-insensitive): Employee ID · Name · Email.
  // Guests are not mixed into a group, so non-matching rows are reported as errors.
  const onExcel = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) await importMembers(file);
    if (fileRef.current) fileRef.current.value = '';
  };
  const importMembers = async (file: File) => {
    setImportNote(''); setImportErrors([]);
    if (file.size > MAX_UPLOAD_BYTES) { setImportErrors([`File is too large (${(file.size / 1048576).toFixed(1)} MB). Maximum is 5 MB.`]); return; }
    try {
      const XLSX = await import('xlsx');
      const wb = XLSX.read(new Uint8Array(await file.arrayBuffer()), { type: 'array' });
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]], { defval: '' });
      const pick = (row: Record<string, string>, ...keys: string[]) => { for (const k of keys) { const v = row[k]; if (v != null && String(v).trim()) return String(v).trim(); } return ''; };
      const addEmp = new Set<string>(selected);
      const errs: string[] = [];
      let nEmp = 0;
      rows.forEach((raw, i) => {
        const row: Record<string, string> = {};
        for (const [k, v] of Object.entries(raw)) row[k.trim().toLowerCase()] = v == null ? '' : String(v);
        const empId = pick(row, 'employee id', 'employeeid', 'staff id', 'id');
        const name = pick(row, 'name', 'traveller', 'full name');
        const email = pick(row, 'email', 'e-mail');
        if (!empId && !name && !email) return; // blank row
        const emp = resolveEmp(empId || name || email);
        if (emp) { if (!addEmp.has(emp.id)) { addEmp.add(emp.id); nEmp++; } }
        else errs.push(`Row ${i + 2}: no employee matches "${empId || name || email}".`);
      });
      setSelected(addEmp);
      setImportErrors(errs);
      setImportNote(nEmp ? `Added ${nEmp} employee${nEmp > 1 ? 's' : ''} from ${file.name}.` : `No new employees found in ${file.name}.`);
    } catch (err) {
      setImportErrors([`Could not read the file — ${(err as Error).message}. Expected .xlsx, .xls or .csv.`]);
    }
  };
  const downloadTemplate = async () => {
    const XLSX = await import('xlsx');
    const ws = XLSX.utils.json_to_sheet([
      { 'Employee ID': groupOptions[0]?.id ?? 'E-TRAV', Name: groupOptions[0]?.name ?? '', Email: groupOptions[0]?.email ?? '' },
    ], { header: ['Employee ID', 'Name', 'Email'] });
    ws['!cols'] = [{ wch: 14 }, { wch: 26 }, { wch: 28 }];
    const dir = groupOptions.map((o) => ({ 'Employee ID': o.id, Name: o.name, Department: o.dept, Email: o.email ?? '' }));
    const ws2 = XLSX.utils.json_to_sheet(dir); ws2['!cols'] = [{ wch: 14 }, { wch: 26 }, { wch: 40 }, { wch: 28 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Members');
    XLSX.utils.book_append_sheet(wb, ws2, 'Employee directory');
    XLSX.writeFile(wb, 'group-members-template.xlsx');
  };

  const onStudentExcel = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) await importStudents(file);
    if (studentFileRef.current) studentFileRef.current.value = '';
  };
  const importStudents = async (file: File) => {
    setStudentNote(''); setStudentErrors([]);
    if (file.size > MAX_UPLOAD_BYTES) { setStudentErrors([`File is too large (${(file.size / 1048576).toFixed(1)} MB). Maximum is 5 MB.`]); return; }
    try {
      const XLSX = await import('xlsx');
      const wb = XLSX.read(new Uint8Array(await file.arrayBuffer()), { type: 'array' });
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]], { defval: '' });
      const pick = (row: Record<string, string>, ...keys: string[]) => { for (const k of keys) { const v = row[k]; if (v != null && String(v).trim()) return String(v).trim(); } return ''; };
      const next: StudentRow[] = [...students];
      const errs: string[] = [];
      let n = 0;
      rows.forEach((raw, i) => {
        const row: Record<string, string> = {};
        for (const [k, v] of Object.entries(raw)) row[k.trim().toLowerCase()] = v == null ? '' : String(v);
        const name = pick(row, 'name', 'student name', 'full name');
        const email = pick(row, 'email', 'e-mail', 'student email');
        const studentId = pick(row, 'student id', 'studentid', 'matriculation', 'matric no', 'matric', 'id');
        const programme = pick(row, 'programme', 'program', 'school', 'course', 'faculty');
        if (!name && !email && !studentId) return;
        if (!name) { errs.push(`Row ${i + 2}: a student needs a name.`); return; }
        if (!next.some((s) => s.name.trim().toLowerCase() === name.toLowerCase())) { next.push({ name, email, studentId, programme }); n++; }
      });
      setStudents(next);
      setStudentErrors(errs);
      setStudentNote(n ? `Imported ${n} student${n > 1 ? 's' : ''} from ${file.name}.` : `No new students found in ${file.name}.`);
    } catch (err) {
      setStudentErrors([`Could not read the file — ${(err as Error).message}. Expected .xlsx, .xls or .csv.`]);
    }
  };
  const downloadStudentTemplate = async () => {
    const XLSX = await import('xlsx');
    const ws = XLSX.utils.json_to_sheet([
      { Name: 'Tan Wei Ming', Email: 'weiming.tan@e.ntu.edu.sg', 'Student ID': 'U2312345A', Programme: 'BEng Computer Science' },
    ], { header: ['Name', 'Email', 'Student ID', 'Programme'] });
    ws['!cols'] = [{ wch: 24 }, { wch: 28 }, { wch: 14 }, { wch: 28 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Students');
    XLSX.writeFile(wb, 'student-group-template.xlsx');
  };

  const onGuestExcel = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) await importGuests(file);
    if (guestFileRef.current) guestFileRef.current.value = '';
  };
  const importGuests = async (file: File) => {
    setGuestNote(''); setGuestErrors([]);
    if (file.size > MAX_UPLOAD_BYTES) { setGuestErrors([`File is too large (${(file.size / 1048576).toFixed(1)} MB). Maximum is 5 MB.`]); return; }
    try {
      const XLSX = await import('xlsx');
      const wb = XLSX.read(new Uint8Array(await file.arrayBuffer()), { type: 'array' });
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]], { defval: '' });
      const pick = (row: Record<string, string>, ...keys: string[]) => { for (const k of keys) { const v = row[k]; if (v != null && String(v).trim()) return String(v).trim(); } return ''; };
      const next: GuestRow[] = [...guests];
      const errs: string[] = [];
      let n = 0;
      rows.forEach((raw, i) => {
        const row: Record<string, string> = {};
        for (const [k, v] of Object.entries(raw)) row[k.trim().toLowerCase()] = v == null ? '' : String(v);
        const name = pick(row, 'name', 'guest name', 'full name');
        const email = pick(row, 'email', 'e-mail', 'guest email');
        const org = pick(row, 'organisation', 'organization', 'home organisation', 'org', 'affiliation', 'institution');
        if (!name && !email && !org) return;
        if (!name) { errs.push(`Row ${i + 2}: a guest needs a name.`); return; }
        if (!next.some((g) => g.name.trim().toLowerCase() === name.toLowerCase())) { next.push({ name, email, org }); n++; }
      });
      setGuests(next);
      setGuestErrors(errs);
      setGuestNote(n ? `Imported ${n} guest${n > 1 ? 's' : ''} from ${file.name}.` : `No new guests found in ${file.name}.`);
    } catch (err) {
      setGuestErrors([`Could not read the file — ${(err as Error).message}. Expected .xlsx, .xls or .csv.`]);
    }
  };
  const downloadGuestTemplate = async () => {
    const XLSX = await import('xlsx');
    const ws = XLSX.utils.json_to_sheet([
      { Name: 'Prof Maria Santos', Email: 'maria.santos@example.edu', Organisation: 'MIT' },
    ], { header: ['Name', 'Email', 'Organisation'] });
    ws['!cols'] = [{ wch: 24 }, { wch: 30 }, { wch: 24 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Guests');
    XLSX.writeFile(wb, 'guest-group-template.xlsx');
  };

  // Shared: RO (read-only) + Charging Account (editable dropdown) + Travel Classification badge.
  const ChargingBlock = ({ roValue, roHint }: { roValue: React.ReactNode; roHint: string }) => (
    <>
      <div className="grid grid-cols-2 gap-4">
        <DerivedField label="Reporting Officer (RO)" info muted value={roValue} hint={roHint} />
        <div>
          <label className="label inline-flex items-center gap-1">Charging Account <span className="text-[var(--ecs-red)]">*</span><InfoIcon /></label>
          <select name="chargingCode" value={chargingCode} onChange={(e) => setChargingCode(e.target.value)} className="field txt-default" required>
            {chargingAccounts.map((a) => <option key={a.code} value={a.code}>{a.code} — {a.name}</option>)}
          </select>
          <p className="text-xs text-[var(--ecs-muted)] mt-1">Defaulted from Profile. You may change the charging account if required.</p>
        </div>
      </div>
      <TravelClassification isResearch={researchOf(chargingCode)} />
    </>
  );

  const Upload = ({ onPick, onTemplate, inputRef, onChange }: { onPick: () => void; onTemplate: () => void; inputRef: React.RefObject<HTMLInputElement | null>; onChange: (e: React.ChangeEvent<HTMLInputElement>) => void }) => (
    <div className="rounded-md border border-[var(--ecs-border)] bg-[var(--ecs-panel-2)] p-4">
      <div className="flex items-start gap-3">
        <span className="inline-flex items-center justify-center w-11 h-11 rounded-full bg-[var(--ecs-panel)] shrink-0 text-[var(--ecs-navy)]">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8z" /><path d="M14 3v5h5M9 13h6M9 16h6" /></svg>
        </span>
        <div className="flex-1">
          <div className="text-sm font-semibold text-[var(--ecs-navy)]">Upload an Excel or CSV file</div>
          <div className="text-xs text-[var(--ecs-muted)] mt-0.5">Use the template to ensure the correct format. The file should contain the traveller details to add to this group request.</div>
          <div className="flex items-center gap-2 mt-3">
            <button type="button" className="btn-primary text-sm" onClick={onPick}>⬆ Upload Excel / CSV</button>
            <button type="button" className="btn-secondary text-sm" onClick={onTemplate}>⬇ Download template</button>
          </div>
          <div className="text-xs text-[var(--ecs-muted)] mt-2">Accepted file types: .xlsx, .xls, .csv. Maximum file size: 5 MB.</div>
        </div>
      </div>
      <input ref={inputRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={onChange} />
    </div>
  );

  const SubTab = ({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) => (
    <button type="button" onClick={onClick} className={`px-1 pb-2 text-sm font-medium border-b-2 -mb-px ${active ? 'border-[var(--ecs-navy)] text-[var(--ecs-navy)]' : 'border-transparent text-[var(--ecs-muted)] hover:text-[var(--ecs-navy)]'}`}>{children}</button>
  );

  // §13.14 student-member entry card (manual rows or Excel bulk-upload; uploaded, not validated) —
  // shared by the student-only group form and the mixed (staff + student) group form.
  const studentMembersCard = (heading: string) => (
    <div className="card mt-4">
      <div className="card-head flex items-center justify-between"><span>{heading}</span><span className="text-xs font-normal text-[var(--ecs-muted)]">Students carry no cost share and file no claim</span></div>
      <div className="p-4">
        <div className="flex gap-5 border-b border-[var(--ecs-border)] mb-4">
          <SubTab active={studentTab === 'search'} onClick={() => setStudentTab('search')}>Add manually</SubTab>
          <SubTab active={studentTab === 'bulk'} onClick={() => setStudentTab('bulk')}>Bulk add from Excel</SubTab>
        </div>
        {studentTab === 'bulk' ? (
          <>
            <Upload onPick={() => studentFileRef.current?.click()} onTemplate={downloadStudentTemplate} inputRef={studentFileRef} onChange={onStudentExcel} />
            {studentNote && <p className="text-xs text-[var(--ecs-navy-2)] mt-2">{studentNote}</p>}
            {studentErrors.length > 0 && <ul className="text-xs text-[var(--ecs-red)] mt-1 list-disc pl-4">{studentErrors.map((er, i) => <li key={i}>{er}</li>)}</ul>}
          </>
        ) : (
          <button type="button" className="btn-secondary text-sm" onClick={addStudent}>＋ Add student</button>
        )}
        <div className="text-sm font-semibold text-[var(--ecs-navy)] mt-5 mb-2">Students — uploaded details, not validated ({studentTotal})</div>
        {students.length === 0 ? (
          <div className="rounded-md border border-[var(--ecs-border)] p-8 text-center text-sm text-[var(--ecs-muted)]">No students added yet. Add manually or use bulk add to build the party.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr><th className="th">Name</th><th className="th">Email</th><th className="th">Student ID</th><th className="th">Programme</th><th className="th">Actions</th></tr></thead>
              <tbody>
                {students.map((s, i) => (
                  <tr key={i}>
                    <td className="td"><input className="field" placeholder="Student name" value={s.name} onChange={(e) => setStudent(i, { name: e.target.value })} /></td>
                    <td className="td"><input className="field" placeholder="Email (optional)" value={s.email} onChange={(e) => setStudent(i, { email: e.target.value })} /></td>
                    <td className="td"><input className="field" placeholder="Matric no." value={s.studentId} onChange={(e) => setStudent(i, { studentId: e.target.value })} /></td>
                    <td className="td"><input className="field" placeholder="Programme" value={s.programme} onChange={(e) => setStudent(i, { programme: e.target.value })} /></td>
                    <td className="td"><button type="button" className="btn-ghost text-xs" onClick={() => delStudent(i)} aria-label="Remove">✕</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );

  // §8 guest-member entry card (manual rows or Excel bulk-upload; uploaded, not validated) — mirrors
  // the student card. Guests capture name / email / organisation; passport/DOB come via the TMC link.
  const guestMembersCard = (heading: string) => (
    <div className="card mt-4">
      <div className="card-head flex items-center justify-between"><span>{heading}</span><span className="text-xs font-normal text-[var(--ecs-muted)]">Guests carry no cost share and file no claim; Economy applies unless an exception is approved</span></div>
      <div className="p-4">
        <div className="flex gap-5 border-b border-[var(--ecs-border)] mb-4">
          <SubTab active={guestTab === 'search'} onClick={() => setGuestTab('search')}>Add manually</SubTab>
          <SubTab active={guestTab === 'bulk'} onClick={() => setGuestTab('bulk')}>Bulk add from Excel</SubTab>
        </div>
        {guestTab === 'bulk' ? (
          <>
            <Upload onPick={() => guestFileRef.current?.click()} onTemplate={downloadGuestTemplate} inputRef={guestFileRef} onChange={onGuestExcel} />
            {guestNote && <p className="text-xs text-[var(--ecs-navy-2)] mt-2">{guestNote}</p>}
            {guestErrors.length > 0 && <ul className="text-xs text-[var(--ecs-red)] mt-1 list-disc pl-4">{guestErrors.map((er, i) => <li key={i}>{er}</li>)}</ul>}
          </>
        ) : (
          <button type="button" className="btn-secondary text-sm" onClick={addGuest}>＋ Add guest</button>
        )}
        <div className="text-sm font-semibold text-[var(--ecs-navy)] mt-5 mb-2">Guests — non-employees ({guestTotal})</div>
        {guests.length === 0 ? (
          <div className="rounded-md border border-[var(--ecs-border)] p-8 text-center text-sm text-[var(--ecs-muted)]">No guests added yet. Add manually or use bulk add. Passport / date of birth are collected later by the TMC (§8, DD-21).</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr><th className="th">Name</th><th className="th">Email</th><th className="th">Home organisation</th><th className="th">Actions</th></tr></thead>
              <tbody>
                {guests.map((g, i) => (
                  <tr key={i}>
                    <td className="td"><input className="field" placeholder="Guest name" value={g.name} onChange={(e) => setGuest(i, { name: e.target.value })} /></td>
                    <td className="td"><input className="field" placeholder="Email (optional)" value={g.email} onChange={(e) => setGuest(i, { email: e.target.value })} /></td>
                    <td className="td"><input className="field" placeholder="e.g. MIT" value={g.org} onChange={(e) => setGuest(i, { org: e.target.value })} /></td>
                    <td className="td"><button type="button" className="btn-ghost text-xs" onClick={() => delGuest(i)} aria-label="Remove">✕</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div>
      {/* Request-type tabs (icon cards) */}
      <div className="card p-1.5 mb-4 flex w-fit gap-1">
        {modes.map((m) => (
          <button key={m} type="button" onClick={() => switchMode(m)}
            className={`w-40 inline-flex items-center justify-center gap-2 py-3 rounded-md font-semibold text-sm transition-colors ${mode === m ? 'bg-[var(--ecs-navy)] text-white' : 'text-[var(--ecs-navy)] hover:bg-[var(--ecs-panel-2)]'}`}>
            <ModeIcon m={m} /> {MODE_LABEL[m]}
          </button>
        ))}
      </div>

      {mode === 'guest' ? (
        <form action={createGuestDraft}>
          <div className="card">
            <div className="card-head">Guest / Non-Employee Traveller</div>
            <div className="p-4 space-y-4">
              <div>
                <label className="label">Host / Requestor (you)</label>
                <div className="text-sm px-3 py-2 bg-[var(--ecs-panel-2)] rounded border border-[var(--ecs-border)]">{persona.name} — {persona.title}{isRequestor && <span className="pill-info ml-2">Travel Requestor</span>}</div>
              </div>
              <ChargingBlock roValue="Not Applicable — guest travel has no traveller RO" roHint="Determined by the configured guest approval workflow." />
            </div>
          </div>
          <div className="card mt-4">
            <div className="card-head">Guest Details</div>
            <div className="p-4 space-y-4">
              <div>
                <label className="label" htmlFor="guestName">Guest name <span className="text-[var(--ecs-red)]">*</span></label>
                <input id="guestName" name="guestName" required className="field" placeholder="e.g. Prof Maria Santos" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div><label className="label" htmlFor="guestEmail">Guest email <span className="text-[var(--ecs-red)]">*</span></label><input id="guestEmail" name="guestEmail" type="email" required className="field" placeholder="e.g. maria.santos@example.edu" /></div>
                <div><label className="label" htmlFor="guestOrg">Home organisation <span className="text-[var(--ecs-red)]">*</span></label><input id="guestOrg" name="guestOrg" required className="field" placeholder="e.g. MIT" /></div>
              </div>
              <p className="text-xs text-[var(--ecs-muted)]">Guest travel is charged to the selected account. Economy class applies unless an exception is approved (§8, AC7).</p>
            </div>
          </div>
          <div className="mt-4 flex justify-end"><button className="btn-primary">Create guest draft →</button></div>
        </form>
      ) : mode === 'individual' ? (
        <form action={createDraft}>
          <div className="card">
            <div className="card-head">Traveller</div>
            <div className="p-4 space-y-4">
              <div>
                <label className="label">Requestor (you)</label>
                <div className="text-sm px-3 py-2 bg-[var(--ecs-panel-2)] rounded border border-[var(--ecs-border)]">{persona.name} — {persona.title}{isRequestor && <span className="pill-info ml-2">Travel Requestor</span>}</div>
              </div>
              <div>
                <label className="label" htmlFor="travellerId">Traveller <span className="text-[var(--ecs-red)]">*</span></label>
                <select id="travellerId" name="travellerId" className="field" value={travellerId} onChange={(e) => onTraveller(e.target.value)}>
                  {options.map((e) => <option key={e.id} value={e.id}>{e.name} — {e.title} ({e.dept}){e.delegated ? ' · Delegated' : ''}</option>)}
                </select>
                {isRequestor && <p className="text-xs text-[var(--ecs-muted)] mt-1">You are creating this request on behalf of the selected traveller. Travel entitlements and approval routing will follow the traveller.</p>}
              </div>
              <ChargingBlock roValue={selectedTraveller?.roName ?? '— none on file —'} roHint="Automatically derived from Workday." />
            </div>
          </div>
          <div className="mt-4 flex justify-end"><button className="btn-primary">Create draft →</button></div>
        </form>
      ) : (
        <>
          {studentGroupEnabled && !mixedGroupEnabled && (
            <div className="card p-1.5 mb-4 flex w-fit gap-1">
              <button type="button" onClick={() => setGroupKind('staff')} className={`w-40 py-3 rounded-md font-semibold text-sm ${groupKind === 'staff' ? 'bg-[var(--ecs-navy)] text-white' : 'text-[var(--ecs-navy)] hover:bg-[var(--ecs-panel-2)]'}`}>Staff group</button>
              <button type="button" onClick={() => setGroupKind('student')} className={`w-40 py-3 rounded-md font-semibold text-sm ${groupKind === 'student' ? 'bg-[var(--ecs-navy)] text-white' : 'text-[var(--ecs-navy)] hover:bg-[var(--ecs-panel-2)]'}`}>Student group</button>
            </div>
          )}

          {groupKind === 'student' ? (
            <form action={createGroupDraft}>
              <input type="hidden" name="groupType" value="STUDENT" />
              <input type="hidden" name="studentsJson" value={JSON.stringify(namedStudents.map((s) => ({ name: s.name.trim(), email: s.email.trim(), studentId: s.studentId.trim(), programme: s.programme.trim() })))} />
              <div className="card">
                <div className="card-head flex items-center justify-between"><span>Group Travellers</span><span className={`text-xs font-normal ${studentOver ? 'text-[var(--ecs-red)]' : 'text-[var(--ecs-muted)]'}`}>{studentTotal} of {groupMax} travellers</span></div>
                <div className="p-4 space-y-4">
                  <div>
                    <label className="label">Requestor / Coordinator (you)</label>
                    <div className="text-sm px-3 py-2 bg-[var(--ecs-panel-2)] rounded border border-[var(--ecs-border)]">{persona.name} — {persona.title}{isRequestor && <span className="pill-info ml-2">Travel Requestor</span>}</div>
                  </div>
                  <ChargingBlock roValue="Not Applicable — RO approval not required for group travel" roHint="Determined by the configured group approval workflow." />
                </div>
              </div>

              {studentMembersCard('Add Group Members')}
              <p className="text-xs text-[var(--ecs-muted)] mt-3">Approved once on the group total; the DOA is derived from the host (requestor&apos;s) department. Students carry no individual cost share and file no claim (§13.14).</p>
              {studentOver && <p className="text-xs text-[var(--ecs-red)] mt-1">Over the limit — remove {studentTotal - groupMax} student{studentTotal - groupMax > 1 ? 's' : ''}.</p>}
              <div className="mt-4 flex items-center justify-end gap-3">
                {studentTooFew && <span className="text-xs text-[var(--ecs-muted)]">Add at least 2 students to continue.</span>}
                <button className="btn-primary" disabled={studentOver || studentTooFew}>Create student group draft →</button>
              </div>
            </form>
          ) : (
            <form action={createGroupDraft}>
              {studentsIncluded && <input type="hidden" name="studentsJson" value={JSON.stringify(namedStudents.map((s) => ({ name: s.name.trim(), email: s.email.trim(), studentId: s.studentId.trim(), programme: s.programme.trim() })))} />}
              {guestsIncluded && <input type="hidden" name="guestsJson" value={JSON.stringify(namedGuests.map((g) => ({ name: g.name.trim(), email: g.email.trim(), org: g.org.trim() })))} />}
              {[...selected].map((id) => <input key={id} type="hidden" name="travellerIds" value={id} />)}
              <div className="card">
                <div className="card-head flex items-center justify-between"><span>Group Travellers</span><span className={`text-xs font-normal ${grpOver ? 'text-[var(--ecs-red)]' : 'text-[var(--ecs-muted)]'}`}>{grpTotal} of {groupMax} {(studentsIncluded || guestsIncluded) ? 'members' : 'travellers'}</span></div>
                <div className="p-4 space-y-4">
                  <div>
                    <label className="label">Requestor (you)</label>
                    <div className="text-sm px-3 py-2 bg-[var(--ecs-panel-2)] rounded border border-[var(--ecs-border)]">{persona.name} — {persona.title}{isRequestor && <span className="pill-info ml-2">Travel Requestor</span>}</div>
                  </div>
                  <ChargingBlock roValue="Not Applicable — RO approval not required for group travel" roHint="Determined by the configured group approval workflow." />
                </div>
              </div>

              <div className="card mt-4">
                <div className="card-head flex items-center justify-between"><span>Add Group Members</span><span className="text-xs font-normal text-[var(--ecs-muted)]">Minimum 2 · Maximum {groupMax} travellers</span></div>
                <div className="p-4">
                  <div className="flex gap-5 border-b border-[var(--ecs-border)] mb-4">
                    <SubTab active={memberTab === 'search'} onClick={() => setMemberTab('search')}>Search and add</SubTab>
                    <SubTab active={memberTab === 'bulk'} onClick={() => setMemberTab('bulk')}>Bulk add from Excel</SubTab>
                  </div>

                  {memberTab === 'bulk' ? (
                    <>
                      <Upload onPick={() => fileRef.current?.click()} onTemplate={downloadTemplate} inputRef={fileRef} onChange={onExcel} />
                      {importNote && <p className="text-xs text-[var(--ecs-navy-2)] mt-2">{importNote}</p>}
                      {importErrors.length > 0 && <ul className="text-xs text-[var(--ecs-red)] mt-1 list-disc pl-4">{importErrors.map((er, i) => <li key={i}>{er}</li>)}</ul>}
                    </>
                  ) : (
                    <div className="relative">
                      <input type="text" className="field" placeholder="Search the directory by name, department or ID…"
                        value={query} onChange={(e) => setQuery(e.target.value)}
                        onFocus={() => setFocused(true)} onBlur={() => setTimeout(() => setFocused(false), 150)} />
                      {focused && (
                        <div className="absolute z-20 left-0 right-0 mt-1 bg-white border border-[var(--ecs-border)] rounded-md shadow-lg max-h-64 overflow-y-auto">
                          {matches.length === 0 ? (
                            <div className="px-3 py-2 text-sm text-[var(--ecs-muted)]">{q ? 'No matching employees.' : 'All directory employees are already selected.'}</div>
                          ) : (
                            <>
                              {matches.map((o) => (
                                <button key={o.id} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => addEmployee(o.id)}
                                  className="w-full text-left px-3 py-2 hover:bg-[var(--ecs-panel-2)] border-b border-[var(--ecs-border)] last:border-0">
                                  <span className="text-sm">{o.name}</span><span className="text-xs text-[var(--ecs-muted)]"> — {o.title} ({o.dept})</span>
                                </button>
                              ))}
                              {moreCount > 0 && <div className="px-3 py-1.5 text-xs text-[var(--ecs-muted)] bg-[var(--ecs-panel-2)]">+{moreCount} more — refine your search</div>}
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  <div className="text-sm font-semibold text-[var(--ecs-navy)] mt-5 mb-2">Selected travellers ({total})</div>
                  {selected.size === 0 ? (
                    <div className="rounded-md border border-[var(--ecs-border)] p-8 text-center text-sm text-[var(--ecs-muted)]">
                      <div className="flex justify-center mb-2 text-[var(--ecs-border)]"><ModeIcon m="group" /></div>
                      No travellers added yet. Search above or use bulk add to add travellers to the group.
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead><tr><th className="th">Name</th><th className="th">Employee ID</th><th className="th">Department</th><th className="th">Organisation</th><th className="th">Actions</th></tr></thead>
                        <tbody>
                          {[...selected].map((id) => {
                            const o = optById.get(id);
                            return (
                              <tr key={id} className="hover:bg-[var(--ecs-panel-2)]">
                                <td className="td font-medium">{o?.name ?? id}</td>
                                <td className="td font-mono text-xs">{id}</td>
                                <td className="td">{o?.dept ?? '—'}</td>
                                <td className="td">{entityName}</td>
                                <td className="td"><button type="button" className="btn-ghost text-xs" onClick={() => toggle(id)} aria-label={`Remove ${o?.name ?? id}`}>✕</button></td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}

                  <p className="text-xs text-[var(--ecs-muted)] mt-3">Each employee confirms their inclusion (§13.13). Approved once on the group total; the DOA is derived from the highest charging department. The requestor holds no cost share (§13.14).{(studentsIncluded || guestsIncluded) ? ` You can add ${[studentsIncluded && 'students', guestsIncluded && 'guests'].filter(Boolean).join(' and ')} below — uploaded, not validated; they carry no cost share, file no claim and receive no ODA. A group may be any mix of at least two members, including ${guestsIncluded ? 'students and guests without staff ' : ''}(§13.14 / §8).` : ' Guests are not added to a group — raise a separate Guest / non-employee request (§8).'}</p>
                </div>
              </div>
              {studentsIncluded && (<>
                {studentMembersCard('Add students (optional)')}
                <p className="text-xs text-[var(--ecs-muted)] mt-3">Students are uploaded and not validated; the coordinator confirms the party offline (§13.13).</p>
              </>)}
              {guestsIncluded && (<>
                {guestMembersCard('Add guests (optional)')}
                <p className="text-xs text-[var(--ecs-muted)] mt-3">Guests are non-employees (no ECS profile); the host confirms them offline (§13.13). Economy class applies unless an exception is approved (§8).</p>
              </>)}
              {grpOver && <p className="text-xs text-[var(--ecs-red)] mt-1">Over the limit — remove {grpTotal - groupMax} member{grpTotal - groupMax > 1 ? 's' : ''}.</p>}
              <div className="mt-4 flex items-center justify-end gap-3">
                {grpTooFew && <span className="text-xs text-[var(--ecs-muted)]">Add at least 2 members to continue.</span>}
                <button className="btn-primary" disabled={grpOver || grpTooFew}>Create group draft →</button>
              </div>
            </form>
          )}
        </>
      )}
    </div>
  );
}
