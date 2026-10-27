-- DD-31 persist the per-charge CTA breakdown from the TMC feed, plus the provider invoice number,
-- so the CTA → SAP posting is driven from the feed rows (store-and-validate) rather than re-derived.

-- AlterTable
ALTER TABLE "TravelBooking" ADD COLUMN "invoiceNo" TEXT;

-- CreateTable
CREATE TABLE "BookingCharge" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "bookingId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "expenseTypeId" TEXT NOT NULL,
    "amountSgd" REAL NOT NULL,
    "gstCode" TEXT NOT NULL,
    "gstAmountSgd" REAL NOT NULL DEFAULT 0,
    "gstClaimable" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "BookingCharge_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "TravelBooking" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
