-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_TEExpenseLine" (
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
    "transactionDate" DATETIME,
    "reason" TEXT,
    "receiptType" TEXT NOT NULL DEFAULT 'LOCAL_GST',
    "currency" TEXT NOT NULL DEFAULT 'SGD',
    "foreignAmount" REAL,
    "sponsorSgd" REAL NOT NULL DEFAULT 0,
    "chargingCode" TEXT,
    CONSTRAINT "TEExpenseLine_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "TravelExpenseClaim" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_TEExpenseLine" ("actualSgd", "approvedSgd", "bookedSgd", "category", "claimId", "expenseTypeId", "id", "receiptOk", "treatment", "varianceSgd") SELECT "actualSgd", "approvedSgd", "bookedSgd", "category", "claimId", "expenseTypeId", "id", "receiptOk", "treatment", "varianceSgd" FROM "TEExpenseLine";
DROP TABLE "TEExpenseLine";
ALTER TABLE "new_TEExpenseLine" RENAME TO "TEExpenseLine";
CREATE TABLE "new_TravelExpenseClaim" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "claimNumber" TEXT NOT NULL,
    "requestId" TEXT,
    "claimantId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Draft',
    "reportType" TEXT NOT NULL DEFAULT 'Travel expense',
    "trsNotBooked" BOOLEAN NOT NULL DEFAULT false,
    "travelStart" DATETIME,
    "travelEnd" DATETIME,
    "additionalApprover1" TEXT,
    "additionalApprover2" TEXT,
    "lessCorpCard" REAL NOT NULL DEFAULT 0,
    "lessPersonal" REAL NOT NULL DEFAULT 0,
    "chargingMode" TEXT NOT NULL DEFAULT 'MAIN',
    "chargingMainCode" TEXT,
    "chargingJson" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TravelExpenseClaim_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "TravelRequest" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_TravelExpenseClaim" ("claimNumber", "claimantId", "createdAt", "id", "requestId", "status") SELECT "claimNumber", "claimantId", "createdAt", "id", "requestId", "status" FROM "TravelExpenseClaim";
DROP TABLE "TravelExpenseClaim";
ALTER TABLE "new_TravelExpenseClaim" RENAME TO "TravelExpenseClaim";
CREATE UNIQUE INDEX "TravelExpenseClaim_claimNumber_key" ON "TravelExpenseClaim"("claimNumber");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
