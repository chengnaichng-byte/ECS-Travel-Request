// §4.13 Visa letter notification configuration. Recipient determination is by
// organisational unit (department) with a University-wide default office. In production
// this is a configurable mapping maintained by the administrator.
export interface VisaLetterRecipient { office: string; email: string; }

/** University-wide default immigration/passes office. */
export const defaultVisaLetterRecipient: VisaLetterRecipient = {
  office: 'HR Immigration & Passes Office',
  email: 'immigration@ntu.edu.sg',
};

/** Optional per-department overrides (by departmentId). */
export const visaLetterRecipientByDept: Record<string, VisaLetterRecipient> = {
  'RI-AI': { office: 'RI-AI Research Admin (Immigration)', email: 'ri-ai.immigration@ntu.edu.sg' },
};

export function visaLetterRecipientFor(departmentId: string | null | undefined): VisaLetterRecipient {
  return (departmentId && visaLetterRecipientByDept[departmentId]) || defaultVisaLetterRecipient;
}
