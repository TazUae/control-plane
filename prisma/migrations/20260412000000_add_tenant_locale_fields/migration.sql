-- Migration: add_tenant_locale_fields
-- Adds six locale fields to the Tenant table to drive the locale_configured
-- provisioning step.  All new columns are nullable or have safe defaults so
-- the migration is non-destructive against existing tenant rows.

ALTER TABLE "Tenant" ADD COLUMN "country"           TEXT;
ALTER TABLE "Tenant" ADD COLUMN "defaultCurrency"   TEXT;
ALTER TABLE "Tenant" ADD COLUMN "timezone"          TEXT;
ALTER TABLE "Tenant" ADD COLUMN "language"          TEXT NOT NULL DEFAULT 'en';
ALTER TABLE "Tenant" ADD COLUMN "dateFormat"        TEXT NOT NULL DEFAULT 'dd-mm-yyyy';
ALTER TABLE "Tenant" ADD COLUMN "currencyPrecision" INTEGER NOT NULL DEFAULT 2;
