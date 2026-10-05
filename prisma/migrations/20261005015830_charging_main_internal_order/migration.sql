-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ChargingAllocation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "requestId" TEXT NOT NULL,
    "companyCode" TEXT,
    "businessArea" TEXT,
    "chargingType" TEXT NOT NULL,
    "chargingCode" TEXT NOT NULL,
    "isResearch" BOOLEAN NOT NULL DEFAULT false,
    "percent" REAL NOT NULL DEFAULT 0,
    "amountSgd" REAL,
    "internalOrder" TEXT,
    "isMain" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "ChargingAllocation_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "TravelRequest" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_ChargingAllocation" ("amountSgd", "businessArea", "chargingCode", "chargingType", "companyCode", "id", "isResearch", "percent", "requestId") SELECT "amountSgd", "businessArea", "chargingCode", "chargingType", "companyCode", "id", "isResearch", "percent", "requestId" FROM "ChargingAllocation";
DROP TABLE "ChargingAllocation";
ALTER TABLE "new_ChargingAllocation" RENAME TO "ChargingAllocation";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
