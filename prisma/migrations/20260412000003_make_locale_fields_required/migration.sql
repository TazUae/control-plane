-- Step 8: Make locale/company fields required and add fiscalYearName, regionalSetupModule.
--
-- Backfill NULLs with sensible defaults (SA/SAR/Asia/Riyadh) before adding the
-- NOT NULL constraint so existing tenant rows do not violate the constraint.
UPDATE "Tenant" SET "country"         = 'SA'           WHERE "country"         IS NULL;
UPDATE "Tenant" SET "defaultCurrency" = 'SAR'          WHERE "defaultCurrency" IS NULL;
UPDATE "Tenant" SET "timezone"        = 'Asia/Riyadh'  WHERE "timezone"        IS NULL;
UPDATE "Tenant" SET "companyName"     = 'Default Company' WHERE "companyName"  IS NULL;
UPDATE "Tenant" SET "companyAbbr"     = 'DC'           WHERE "companyAbbr"     IS NULL;

ALTER TABLE "Tenant" ALTER COLUMN "country"         SET NOT NULL;
ALTER TABLE "Tenant" ALTER COLUMN "defaultCurrency" SET NOT NULL;
ALTER TABLE "Tenant" ALTER COLUMN "timezone"        SET NOT NULL;
ALTER TABLE "Tenant" ALTER COLUMN "companyName"     SET NOT NULL;
ALTER TABLE "Tenant" ALTER COLUMN "companyAbbr"     SET NOT NULL;

ALTER TABLE "Tenant" ADD COLUMN "fiscalYearName"      TEXT;
ALTER TABLE "Tenant" ADD COLUMN "regionalSetupModule" TEXT;
