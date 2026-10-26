-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_TravelBooking" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "requestId" TEXT NOT NULL,
    "travellerId" TEXT,
    "tmcProviderId" TEXT,
    "pnr" TEXT,
    "ticketNo" TEXT,
    "channel" TEXT,
    "fare" REAL,
    "taxes" REAL,
    "fees" REAL,
    "hotelRate" REAL,
    "ctaAccountId" TEXT,
    "ctaCharged" BOOLEAN NOT NULL DEFAULT false,
    "ctaChargeDate" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'Booked',
    CONSTRAINT "TravelBooking_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "TravelRequest" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_TravelBooking" ("channel", "ctaAccountId", "fare", "fees", "hotelRate", "id", "pnr", "requestId", "status", "taxes", "ticketNo", "tmcProviderId", "travellerId") SELECT "channel", "ctaAccountId", "fare", "fees", "hotelRate", "id", "pnr", "requestId", "status", "taxes", "ticketNo", "tmcProviderId", "travellerId" FROM "TravelBooking";
DROP TABLE "TravelBooking";
ALTER TABLE "new_TravelBooking" RENAME TO "TravelBooking";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

