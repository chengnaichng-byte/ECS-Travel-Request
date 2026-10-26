-- CreateTable
CREATE TABLE "CtaPostingDocument" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "bookingId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "chargeType" TEXT NOT NULL,
    "sapDocNo" TEXT NOT NULL,
    "postingDate" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Posted',
    "grossSgd" REAL NOT NULL,
    "clearingGlAccount" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "CtaPostingDocument_sapDocNo_key" ON "CtaPostingDocument"("sapDocNo");

-- CreateIndex
CREATE UNIQUE INDEX "CtaPostingDocument_bookingId_chargeType_key" ON "CtaPostingDocument"("bookingId", "chargeType");

