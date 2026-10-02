// §13.7 Organisation — one school and one research institute with reporting lines
// supporting RO derivation, plus DOA lines (tiered escalation) per department.

export interface Department {
  id: string;
  name: string;
  kind: 'SCHOOL' | 'RESEARCH_INSTITUTE';
  headId: string;           // Reporting Officer source for the department
  doaLine: string[];        // DOA escalation chain, index 0 = tier 1 (§13.7 amount bands)
  researchDoaLine?: string[]; // research route DOA chain (§6.2)
}

export const departments: Department[] = [
  {
    id: 'SCH-CS',
    name: 'School of Computer Science & Engineering',
    kind: 'SCHOOL',
    headId: 'E-RO',
    doaLine: ['E-DOA', 'E-DEAN', 'E-PROVOST'],
  },
  {
    id: 'RI-AI',
    name: 'Research Institute for Artificial Intelligence',
    kind: 'RESEARCH_INSTITUTE',
    headId: 'E-RO2',
    doaLine: ['E-RDOA', 'E-RDIR', 'E-PROVOST'],
    researchDoaLine: ['E-RDOA', 'E-RDIR', 'E-PROVOST'],
  },
];

export const ENTITY_ID = 'NTU';
export const ENTITY_NAME = 'Nanyang Technological University';
