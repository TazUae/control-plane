-- ADR-MKT-001: additive operating-market columns on Tenant, plus AuditEvent
-- indexes to make it a queryable compliance record. No UPDATE, no DEFAULT, no
-- NOT NULL -- every existing row lands NULL. See docs/adr/ADR-MKT-001 in FitDesk.
ALTER TABLE "Tenant" ADD COLUMN "operatingMarket" TEXT;
ALTER TABLE "Tenant" ADD COLUMN "operatingMarketSource" TEXT;
ALTER TABLE "Tenant" ADD COLUMN "operatingMarketVerifiedAt" TIMESTAMP(3);
ALTER TABLE "Tenant" ADD COLUMN "operatingMarketVerifiedBy" TEXT;
CREATE INDEX "AuditEvent_tenantId_idx" ON "AuditEvent"("tenantId");
CREATE INDEX "AuditEvent_type_createdAt_idx" ON "AuditEvent"("type", "createdAt");
