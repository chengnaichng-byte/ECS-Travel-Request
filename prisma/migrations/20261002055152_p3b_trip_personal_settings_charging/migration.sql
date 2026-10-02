-- AlterTable
ALTER TABLE "ChargingAllocation" ADD COLUMN "amountSgd" REAL;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ItineraryLeg" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "requestId" TEXT NOT NULL,
    "travellerId" TEXT,
    "seq" INTEGER NOT NULL,
    "originCode" TEXT NOT NULL,
    "destCode" TEXT NOT NULL,
    "departDate" DATETIME,
    "arriveDate" DATETIME,
    "transportMode" TEXT NOT NULL DEFAULT 'AIR',
    "durationHours" REAL,
    "departTime" TEXT,
    "bookingRequired" BOOLEAN NOT NULL DEFAULT true,
    "isPersonal" BOOLEAN NOT NULL DEFAULT false,
    "nights" INTEGER NOT NULL DEFAULT 0,
    "travelClassId" TEXT,
    "entitledClassId" TEXT,
    "chosenClassId" TEXT,
    CONSTRAINT "ItineraryLeg_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "TravelRequest" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_ItineraryLeg" ("arriveDate", "chosenClassId", "departDate", "destCode", "durationHours", "entitledClassId", "id", "isPersonal", "nights", "originCode", "requestId", "seq", "transportMode", "travelClassId", "travellerId") SELECT "arriveDate", "chosenClassId", "departDate", "destCode", "durationHours", "entitledClassId", "id", "isPersonal", "nights", "originCode", "requestId", "seq", "transportMode", "travelClassId", "travellerId" FROM "ItineraryLeg";
DROP TABLE "ItineraryLeg";
ALTER TABLE "new_ItineraryLeg" RENAME TO "ItineraryLeg";
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
INSERT INTO "new_ModuleSettings" ("airfareTreatment", "approvalAmountBasis", "authorisationValidityDays", "bookingDeadlineDays", "crossBaThresholdSgd", "exceptionApproverRequired", "expenseScope", "groupSubItineraries", "groupTravelEnabled", "hotelEstimateBasis", "id", "roRequired", "sameRouteResearch", "selfBookingEnabled", "teLinkageMandatory", "updatedAt") SELECT "airfareTreatment", "approvalAmountBasis", "authorisationValidityDays", "bookingDeadlineDays", "crossBaThresholdSgd", "exceptionApproverRequired", "expenseScope", "groupSubItineraries", "groupTravelEnabled", "hotelEstimateBasis", "id", "roRequired", "sameRouteResearch", "selfBookingEnabled", "teLinkageMandatory", "updatedAt" FROM "ModuleSettings";
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
    "personalAck" BOOLEAN NOT NULL DEFAULT false,
    "eventStartDate" DATETIME,
    "eventEndDate" DATETIME,
    "invitationRef" TEXT,
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
INSERT INTO "new_TravelRequest" ("additionalApproverId", "approvalAmountSgd", "authorisationExpiry", "authorisationNo", "bookingDeadline", "bookingMethod", "bookingStatus", "classBasis", "classJustification", "createdAt", "currentVersion", "departmentId", "description", "destCity", "destCountry", "endDate", "entitledClassId", "entityId", "guestEmail", "guestName", "guestOrg", "id", "isGroup", "isResearch", "personalEnd", "personalStart", "purposeId", "requestNumber", "requestorId", "startDate", "status", "travelClassId", "travellerId", "travellerType", "updatedAt") SELECT "additionalApproverId", "approvalAmountSgd", "authorisationExpiry", "authorisationNo", "bookingDeadline", "bookingMethod", "bookingStatus", "classBasis", "classJustification", "createdAt", "currentVersion", "departmentId", "description", "destCity", "destCountry", "endDate", "entitledClassId", "entityId", "guestEmail", "guestName", "guestOrg", "id", "isGroup", "isResearch", "personalEnd", "personalStart", "purposeId", "requestNumber", "requestorId", "startDate", "status", "travelClassId", "travellerId", "travellerType", "updatedAt" FROM "TravelRequest";
DROP TABLE "TravelRequest";
ALTER TABLE "new_TravelRequest" RENAME TO "TravelRequest";
CREATE UNIQUE INDEX "TravelRequest_requestNumber_key" ON "TravelRequest"("requestNumber");
CREATE UNIQUE INDEX "TravelRequest_authorisationNo_key" ON "TravelRequest"("authorisationNo");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
