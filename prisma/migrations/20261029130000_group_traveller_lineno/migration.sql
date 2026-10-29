-- §13.14 group traveller line number (TA/0n): a stable, frozen per-traveller reference within a group.
ALTER TABLE "TravelRequestTraveller" ADD COLUMN "lineNo" INTEGER;
ALTER TABLE "TravelBooking" ADD COLUMN "travellerLineNo" INTEGER;
