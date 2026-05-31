# H1 Phase C — Tenant ERP Credential Backfill Runbook

Status: tooling implemented; **not executed** against any database. Scope: control-plane.
Backfill seals existing plaintext credentials into the encrypted (`*Enc`) columns. It is
additive only — plaintext is never touched, never deleted, and reads keep their plaintext
fallback.

## 1. Preflight (all required before apply)

1. **Verified DB backup** of the control-plane database (and a tested restore path).
2. `ERP_CREDENTIAL_ENCRYPTION_KEY` present and identical on **both** the control-plane
   API and worker services.
3. **Phase B deployed** (dual-write helpers + encrypted-primary/plaintext-fallback reads).
4. `ERP_CREDENTIAL_ENCRYPTION_ENABLED=true`, and dual-write **verified for new tenants**
   (a freshly provisioned tenant shows non-null `*Enc` + `credentialEncryptionVersion=1`).
5. Run the **dry-run** and review the counts before applying.

## 2. Dry-run (default; no writes)

```bash
npm run credentials:backfill:dry-run
```

- Requires a valid `ERP_CREDENTIAL_ENCRYPTION_KEY` (it simulates sealing in memory).
- Connects to the DB read-only via Prisma `findMany`; performs **no writes**.
- Fails safely (non-zero, no DB writes) if the key is missing/invalid.

## 3. Expected dry-run output (counts + ids only — never credential values)

```json
[credentials:dry-run] NO WRITES PERFORMED {
  "totalScanned": <n>,
  "needingErpApiKeyEnc": <n>,
  "needingErpApiSecretEnc": <n>,
  "needingWebhookSecretEnc": <n>,
  "tenantsNeedingBackfill": <n>,
  "alreadyComplete": <n>,
  "skippedNoCredentials": <n>,
  "simulatedSeals": <n>,
  "tenantIdsNeedingBackfill": ["<id>", ...]
}
```

## 4. Real apply (GUARDED — never run without a verified backup)

```bash
npm run credentials:backfill:apply -- \
  --i-have-a-db-backup \
  --confirm-control-plane-credential-backfill
```

All of these gates must hold or the script refuses to run (exit 1, no writes):

- `--apply` (set by the npm script)
- `--i-have-a-db-backup`
- `--confirm-control-plane-credential-backfill`
- `ERP_CREDENTIAL_ENCRYPTION_ENABLED=true`
- `ERP_CREDENTIAL_ENCRYPTION_KEY` valid (sealing preflight)

Apply behavior: updates only rows with a missing `*Enc` (where plaintext is present);
never overwrites an existing `*Enc`; never touches plaintext; sets
`credentialEncryptionVersion=1` on written rows; prints a counts-only summary
(`{ updated, skipped, failed }`) and exits non-zero if any tenant update fails.

## 5. Verification

```bash
npm run credentials:backfill:verify
```

Reports coverage counts only (complete / incomplete / skipped, and per-field missing
counts). Does **not** decrypt or print any credential value. Re-run after apply and
confirm `incompleteNeedingBackfill: 0`.

## 6. Rollback

- The backfill is additive. To revert, set the affected `*Enc` columns back to `NULL`
  (and optionally `credentialEncryptionVersion` to `NULL`) for the touched rows — reads
  fall back to plaintext, which was never modified.
- If broader rollback is desired, set `ERP_CREDENTIAL_ENCRYPTION_ENABLED=false` (keep the
  key in place so any remaining `*Enc` rows still decrypt) and deploy/restart.
- No plaintext is ever deleted by Phase C, so plaintext remains the safe fallback.

## 7. What Phase C does NOT do

- Does **not** delete or modify plaintext columns.
- Does **not** switch reads to encrypted-only (plaintext fallback remains).
- Does **not** rotate keys.
- Does **not** touch production automatically — every write is behind explicit gates.

## 8. Phase D / E (future, separate)

- **Phase D** — after verified 100% backfill coverage + a soak period, switch reads to
  encrypted-only (remove the plaintext fallback in `readTenantErpCredentials`).
- **Phase E** — much later, drop the plaintext columns (`erpApiKey`, `erpApiSecret`,
  `webhookSecret`) via a dedicated migration, backup-gated.
