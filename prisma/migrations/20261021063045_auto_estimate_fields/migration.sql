-- AlterTable
ALTER TABLE "AccommodationEstimate" ADD COLUMN "legSeq" INTEGER;
-- AlterTable
ALTER TABLE "ODAEstimate" ADD COLUMN "legSeq" INTEGER;
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_EstimatedExpense" (
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
    "autoDerived" BOOLEAN NOT NULL DEFAULT false,
    "isShared" BOOLEAN NOT NULL DEFAULT false,
    "shareMap" TEXT,
    "chargingCode" TEXT,
    "allocJson" TEXT,
    "notes" TEXT,
    "originCode" TEXT,
    "destCode" TEXT,
    "proposedClassId" TEXT,
    "fareCeiling" REAL,
    "handoffStatus" TEXT,
    CONSTRAINT "EstimatedExpense_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "TravelRequest" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_EstimatedExpense" ("allocJson", "category", "chargingCode", "currency", "destCode", "estimateBasis", "expectedDate", "expenseTypeId", "fareCeiling", "foreignAmount", "handoffStatus", "id", "isShared", "notes", "originCode", "proposedClassId", "requestId", "sgdAmount", "shareMap", "sponsorForeign", "sponsorSgd", "travellerId") SELECT "allocJson", "category", "chargingCode", "currency", "destCode", "estimateBasis", "expectedDate", "expenseTypeId", "fareCeiling", "foreignAmount", "handoffStatus", "id", "isShared", "notes", "originCode", "proposedClassId", "requestId", "sgdAmount", "shareMap", "sponsorForeign", "sponsorSgd", "travellerId" FROM "EstimatedExpense";
DROP TABLE "EstimatedExpense";
ALTER TABLE "new_EstimatedExpense" RENAME TO "EstimatedExpense";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
