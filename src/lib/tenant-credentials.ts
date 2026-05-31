import { openSecret, sealSecret } from "./crypto/secret-box.js";

// H1 Phase A: accessor layer for tenant ERP credentials. Defined and unit-tested,
// but NOT wired into runner/tenant-routes/webhook-routes yet (that is Phase B).
// In Phase A the *Enc columns are always null, so readTenantErpCredentials always
// returns plaintext — i.e. zero runtime behavior change.

/** The credential-bearing columns of a Tenant, as selected from Prisma. */
export type TenantCredentialFields = {
  erpApiKey?: string | null;
  erpApiSecret?: string | null;
  webhookSecret?: string | null;
  erpApiKeyEnc?: string | null;
  erpApiSecretEnc?: string | null;
  webhookSecretEnc?: string | null;
};

export type TenantErpCredentials = {
  erpApiKey: string | null;
  erpApiSecret: string | null;
  webhookSecret: string | null;
};

function resolve(enc: string | null | undefined, plain: string | null | undefined): string | null {
  if (enc) return openSecret(enc);
  return plain ?? null;
}

/**
 * Read a tenant's ERP credentials, preferring the encrypted columns and falling
 * back to plaintext when no ciphertext is present. Missing fields resolve to null.
 */
export function readTenantErpCredentials(tenant: TenantCredentialFields): TenantErpCredentials {
  return {
    erpApiKey: resolve(tenant.erpApiKeyEnc, tenant.erpApiKey),
    erpApiSecret: resolve(tenant.erpApiSecretEnc, tenant.erpApiSecret),
    webhookSecret: resolve(tenant.webhookSecretEnc, tenant.webhookSecret),
  };
}

export type EncryptedCredentialWrite = {
  erpApiKeyEnc?: string;
  erpApiSecretEnc?: string;
  webhookSecretEnc?: string;
  credentialEncryptionVersion: number;
};

/**
 * Build the encrypted-column write payload for Phase B dual-write. Seals each
 * provided plaintext value and tags the row with the current encryption version.
 * Values that are null/undefined are skipped. (Not wired into any caller yet.)
 */
export function buildEncryptedCredentialWrite(input: {
  erpApiKey?: string | null;
  erpApiSecret?: string | null;
  webhookSecret?: string | null;
}): EncryptedCredentialWrite {
  const out: EncryptedCredentialWrite = { credentialEncryptionVersion: 1 };
  if (input.erpApiKey != null) out.erpApiKeyEnc = sealSecret(input.erpApiKey);
  if (input.erpApiSecret != null) out.erpApiSecretEnc = sealSecret(input.erpApiSecret);
  if (input.webhookSecret != null) out.webhookSecretEnc = sealSecret(input.webhookSecret);
  return out;
}
