# H1 — Encrypt tenant ERP credentials at rest (AUDIT + PLAN ONLY)

**Status:** Audit only. **No schema change, migration, or data encryption performed in this run.**
**Approval required before implementing** (changes DB schema + secret handling — both approval-gated by workspace `CLAUDE.md` §4).

## Problem
Control Plane is the sole keeper of per-tenant ERPNext credentials, but stores them in **plaintext** in Postgres.

## Evidence
- Schema — `control-plane/prisma/schema.prisma`:
  - `erpApiKey String?`, `erpApiSecret String?` (lines ~40–41) — plaintext
  - `webhookSecret String?` (line ~57) — plaintext (bearer secret for inbound FitDesk/ERP webhooks)
  - `adminPasswordHash String?` (line ~42) — already hashed (bcrypt); **not** in scope.
- Writes (plaintext):
  - `src/jobs/state/runner.ts` — `erpApiKey`/`erpApiSecret` persisted from `createApiUser` (~L499–502); `webhookSecret = crypto.randomBytes(32)` (~L435); `adminPasswordHash = bcrypt.hash(...)` (~L185, fine).
- Reads (plaintext):
  - `src/modules/erp-proxy/erp-proxy.routes.ts` — `resolveTenantFromAuth` reads `erpApiKey/erpApiSecret` (~L77–88).
  - `src/modules/webhooks/webhook.routes.ts` — builds `FrappeTenantCreds` (~L73–77, L179–183); resolves tenant by `webhookSecret` equality (invoice-submitted).
  - `src/modules/tenants/tenant.routes.ts` — `GET /tenants/:id/erp-credentials` returns `erpApiKey/erpApiSecret/webhookSecret` **over the wire** (~L119–141), behind a single shared `CONTROL_PLANE_API_KEY`.

## Impact
A read-only DB/backup leak, a logged query, or one leaked `CONTROL_PLANE_API_KEY` exposes **every tenant's** ERP API secret (full ERP CRUD per tenant via the proxy) and webhook secret (payment-webhook forgery). Crown-jewel blast radius.

## Implementation plan (application-layer AEAD; no provider/architecture change)
1. **Master key:** add `ERP_CRED_ENC_KEY` (32-byte, base64) to `src/config/env.ts` — required in production, with a clear fail-closed startup error. Store only in the deployment secret store (Dokploy env), never in the repo.
2. **Crypto util:** `src/lib/crypto/secret-box.ts` — `seal(plaintext) -> "v1:<iv>:<tag>:<ct>"` / `open(ciphertext)` using AES-256-GCM. Version prefix enables key rotation (`v1`,`v2`). Pure + unit-tested (round-trip, tamper-detect).
3. **Single choke point:** introduce `getTenantCreds(tenantId)` / `setTenantCreds(...)` that decrypt on read / encrypt on write; refactor the 4 read sites + 1 write site above to use it. No other code touches the raw columns.
4. **Staged migration (data already exists — reversible):**
   - Migration A: add nullable `erpApiKeyEnc`/`erpApiSecretEnc`/`webhookSecretEnc`.
   - Backfill script: encrypt existing plaintext into the `*Enc` columns (idempotent, dry-run first).
   - Dual-read (prefer `*Enc`, fall back to plaintext) during transition; dual-write.
   - Migration B (later, after verification): drop plaintext columns.
5. **Tighten exposure:** restrict/scrub `GET /tenants/:id/erp-credentials` (returns plaintext) — gate to an explicit ops scope or remove if unused.

## Risks / rollback
- Approval-gated (schema + secret handling). Must be staged; never a single big-bang migration.
- Rollback during transition = keep plaintext columns until Migration B; revert reads to plaintext.
- Verify the lazy webhook-secret generation and the smoke-test path (`runner.ts` passes apiKey/apiSecret to the provisioning adapter) still work through the accessor.
