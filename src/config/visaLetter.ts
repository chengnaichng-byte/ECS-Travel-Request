// §4.13 Visa letter notification configuration. The notification informs HR (the HR Immigration &
// Passes Office / officer), NOT the immigration office. The HR officer and email are a runtime module
// setting (Pre-Trip Module Settings), so the administrator maintains who receives the daily batch.
export interface VisaLetterRecipient { office: string; email: string; }

/** The HR officer that receives the visa-letter notification, from the module settings (with a
 *  sensible default if unset). */
export function visaLetterRecipient(s: { visaLetterHrOfficer?: string | null; visaLetterHrEmail?: string | null }): VisaLetterRecipient {
  return {
    office: s.visaLetterHrOfficer?.trim() || 'HR Immigration & Passes Office',
    email: s.visaLetterHrEmail?.trim() || 'hr-immigration@ntu.edu.sg',
  };
}
