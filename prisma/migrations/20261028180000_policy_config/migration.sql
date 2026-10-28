-- §6.3 ECS-structured TR policy configuration.
CREATE TABLE "PolicyConfig" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "companyCode" TEXT NOT NULL DEFAULT 'NTU',
    "effectiveFrom" DATETIME NOT NULL,
    "effectiveTo" DATETIME NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "rulesJson" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
CREATE UNIQUE INDEX "PolicyConfig_code_key" ON "PolicyConfig"("code");
