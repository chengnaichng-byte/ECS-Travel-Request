-- #14 Configurable, BA-mastered, traveller-selected M6 upgrade routing (Model B).

-- AlterTable: the traveller-selected M6 account for an NTU-funded upgrade differential.
ALTER TABLE "EstimatedExpense" ADD COLUMN "upgradeDeltaCode" TEXT;

-- AlterTable: Pre-Trip module settings for the upgrade-routing feature.
ALTER TABLE "ModuleSettings" ADD COLUMN "upgradeDeltaRoutingEnabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "ModuleSettings" ADD COLUMN "upgradeDeltaSelectionRequired" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable: the M6 (upgrade-differential) account master, grouped by Business Area.
CREATE TABLE "UpgradeDeltaAccount" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "companyCode" TEXT NOT NULL DEFAULT '1000',
    "businessArea" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable: the uplift % schedule (Model B) keyed by class step.
CREATE TABLE "UpgradeUpliftRate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "fromClassId" TEXT NOT NULL,
    "toClassId" TEXT NOT NULL,
    "pct" REAL NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "UpgradeDeltaAccount_code_key" ON "UpgradeDeltaAccount"("code");
CREATE UNIQUE INDEX "UpgradeUpliftRate_fromClassId_toClassId_key" ON "UpgradeUpliftRate"("fromClassId", "toClassId");
