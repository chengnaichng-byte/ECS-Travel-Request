-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ModuleSettings" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'SETTINGS',
    "sameRouteResearch" BOOLEAN NOT NULL DEFAULT false,
    "expenseScope" TEXT NOT NULL DEFAULT 'ALL',
    "hotelEstimateBasis" TEXT NOT NULL DEFAULT 'LOWER',
    "airfareTreatment" TEXT NOT NULL DEFAULT 'IN_TE',
    "teLinkageMandatory" TEXT NOT NULL DEFAULT 'CONDITIONAL',
    "approvalAmountBasis" TEXT NOT NULL DEFAULT 'NET_NTU',
    "groupTravelEnabled" BOOLEAN NOT NULL DEFAULT true,
    "groupSubItineraries" BOOLEAN NOT NULL DEFAULT true,
    "exceptionApproverRequired" BOOLEAN NOT NULL DEFAULT true,
    "crossBaThresholdSgd" INTEGER NOT NULL DEFAULT 500,
    "selfBookingEnabled" BOOLEAN NOT NULL DEFAULT true,
    "selfApprovalLimitSgd" INTEGER NOT NULL DEFAULT 0,
    "attachmentMaxMb" INTEGER NOT NULL DEFAULT 7,
    "chargingSplitMode" TEXT NOT NULL DEFAULT 'PERCENT',
    "declarationText" TEXT NOT NULL DEFAULT 'I confirm that the trip is for official purposes, the estimated costs are reasonable, and the itinerary and personal travel days are accurate.',
    "coiText" TEXT NOT NULL DEFAULT 'I declare no conflict of interest arising from this trip or its funding source.',
    "sftpConfig" TEXT NOT NULL DEFAULT 'sftp://tmc-gateway.example:22 (key: ECS_TMC_2026)',
    "authorisationValidityDays" INTEGER NOT NULL DEFAULT 30,
    "bookingDeadlineDays" INTEGER NOT NULL DEFAULT 14,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_ModuleSettings" ("airfareTreatment", "approvalAmountBasis", "attachmentMaxMb", "authorisationValidityDays", "bookingDeadlineDays", "chargingSplitMode", "coiText", "crossBaThresholdSgd", "declarationText", "exceptionApproverRequired", "expenseScope", "groupSubItineraries", "groupTravelEnabled", "hotelEstimateBasis", "id", "sameRouteResearch", "selfApprovalLimitSgd", "selfBookingEnabled", "sftpConfig", "teLinkageMandatory", "updatedAt") SELECT "airfareTreatment", "approvalAmountBasis", "attachmentMaxMb", "authorisationValidityDays", "bookingDeadlineDays", "chargingSplitMode", "coiText", "crossBaThresholdSgd", "declarationText", "exceptionApproverRequired", "expenseScope", "groupSubItineraries", "groupTravelEnabled", "hotelEstimateBasis", "id", "sameRouteResearch", "selfApprovalLimitSgd", "selfBookingEnabled", "sftpConfig", "teLinkageMandatory", "updatedAt" FROM "ModuleSettings";
DROP TABLE "ModuleSettings";
ALTER TABLE "new_ModuleSettings" RENAME TO "ModuleSettings";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

