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
    "selfBookingEnabled" BOOLEAN NOT NULL DEFAULT true,
    "authorisationValidityDays" INTEGER NOT NULL DEFAULT 30,
    "bookingDeadlineDays" INTEGER NOT NULL DEFAULT 14,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_ModuleSettings" ("airfareTreatment", "approvalAmountBasis", "authorisationValidityDays", "bookingDeadlineDays", "expenseScope", "groupTravelEnabled", "hotelEstimateBasis", "id", "roRequired", "sameRouteResearch", "selfBookingEnabled", "teLinkageMandatory", "updatedAt") SELECT "airfareTreatment", "approvalAmountBasis", "authorisationValidityDays", "bookingDeadlineDays", "expenseScope", "groupTravelEnabled", "hotelEstimateBasis", "id", "roRequired", "sameRouteResearch", "selfBookingEnabled", "teLinkageMandatory", "updatedAt" FROM "ModuleSettings";
DROP TABLE "ModuleSettings";
ALTER TABLE "new_ModuleSettings" RENAME TO "ModuleSettings";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
