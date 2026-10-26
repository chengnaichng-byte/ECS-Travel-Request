-- CreateTable
CREATE TABLE "CtaAccount" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ctaAccountId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "companyCode" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "clearingGlAccount" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "effectiveFrom" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "CtaAccount_ctaAccountId_key" ON "CtaAccount"("ctaAccountId");

