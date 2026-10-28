-- §6.2 ECS-structured TR approval-workflow configuration.
CREATE TABLE "WorkflowScenario" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "effectiveFrom" DATETIME NOT NULL,
    "effectiveTo" DATETIME NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "tiersJson" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
CREATE UNIQUE INDEX "WorkflowScenario_code_key" ON "WorkflowScenario"("code");
