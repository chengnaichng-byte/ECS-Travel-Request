// §13.x Default university-wide teaching calendar — the factory set seeded into the editable
// AcademicTerm master (admin-maintained on the Academic Calendar setup screen). Representative NTU
// AY2026/2027 periods. TEACHING + EXAM are "term time"; BREAK is "non-term time". The non-term-research
// derivation tests a trip's travel window against these.
export interface AcademicTermDefault {
  academicYear: string;
  name: string;
  type: 'TEACHING' | 'EXAM' | 'BREAK';
  startDate: string; // ISO yyyy-mm-dd
  endDate: string;
  sortOrder: number;
}

export const defaultAcademicTerms: AcademicTermDefault[] = [
  { academicYear: '2026/2027', name: 'Semester 1 — Teaching', type: 'TEACHING', startDate: '2026-08-10', endDate: '2026-11-13', sortOrder: 1 },
  { academicYear: '2026/2027', name: 'Semester 1 — Recess week', type: 'BREAK', startDate: '2026-09-21', endDate: '2026-09-27', sortOrder: 2 },
  { academicYear: '2026/2027', name: 'Semester 1 — Examinations', type: 'EXAM', startDate: '2026-11-23', endDate: '2026-12-04', sortOrder: 3 },
  { academicYear: '2026/2027', name: 'Vacation (Dec–Jan)', type: 'BREAK', startDate: '2026-12-05', endDate: '2027-01-10', sortOrder: 4 },
  { academicYear: '2026/2027', name: 'Semester 2 — Teaching', type: 'TEACHING', startDate: '2027-01-11', endDate: '2027-04-16', sortOrder: 5 },
  { academicYear: '2026/2027', name: 'Semester 2 — Recess week', type: 'BREAK', startDate: '2027-02-22', endDate: '2027-02-28', sortOrder: 6 },
  { academicYear: '2026/2027', name: 'Semester 2 — Examinations', type: 'EXAM', startDate: '2027-04-26', endDate: '2027-05-07', sortOrder: 7 },
  { academicYear: '2026/2027', name: 'Vacation / Special terms', type: 'BREAK', startDate: '2027-05-08', endDate: '2027-08-09', sortOrder: 8 },
];
