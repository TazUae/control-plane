-- AlterEnum
ALTER TYPE "TenantStatus" ADD VALUE 'failed';

-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN "lastError" TEXT;
