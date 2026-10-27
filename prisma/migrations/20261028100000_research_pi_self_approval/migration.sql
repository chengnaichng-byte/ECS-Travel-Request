-- #1 Research PI self-approval toggle on the module settings. A research-WBS request raised for a
-- PI traveller, within the self-approval limit, is self-approved (the PI is the DOA).
ALTER TABLE "ModuleSettings" ADD COLUMN "researchPiSelfApproval" BOOLEAN NOT NULL DEFAULT true;
