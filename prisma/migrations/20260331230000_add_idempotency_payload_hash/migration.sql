-- AlterTable
ALTER TABLE "IdempotencyKey"
ADD COLUMN "payloadHash" TEXT NOT NULL DEFAULT '';
