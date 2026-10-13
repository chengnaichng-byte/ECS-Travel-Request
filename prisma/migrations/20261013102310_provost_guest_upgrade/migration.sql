-- AlterTable
ALTER TABLE "TravelRequest" ADD COLUMN "provostId" TEXT;

-- CreateTable
CREATE TABLE "Provost" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "schoolId" TEXT NOT NULL,
    "approverId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "Provost_schoolId_idx" ON "Provost"("schoolId");

-- CreateIndex
CREATE UNIQUE INDEX "Provost_schoolId_approverId_key" ON "Provost"("schoolId", "approverId");
