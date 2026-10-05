-- AlterTable
ALTER TABLE "IntegrationMessage" ADD COLUMN "tmcProviderId" TEXT;

-- AlterTable
ALTER TABLE "TravelBooking" ADD COLUMN "tmcProviderId" TEXT;

-- AlterTable
ALTER TABLE "TravelRequest" ADD COLUMN "tmcProviderId" TEXT;
