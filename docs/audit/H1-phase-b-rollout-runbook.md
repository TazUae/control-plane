# H1 Phase B — Tenant ERP Credential Encryption: Dual-Write Rollout Runbook

Status: implemented behind the `ERP_CREDENTIAL_ENCRYPTION_ENABLED` flag (default **false**).
Scope: control-plane only. No backfill, no plaintext deletion, no encrypted-only reads.

## 1. What Phase B does

- **Writes (flag-gated, `runner.ts`):**
  - When `ERP_CREDENTIAL_ENCRYPTION_ENABLED=false` (default): credentials are written
    **plaintext-only**, byte-for-byte identical to pre-Phase-B behavior. The encryption
    key is never read.
  - When `ERP_CREDENTIAL_ENCRYPTION_ENABLED=true`: newly generated credentials are
    **dual-written** — plaintext columns (`erpApiKey`, `erpApiSecret`, `webhookSecret`)
    **AND** encrypted columns (`erpApiKeyEnc`, `erpApiSecretEnc`, `webhookSecretEnc`)
    plus `credentialEncryptionVersion = 1`.
- **Reads (always, accessor `readTenantErpCredentials`):** encrypted-primary with
  plaintext fallback. If a `*Enc` column is present it is decrypted; otherwise the
  plaintext column is used. Legacy tenants (no `*Enc`) keep working unchanged. Read
  sites wired: `runner.ts` smoke test, `tenant.routes.ts` (`/validate`,
  `/erp-credentials`), `webhook.routes.ts` (secret verification).
- **No existing data is encrypted** (no backfill). Only *new* credential writes are
  dual-written while the flag is on.
- The `/erp-credentials` endpoint returns **decrypted** values and never the
  ciphertext columns.

## 2. Why both services need the key

- **control-plane API service** decrypts on read paths (`/validate`,
  `/erp-credentials`, webhook secret verification).
- **control-plane worker service** runs `runner.ts`, which both dual-writes (seal) and
  reads (smoke test) credentials.

If the flag is enabled on either service without a valid key, env validation
**fails closed at boot** (the service will not start). This is intentional.

## 3. Rollout (Dokploy) — order matters

> This run did NOT change any Dokploy env var. The steps below are the operator runbook.

1. **Generate a key** (32 random bytes, base64):
   ```bash
   openssl rand -base64 32
   ```
2. **Add `ERP_CREDENTIAL_ENCRYPTION_KEY`** (the value above) to **BOTH**:
   1. control-plane **API** service
   2. control-plane **worker** service
   Keep `ERP_CREDENTIAL_ENCRYPTION_ENABLED=false` for now. Deploy. Verify both
   services boot (the key is validated but not yet used while disabled).
3. **Only after the key exists on both services**, set:
   ```
   ERP_CREDENTIAL_ENCRYPTION_ENABLED=true
   ```
   on **BOTH** services. Deploy. New provisioning runs now dual-write.
4. **Verify:** provision a test tenant (or re-provision one), then confirm the row has
   non-null `*Enc` columns and `credentialEncryptionVersion = 1`, and that
   `/erp-credentials` still returns correct decrypted values.

## 4. Rollback

- **Flip the flag off:** set `ERP_CREDENTIAL_ENCRYPTION_ENABLED=false` on both services
  and deploy/restart. New writes revert to plaintext-only; reads continue to work
  because plaintext columns are still present (fallback) and already-sealed rows still
  decrypt.
- **IMPORTANT:** do **not** remove `ERP_CREDENTIAL_ENCRYPTION_KEY` during rollback. Rows
  that were already dual-written keep their `*Enc` columns, and the read accessor
  prefers `*Enc` when present — so the key must remain available to decrypt them. The
  key may only be retired later, after a verified backfill/cutover decision (Phase D+).
- No data migration or column drop is involved in rollback.

## 5. Out of scope (future phases)

- **Phase C — backfill** (separate, not included here): encrypt existing plaintext rows.
- **Phase D** — switch reads to encrypted-only (remove plaintext fallback).
- **Phase E** — drop the plaintext columns.

## 6. Phase C backfill checklist (for later, not this PR)

1. **DB backup** — take a verified snapshot/backup of the control-plane database.
2. **Dry-run backfill** — report how many rows have plaintext but null `*Enc`; seal
   in-memory and verify round-trip; write nothing.
3. **Real backfill** — idempotent; only update rows where `*Enc IS NULL` and plaintext
   is present; set `credentialEncryptionVersion = 1`.
4. **Verification query** — confirm every credentialed row has non-null `*Enc` and that
   `openSecret(*Enc)` equals the plaintext for a sampled subset.
5. **Rollback** — backfill only adds `*Enc` (additive); to revert, set the affected
   `*Enc` columns back to NULL (reads fall back to plaintext). No plaintext is touched.
