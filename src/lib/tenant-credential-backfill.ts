import { sealSecret } from "./crypto/secret-box.js";

// H1 Phase C: pure, testable planning for backfilling encrypted credential columns
// from existing plaintext. This module NEVER writes to the database, NEVER logs, and
// NEVER returns credential values — only tenant ids and counts. The actual DB writes
// (and all safety gates) live in scripts/backfill-tenant-credentials.ts.
//
// Invariants:
//   - Only seal a field when plaintext is present AND the *Enc column is empty.
//   - Never overwrite an existing *Enc column.
//   - Never touch plaintext columns.
//   - Set credentialEncryptionVersion=1 only when at least one *Enc is written.
//   - Sealing requires a valid ERP_CREDENTIAL_ENCRYPTION_KEY (sealSecret throws otherwise).

export type BackfillTenant = {
  id: string;
  erpApiKey?: string | null;
  erpApiSecret?: string | null;
  webhookSecret?: string | null;
  erpApiKeyEnc?: string | null;
  erpApiSecretEnc?: string | null;
  webhookSecretEnc?: string | null;
  credentialEncryptionVersion?: number | null;
};

export type TenantBackfillPlan = {
  tenantId: string;
  needsErpApiKeyEnc: boolean;
  needsErpApiSecretEnc: boolean;
  needsWebhookSecretEnc: boolean;
  hasAnyCredential: boolean;
  alreadyComplete: boolean;
  needsBackfill: boolean;
};

function present(v: string | null | undefined): v is string {
  return typeof v === "string" && v.length > 0;
}

/** Compute which encrypted columns a tenant still needs. Pure; no values returned. */
export function planTenantCredentialBackfill(tenant: BackfillTenant): TenantBackfillPlan {
  const needsErpApiKeyEnc = present(tenant.erpApiKey) && !present(tenant.erpApiKeyEnc);
  const needsErpApiSecretEnc = present(tenant.erpApiSecret) && !present(tenant.erpApiSecretEnc);
  const needsWebhookSecretEnc = present(tenant.webhookSecret) && !present(tenant.webhookSecretEnc);
  const hasAnyCredential =
    present(tenant.erpApiKey) || present(tenant.erpApiSecret) || present(tenant.webhookSecret);
  const needsBackfill = needsErpApiKeyEnc || needsErpApiSecretEnc || needsWebhookSecretEnc;
  return {
    tenantId: tenant.id,
    needsErpApiKeyEnc,
    needsErpApiSecretEnc,
    needsWebhookSecretEnc,
    hasAnyCredential,
    alreadyComplete: hasAnyCredential && !needsBackfill,
    needsBackfill,
  };
}

export type CredentialBackfillUpdate = {
  erpApiKeyEnc?: string;
  erpApiSecretEnc?: string;
  webhookSecretEnc?: string;
  credentialEncryptionVersion?: number;
};

/**
 * Build the Prisma `data` update for one tenant: seals ONLY the missing encrypted
 * fields, never overwrites an existing *Enc, never includes plaintext. Returns null
 * when there is nothing to do (idempotent no-op). Requires a valid encryption key —
 * sealSecret throws if the key is missing/invalid (fail-safe; no partial result).
 */
export function buildTenantCredentialBackfillUpdate(
  tenant: BackfillTenant,
): CredentialBackfillUpdate | null {
  const plan = planTenantCredentialBackfill(tenant);
  if (!plan.needsBackfill) return null;

  const update: CredentialBackfillUpdate = {};
  if (plan.needsErpApiKeyEnc) update.erpApiKeyEnc = sealSecret(tenant.erpApiKey as string);
  if (plan.needsErpApiSecretEnc) update.erpApiSecretEnc = sealSecret(tenant.erpApiSecret as string);
  if (plan.needsWebhookSecretEnc) update.webhookSecretEnc = sealSecret(tenant.webhookSecret as string);
  update.credentialEncryptionVersion = 1;
  return update;
}

export type CredentialBackfillSummary = {
  totalScanned: number;
  needingErpApiKeyEnc: number;
  needingErpApiSecretEnc: number;
  needingWebhookSecretEnc: number;
  needingBackfill: number;
  alreadyComplete: number;
  skippedNoCredentials: number;
  tenantIdsNeedingBackfill: string[];
};

/** Aggregate plans into counts + ids only. Never includes credential values. */
export function summarizeCredentialBackfill(tenants: BackfillTenant[]): CredentialBackfillSummary {
  const summary: CredentialBackfillSummary = {
    totalScanned: tenants.length,
    needingErpApiKeyEnc: 0,
    needingErpApiSecretEnc: 0,
    needingWebhookSecretEnc: 0,
    needingBackfill: 0,
    alreadyComplete: 0,
    skippedNoCredentials: 0,
    tenantIdsNeedingBackfill: [],
  };
  for (const tenant of tenants) {
    const plan = planTenantCredentialBackfill(tenant);
    if (plan.needsErpApiKeyEnc) summary.needingErpApiKeyEnc += 1;
    if (plan.needsErpApiSecretEnc) summary.needingErpApiSecretEnc += 1;
    if (plan.needsWebhookSecretEnc) summary.needingWebhookSecretEnc += 1;
    if (!plan.hasAnyCredential) {
      summary.skippedNoCredentials += 1;
    } else if (plan.alreadyComplete) {
      summary.alreadyComplete += 1;
    }
    if (plan.needsBackfill) {
      summary.needingBackfill += 1;
      summary.tenantIdsNeedingBackfill.push(tenant.id);
    }
  }
  return summary;
}
