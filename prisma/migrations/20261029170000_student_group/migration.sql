-- §13.14 Student group request — a group whose members are uploaded student rows
-- (not validated as true students), mechanically like a guest group booking.

-- Group kind on the request: STAFF (employee members) | STUDENT (uploaded students).
ALTER TABLE "TravelRequest" ADD COLUMN "groupType" TEXT;

-- Student identity captured on each member row (reuses guestName/guestEmail/guestOrg too).
ALTER TABLE "TravelRequestTraveller" ADD COLUMN "studentId" TEXT;
ALTER TABLE "TravelRequestTraveller" ADD COLUMN "programme" TEXT;

-- Admin toggle to enable/disable student groups (parallel to groupTravelEnabled).
ALTER TABLE "ModuleSettings" ADD COLUMN "studentGroupEnabled" BOOLEAN NOT NULL DEFAULT true;
