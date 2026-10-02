-- CreateTable
CREATE TABLE "ModuleSettings" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'SETTINGS',
    "roRequired" BOOLEAN NOT NULL DEFAULT true,
    "sameRouteResearch" BOOLEAN NOT NULL DEFAULT false,
    "expenseScope" TEXT NOT NULL DEFAULT 'ALL',
    "hotelEstimateBasis" TEXT NOT NULL DEFAULT 'LOWER',
    "airfareTreatment" TEXT NOT NULL DEFAULT 'IN_TE',
    "teLinkageMandatory" TEXT NOT NULL DEFAULT 'CONDITIONAL',
    "approvalAmountBasis" TEXT NOT NULL DEFAULT 'NET_NTU',
    "groupTravelEnabled" BOOLEAN NOT NULL DEFAULT true,
    "selfBookingEnabled" BOOLEAN NOT NULL DEFAULT true,
    "authorisationValidityDays" INTEGER NOT NULL DEFAULT 30,
    "bookingDeadlineDays" INTEGER NOT NULL DEFAULT 14,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "TravelRequest" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "requestNumber" TEXT NOT NULL,
    "authorisationNo" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Draft',
    "bookingStatus" TEXT NOT NULL DEFAULT 'Not Sent',
    "isGroup" BOOLEAN NOT NULL DEFAULT false,
    "requestorId" TEXT NOT NULL,
    "travellerId" TEXT NOT NULL,
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
    "bookingMethod" TEXT,
    "approvalAmountSgd" REAL,
    "bookingDeadline" DATETIME,
    "authorisationExpiry" DATETIME,
    "currentVersion" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "TravelRequestTraveller" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "requestId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "confirmed" BOOLEAN NOT NULL DEFAULT false,
    "confirmedAt" DATETIME,
    "sharePct" REAL NOT NULL DEFAULT 100,
    "isRequestor" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "TravelRequestTraveller_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "TravelRequest" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TravelRequestVersion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "requestId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "approved" BOOLEAN NOT NULL DEFAULT false,
    "snapshot" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TravelRequestVersion_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "TravelRequest" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ItineraryLeg" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "requestId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "originCode" TEXT NOT NULL,
    "destCode" TEXT NOT NULL,
    "departDate" DATETIME,
    "arriveDate" DATETIME,
    "travelClassId" TEXT,
    CONSTRAINT "ItineraryLeg_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "TravelRequest" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "EstimatedExpense" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "requestId" TEXT NOT NULL,
    "travellerId" TEXT,
    "category" TEXT NOT NULL,
    "expenseTypeId" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'SGD',
    "foreignAmount" REAL NOT NULL DEFAULT 0,
    "sgdAmount" REAL NOT NULL DEFAULT 0,
    "sponsorForeign" REAL NOT NULL DEFAULT 0,
    "sponsorSgd" REAL NOT NULL DEFAULT 0,
    "estimateBasis" TEXT,
    "expectedDate" DATETIME,
    "isShared" BOOLEAN NOT NULL DEFAULT false,
    "shareMap" TEXT,
    "notes" TEXT,
    "originCode" TEXT,
    "destCode" TEXT,
    "proposedClassId" TEXT,
    "fareCeiling" REAL,
    "handoffStatus" TEXT,
    CONSTRAINT "EstimatedExpense_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "TravelRequest" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AccommodationEstimate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "expenseId" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "checkIn" DATETIME,
    "checkOut" DATETIME,
    "nights" INTEGER NOT NULL DEFAULT 0,
    "personalNights" INTEGER NOT NULL DEFAULT 0,
    "quotedNightly" REAL NOT NULL DEFAULT 0,
    "capNightly" REAL NOT NULL DEFAULT 0,
    "budgetedNightly" REAL NOT NULL DEFAULT 0,
    "capVariance" REAL NOT NULL DEFAULT 0,
    "conferenceHotel" BOOLEAN NOT NULL DEFAULT false,
    "exceptionOutcome" TEXT,
    CONSTRAINT "AccommodationEstimate_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "EstimatedExpense" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ODAEstimate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "expenseId" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "city" TEXT,
    "arrive" DATETIME,
    "depart" DATETIME,
    "eligibleDays" INTEGER NOT NULL DEFAULT 0,
    "personalDays" INTEGER NOT NULL DEFAULT 0,
    "dailyRate" REAL NOT NULL DEFAULT 0,
    "ratePct" REAL NOT NULL DEFAULT 100,
    CONSTRAINT "ODAEstimate_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "EstimatedExpense" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ChargingAllocation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "requestId" TEXT NOT NULL,
    "companyCode" TEXT,
    "businessArea" TEXT,
    "chargingType" TEXT NOT NULL,
    "chargingCode" TEXT NOT NULL,
    "isResearch" BOOLEAN NOT NULL DEFAULT false,
    "percent" REAL NOT NULL DEFAULT 0,
    CONSTRAINT "ChargingAllocation_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "TravelRequest" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PolicyCheck" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "requestId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "detail" TEXT,
    "travellerId" TEXT,
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "PolicyCheck_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "TravelRequest" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ApprovalStep" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "requestId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "roleType" TEXT NOT NULL,
    "approverId" TEXT,
    "onBehalfOf" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Pending',
    "decidedAt" DATETIME,
    "comments" TEXT,
    CONSTRAINT "ApprovalStep_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "TravelRequest" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TravelBooking" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "requestId" TEXT NOT NULL,
    "pnr" TEXT,
    "ticketNo" TEXT,
    "channel" TEXT,
    "fare" REAL,
    "taxes" REAL,
    "fees" REAL,
    "hotelRate" REAL,
    "status" TEXT NOT NULL DEFAULT 'Booked',
    CONSTRAINT "TravelBooking_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "TravelRequest" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "BookingSegment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "bookingId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "originCode" TEXT,
    "destCode" TEXT,
    "bookedClassId" TEXT,
    "departDate" DATETIME,
    "arriveDate" DATETIME,
    "amount" REAL,
    CONSTRAINT "BookingSegment_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "TravelBooking" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "BookingDeviation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "requestId" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "approvedValue" TEXT,
    "bookedValue" TEXT,
    "material" BOOLEAN NOT NULL DEFAULT false,
    "action" TEXT,
    CONSTRAINT "BookingDeviation_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "TravelRequest" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TravelExpenseClaim" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "claimNumber" TEXT NOT NULL,
    "requestId" TEXT,
    "claimantId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Draft',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TravelExpenseClaim_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "TravelRequest" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TEExpenseLine" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "claimId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "expenseTypeId" TEXT NOT NULL,
    "treatment" TEXT NOT NULL,
    "approvedSgd" REAL NOT NULL DEFAULT 0,
    "bookedSgd" REAL,
    "actualSgd" REAL NOT NULL DEFAULT 0,
    "varianceSgd" REAL NOT NULL DEFAULT 0,
    "receiptOk" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "TEExpenseLine_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "TravelExpenseClaim" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TravelExpenseLink" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "requestId" TEXT NOT NULL,
    "claimId" TEXT NOT NULL,
    "travellerId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TravelExpenseLink_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "TravelRequest" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TravelExpenseLink_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "TravelExpenseClaim" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "IntegrationMessage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "requestId" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "IntegrationMessage_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "TravelRequest" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "requestId" TEXT,
    "actorId" TEXT,
    "onBehalfOf" TEXT,
    "kind" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuditEvent_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "TravelRequest" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "TravelRequest_requestNumber_key" ON "TravelRequest"("requestNumber");

-- CreateIndex
CREATE UNIQUE INDEX "TravelRequest_authorisationNo_key" ON "TravelRequest"("authorisationNo");

-- CreateIndex
CREATE UNIQUE INDEX "AccommodationEstimate_expenseId_key" ON "AccommodationEstimate"("expenseId");

-- CreateIndex
CREATE UNIQUE INDEX "ODAEstimate_expenseId_key" ON "ODAEstimate"("expenseId");

-- CreateIndex
CREATE UNIQUE INDEX "TravelExpenseClaim_claimNumber_key" ON "TravelExpenseClaim"("claimNumber");

-- CreateIndex
CREATE UNIQUE INDEX "TravelExpenseLink_claimId_key" ON "TravelExpenseLink"("claimId");
