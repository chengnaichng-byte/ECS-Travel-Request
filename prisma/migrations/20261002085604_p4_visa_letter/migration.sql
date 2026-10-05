-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
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
    "highRiskAck" BOOLEAN NOT NULL DEFAULT false,
    "highRiskApproverAck" BOOLEAN NOT NULL DEFAULT false,
    "visaLetterRequired" BOOLEAN NOT NULL DEFAULT false,
    "visaLetterNotifiedAt" DATETIME,
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
INSERT INTO "new_TravelRequest" ("additionalApproverId", "approvalAmountSgd", "authorisationExpiry", "authorisationNo", "bookingDeadline", "bookingMethod", "bookingStatus", "classBasis", "classJustification", "createdAt", "currentVersion", "departmentId", "description", "destCity", "destCountry", "endDate", "entitledClassId", "entityId", "eventEndDate", "eventStartDate", "guestEmail", "guestName", "guestOrg", "highRiskAck", "highRiskApproverAck", "id", "invitationRef", "isGroup", "isResearch", "personalAck", "personalEnd", "personalStart", "purposeId", "requestNumber", "requestorId", "startDate", "status", "travelClassId", "travellerId", "travellerType", "updatedAt") SELECT "additionalApproverId", "approvalAmountSgd", "authorisationExpiry", "authorisationNo", "bookingDeadline", "bookingMethod", "bookingStatus", "classBasis", "classJustification", "createdAt", "currentVersion", "departmentId", "description", "destCity", "destCountry", "endDate", "entitledClassId", "entityId", "eventEndDate", "eventStartDate", "guestEmail", "guestName", "guestOrg", "highRiskAck", "highRiskApproverAck", "id", "invitationRef", "isGroup", "isResearch", "personalAck", "personalEnd", "personalStart", "purposeId", "requestNumber", "requestorId", "startDate", "status", "travelClassId", "travellerId", "travellerType", "updatedAt" FROM "TravelRequest";
DROP TABLE "TravelRequest";
ALTER TABLE "new_TravelRequest" RENAME TO "TravelRequest";
CREATE UNIQUE INDEX "TravelRequest_requestNumber_key" ON "TravelRequest"("requestNumber");
CREATE UNIQUE INDEX "TravelRequest_authorisationNo_key" ON "TravelRequest"("authorisationNo");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
