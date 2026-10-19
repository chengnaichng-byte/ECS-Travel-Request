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
    "groupGuestMixAllowed" BOOLEAN NOT NULL DEFAULT true,
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
    "emergencyLeadDays" INTEGER NOT NULL DEFAULT 14,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_ModuleSettings" ("airfareTreatment", "approvalAmountBasis", "attachmentMaxMb", "authorisationValidityDays", "bookingDeadlineDays", "chargingSplitMode", "coiText", "crossBaThresholdSgd", "declarationText", "exceptionApproverRequired", "expenseScope", "groupGuestMixAllowed", "groupMaxTravellers", "groupSubItineraries", "groupTravelEnabled", "hotelEstimateBasis", "id", "roRequirement", "sameRouteResearch", "selfApprovalLimitSgd", "selfBookingEnabled", "sftpConfig", "teAutoGrantToleranceAbsSgd", "teAutoGrantTolerancePct", "teLinkageMandatory", "updatedAt") SELECT "airfareTreatment", "approvalAmountBasis", "attachmentMaxMb", "authorisationValidityDays", "bookingDeadlineDays", "chargingSplitMode", "coiText", "crossBaThresholdSgd", "declarationText", "exceptionApproverRequired", "expenseScope", "groupGuestMixAllowed", "groupMaxTravellers", "groupSubItineraries", "groupTravelEnabled", "hotelEstimateBasis", "id", "roRequirement", "sameRouteResearch", "selfApprovalLimitSgd", "selfBookingEnabled", "sftpConfig", "teAutoGrantToleranceAbsSgd", "teAutoGrantTolerancePct", "teLinkageMandatory", "updatedAt" FROM "ModuleSettings";
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
    "selectedDoaId" TEXT,
    "provostId" TEXT,
    "isEmergency" BOOLEAN NOT NULL DEFAULT false,
    "isRetrospective" BOOLEAN NOT NULL DEFAULT false,
    "emergencyJustification" TEXT,
    "emergencyAuthoriserId" TEXT,
    "emergencyRatified" BOOLEAN NOT NULL DEFAULT false,
    "emergencyOutsideWindow" BOOLEAN NOT NULL DEFAULT false,
    "entityId" TEXT,
    "departmentId" TEXT,
    "isResearch" BOOLEAN NOT NULL DEFAULT false,
    "purposeId" TEXT,
    "description" TEXT,
    "tripType" TEXT NOT NULL DEFAULT 'ROUND_TRIP',
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
    "tmcProviderId" TEXT,
    "eventStartDate" DATETIME,
    "eventEndDate" DATETIME,
    "invitationRef" TEXT,
    "travelClassId" TEXT,
    "entitledClassId" TEXT,
    "classBasis" TEXT,
    "classJustification" TEXT,
    "bookingArrangement" TEXT DEFAULT 'AUTO',
    "bookingMethod" TEXT,
    "chargingMode" TEXT NOT NULL DEFAULT 'REQUEST',
    "approvalAmountSgd" REAL,
    "bookingDeadline" DATETIME,
    "authorisationExpiry" DATETIME,
    "currentVersion" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_TravelRequest" ("additionalApproverId", "approvalAmountSgd", "authorisationExpiry", "authorisationNo", "bookingArrangement", "bookingDeadline", "bookingMethod", "bookingStatus", "chargingMode", "classBasis", "classJustification", "createdAt", "currentVersion", "departmentId", "description", "destCity", "destCountry", "emergencyAuthoriserId", "emergencyJustification", "emergencyRatified", "endDate", "entitledClassId", "entityId", "eventEndDate", "eventStartDate", "guestEmail", "guestName", "guestOrg", "highRiskAck", "highRiskApproverAck", "id", "invitationRef", "isEmergency", "isGroup", "isResearch", "isRetrospective", "personalAck", "personalEnd", "personalStart", "provostId", "purposeId", "requestNumber", "requestorId", "selectedDoaId", "startDate", "status", "tmcProviderId", "travelClassId", "travellerId", "travellerType", "tripType", "updatedAt", "visaLetterNotifiedAt", "visaLetterRequired") SELECT "additionalApproverId", "approvalAmountSgd", "authorisationExpiry", "authorisationNo", "bookingArrangement", "bookingDeadline", "bookingMethod", "bookingStatus", "chargingMode", "classBasis", "classJustification", "createdAt", "currentVersion", "departmentId", "description", "destCity", "destCountry", "emergencyAuthoriserId", "emergencyJustification", "emergencyRatified", "endDate", "entitledClassId", "entityId", "eventEndDate", "eventStartDate", "guestEmail", "guestName", "guestOrg", "highRiskAck", "highRiskApproverAck", "id", "invitationRef", "isEmergency", "isGroup", "isResearch", "isRetrospective", "personalAck", "personalEnd", "personalStart", "provostId", "purposeId", "requestNumber", "requestorId", "selectedDoaId", "startDate", "status", "tmcProviderId", "travelClassId", "travellerId", "travellerType", "tripType", "updatedAt", "visaLetterNotifiedAt", "visaLetterRequired" FROM "TravelRequest";
DROP TABLE "TravelRequest";
ALTER TABLE "new_TravelRequest" RENAME TO "TravelRequest";
CREATE UNIQUE INDEX "TravelRequest_requestNumber_key" ON "TravelRequest"("requestNumber");
CREATE UNIQUE INDEX "TravelRequest_authorisationNo_key" ON "TravelRequest"("authorisationNo");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
