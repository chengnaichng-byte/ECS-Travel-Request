-- CreateTable
CREATE TABLE "IntegrationFieldSetting" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "includeTmc" BOOLEAN NOT NULL DEFAULT false,
    "teTreatment" TEXT NOT NULL DEFAULT 'EXCLUDED',
    "updatedAt" DATETIME NOT NULL
);
