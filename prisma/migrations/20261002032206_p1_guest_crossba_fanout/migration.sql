-- AlterTable
ALTER TABLE "TravelBooking" ADD COLUMN "travellerId" TEXT;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ModuleSettings" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'SETTINGS',
    "roRequired" BOOLEAN NOT NULL DEFAULT true,
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
    "authorisationValidityDays" INTEGER NOT NULL DEFAULT 30,
    "bookingDeadlineDays" INTEGER NOT NULL DEFAULT 14,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_ModuleSettings" ("airfareTreatment", "approvalAmountBasis", "authorisationValidityDays", "bookingDeadlineDays", "exceptionApproverRequired", "expenseScope", "groupSubItineraries", "groupTravelEnabled", "hotelEstimateBasis", "id", "roRequired", "sameRouteResearch", "selfBookingEnabled", "teLinkageMandatory", "updatedAt") SELECT "airfareTreatment", "approvalAmountBasis", "authorisationValidityDays", "bookingDeadlineDays", "exceptionApproverRequired", "expenseScope", "groupSubItineraries", "groupTravelEnabled", "hotelEstimateBasis", "id", "roRequired", "sameRouteResearch", "selfBookingEnabled", "teLinkageMandatory", "updatedAt" FROM "ModuleSettings";
DROP TABLE "ModuleSettings";
ALTER TABLE "new_ModuleSettings" RENAME TO "ModuleSettings";
CREATE TABLE "new_TravelRequest" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "requestNumber" TEXT NOT NULL,
    "authorisationNo" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Draft',
    "bookingStatus" TEXT NOT NULL DEFAULT 'Not Sent',
    "isGroup" BOOLEAN NOT NULL DEFAULT false,
    "requestorId" TEXT NOT NULL,
    "travellerId" TEXT NOT NULL,
    "travellerType" TEXT NOT NULL DEFAULT 'EMPLOYEE',
    "guestName" TEXT,
    "guestEmail" TEXT,
    "guestOrg" TEXT,
    "additionalApproverId" TEXT,
    "entityId" TEXT,
    "departmentId" TEXT,
    "isResearch" BOOLEAN NOT NULL DEFAULT false,
    "purposeId" TEXT,
    "description" TEXT,
    "destCountry" TEXT,
    "destCity" TEXT,
    "startDate" DATETIME,
    "endDate" DATETIME,
    "personalStart" DATETIME,
    "personalEnd" DATETIME,
    "travelClassId" TEXT,
    "entitledClassId" TEXT,
    "classBasis" TEXT,
    "classJustification" TEXT,
    "bookingMethod" TEXT,
    "approvalAmountSgd" REAL,
    "bookingDeadline" DATETIME,
    "authorisationExpiry" DATETIME,
    "currentVersion" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_TravelRequest" ("additionalApproverId", "approvalAmountSgd", "authorisationExpiry", "authorisationNo", "bookingDeadline", "bookingMethod", "bookingStatus", "classBasis", "classJustification", "createdAt", "currentVersion", "departmentId", "description", "destCity", "destCountry", "endDate", "entitledClassId", "entityId", "id", "isGroup", "isResearch", "personalEnd", "personalStart", "purposeId", "requestNumber", "requestorId", "startDate", "status", "travelClassId", "travellerId", "updatedAt") SELECT "additionalApproverId", "approvalAmountSgd", "authorisationExpiry", "authorisationNo", "bookingDeadline", "bookingMethod", "bookingStatus", "classBasis", "classJustification", "createdAt", "currentVersion", "departmentId", "description", "destCity", "destCountry", "endDate", "entitledClassId", "entityId", "id", "isGroup", "isResearch", "personalEnd", "personalStart", "purposeId", "requestNumber", "requestorId", "startDate", "status", "travelClassId", "travellerId", "updatedAt" FROM "TravelRequest";
DROP TABLE "TravelRequest";
ALTER TABLE "new_TravelRequest" RENAME TO "TravelRequest";
CREATE UNIQUE INDEX "TravelRequest_requestNumber_key" ON "TravelRequest"("requestNumber");
CREATE UNIQUE INDEX "TravelRequest_authorisationNo_key" ON "TravelRequest"("authorisationNo");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
