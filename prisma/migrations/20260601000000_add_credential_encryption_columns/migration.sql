-- H1 Phase A: additive encrypted-at-rest credential columns.
-- Plaintext columns ("erpApiKey", "erpApiSecret", "webhookSecret") are retained;
-- these nullable columns are populated later (Phase B dual-write / Phase C backfill).
ALTER TABLE "Tenant" ADD COLUMN "erpApiKeyEnc" TEXT;
ALTER TABLE "Tenant" ADD COLUMN "erpApiSecretEnc" TEXT;
ALTER TABLE "Tenant" ADD COLUMN "webhookSecretEnc" TEXT;
ALTER TABLE "Tenant" ADD COLUMN "credentialEncryptionVersion" INTEGER;
