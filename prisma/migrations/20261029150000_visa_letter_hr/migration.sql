-- §4.13 Visa-letter notification now informs HR (not the immigration office); the HR officer email
-- is a runtime-configurable module setting. Additive columns with defaults.
ALTER TABLE "ModuleSettings" ADD COLUMN "visaLetterHrOfficer" TEXT NOT NULL DEFAULT 'HR Immigration & Passes Office';
ALTER TABLE "ModuleSettings" ADD COLUMN "visaLetterHrEmail" TEXT NOT NULL DEFAULT 'hr-immigration@ntu.edu.sg';
