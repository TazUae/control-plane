-- AlterTable
ALTER TABLE "ProvisioningJob" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

UPDATE "ProvisioningJob" SET "updatedAt" = "createdAt";
