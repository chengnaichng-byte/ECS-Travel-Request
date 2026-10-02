-- AlterTable
ALTER TABLE "TravelRequest" ADD COLUMN "classBasis" TEXT;
ALTER TABLE "TravelRequest" ADD COLUMN "classJustification" TEXT;
ALTER TABLE "TravelRequest" ADD COLUMN "entitledClassId" TEXT;

-- AlterTable
ALTER TABLE "TravelRequestTraveller" ADD COLUMN "chosenClassId" TEXT;
ALTER TABLE "TravelRequestTraveller" ADD COLUMN "classBasis" TEXT;
ALTER TABLE "TravelRequestTraveller" ADD COLUMN "classJustification" TEXT;
ALTER TABLE "TravelRequestTraveller" ADD COLUMN "entitledClassId" TEXT;

-- CreateTable
CREATE TABLE "Attachment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "requestId" TEXT NOT NULL,
    "docType" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "sizeKb" INTEGER NOT NULL DEFAULT 0,
    "uploadedById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Attachment_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "TravelRequest" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ItineraryLeg" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "requestId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "originCode" TEXT NOT NULL,
    "destCode" TEXT NOT NULL,
    "departDate" DATETIME,
    "arriveDate" DATETIME,
    "transportMode" TEXT NOT NULL DEFAULT 'AIR',
    "durationHours" REAL,
    "isPersonal" BOOLEAN NOT NULL DEFAULT false,
    "nights" INTEGER NOT NULL DEFAULT 0,
    "travelClassId" TEXT,
    "entitledClassId" TEXT,
    "chosenClassId" TEXT,
    CONSTRAINT "ItineraryLeg_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "TravelRequest" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_ItineraryLeg" ("arriveDate", "departDate", "destCode", "id", "originCode", "requestId", "seq", "travelClassId") SELECT "arriveDate", "departDate", "destCode", "id", "originCode", "requestId", "seq", "travelClassId" FROM "ItineraryLeg";
DROP TABLE "ItineraryLeg";
ALTER TABLE "new_ItineraryLeg" RENAME TO "ItineraryLeg";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
