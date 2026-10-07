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
    "groupMaxTravellers" INTEGER NOT NULL DEFAULT 10,
    "groupSubItineraries" BOOLEAN NOT NULL DEFAULT true,
    "exceptionApproverRequired" BOOLEAN NOT NULL DEFAULT true,
    "roRequirement" TEXT NOT NULL DEFAULT 'INDIVIDUAL_ONLY',
    "teAutoGrantTolerancePct" INTEGER NOT NULL DEFAULT 10,
    "teAutoGrantToleranceAbsSgd" INTEGER NOT NULL DEFAULT 500,
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
INSERT INTO "new_ModuleSettings" ("airfareTreatment", "approvalAmountBasis", "attachmentMaxMb", "authorisationValidityDays", "bookingDeadlineDays", "chargingSplitMode", "coiText", "crossBaThresholdSgd", "declarationText", "exceptionApproverRequired", "expenseScope", "groupSubItineraries", "groupTravelEnabled", "hotelEstimateBasis", "id", "roRequirement", "sameRouteResearch", "selfApprovalLimitSgd", "selfBookingEnabled", "sftpConfig", "teAutoGrantToleranceAbsSgd", "teAutoGrantTolerancePct", "teLinkageMandatory", "updatedAt") SELECT "airfareTreatment", "approvalAmountBasis", "attachmentMaxMb", "authorisationValidityDays", "bookingDeadlineDays", "chargingSplitMode", "coiText", "crossBaThresholdSgd", "declarationText", "exceptionApproverRequired", "expenseScope", "groupSubItineraries", "groupTravelEnabled", "hotelEstimateBasis", "id", "roRequirement", "sameRouteResearch", "selfApprovalLimitSgd", "selfBookingEnabled", "sftpConfig", "teAutoGrantToleranceAbsSgd", "teAutoGrantTolerancePct", "teLinkageMandatory", "updatedAt" FROM "ModuleSettings";
DROP TABLE "ModuleSettings";
ALTER TABLE "new_ModuleSettings" RENAME TO "ModuleSettings";
CREATE TABLE "new_TravelRequestTraveller" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "requestId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "travellerType" TEXT NOT NULL DEFAULT 'EMPLOYEE',
    "guestName" TEXT,
    "guestEmail" TEXT,
    "guestOrg" TEXT,
    "confirmed" BOOLEAN NOT NULL DEFAULT false,
    "confirmedAt" DATETIME,
    "sharePct" REAL NOT NULL DEFAULT 100,
    "isRequestor" BOOLEAN NOT NULL DEFAULT false,
    "entitledClassId" TEXT,
    "chosenClassId" TEXT,
    "classBasis" TEXT,
    "classJustification" TEXT,
    "ownStartDate" DATETIME,
    "ownEndDate" DATETIME,
    "legOverrideNote" TEXT,
    CONSTRAINT "TravelRequestTraveller_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "TravelRequest" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_TravelRequestTraveller" ("chosenClassId", "classBasis", "classJustification", "confirmed", "confirmedAt", "employeeId", "entitledClassId", "id", "isRequestor", "legOverrideNote", "ownEndDate", "ownStartDate", "requestId", "sharePct") SELECT "chosenClassId", "classBasis", "classJustification", "confirmed", "confirmedAt", "employeeId", "entitledClassId", "id", "isRequestor", "legOverrideNote", "ownEndDate", "ownStartDate", "requestId", "sharePct" FROM "TravelRequestTraveller";
DROP TABLE "TravelRequestTraveller";
ALTER TABLE "new_TravelRequestTraveller" RENAME TO "TravelRequestTraveller";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
