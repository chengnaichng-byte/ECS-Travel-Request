-- §4.13 The visa-letter batch becomes an automatic daily timer; record its last run so it fires at
-- most once per day. Nullable (never run yet).
ALTER TABLE "ModuleSettings" ADD COLUMN "visaLetterBatchLastRunAt" DATETIME;
