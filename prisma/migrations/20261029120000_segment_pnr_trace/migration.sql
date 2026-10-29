-- §7.3 OBT/TMC association: persist the segment → PNR → TA trace and the charge → ticket link.
-- Additive, nullable columns on the existing booking tables.
ALTER TABLE "BookingSegment" ADD COLUMN "segmentRef" TEXT;
ALTER TABLE "BookingSegment" ADD COLUMN "pnr" TEXT;
ALTER TABLE "BookingSegment" ADD COLUMN "segmentStatus" TEXT;
ALTER TABLE "BookingSegment" ADD COLUMN "ticketNumber" TEXT;
ALTER TABLE "BookingSegment" ADD COLUMN "couponNumber" INTEGER;

ALTER TABLE "BookingCharge" ADD COLUMN "pnr" TEXT;
ALTER TABLE "BookingCharge" ADD COLUMN "ticketNumber" TEXT;
ALTER TABLE "BookingCharge" ADD COLUMN "segmentRef" TEXT;
