-- Migration: add adminPasswordHash to Tenant
-- Per-tenant admin password hash (bcrypt). Generated at provision time by the
-- control plane; the plaintext is passed once to the bench-agent and never stored.

ALTER TABLE "Tenant" ADD COLUMN "adminPasswordHash" TEXT;
