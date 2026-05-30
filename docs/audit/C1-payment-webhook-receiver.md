# C1 — Payment/invoice webhook receiver + verification hardening (PLAN ONLY)

**Status:** Plan only. The webhook **receiver module does not exist on `origin/main`**, so per the "do not invent a large replacement module" rule it is **not implemented** here. This is net-new feature work (with a security-critical verification design), not an extraction.

## Critical finding — secret plumbing exists, receiver is missing
On current `origin/main`:
- **Secret plumbing is present:** `src/config/env.ts` declares `WHISH_MONEY_WEBHOOK_SECRET` (+ `WHISH_MONEY_API_URL/KEY`); `src/jobs/state/runner.ts:432-450` lazily generates a **per-tenant `webhookSecret`** and bakes `controlPlaneWebhookUrl = ${CONTROL_PLANE_PUBLIC_URL}/webhooks/invoice-submitted` + the secret into the tenant's ERP **Server Scripts**; `tenant.routes.ts` exposes `webhookSecret`.
- **The receiver is absent:** `src/server.ts` registers only `tenant.routes` + `job.routes`; `src/modules/` contains only `jobs/` and `tenants/`; there is **no `/webhooks/*` route, no `modules/webhooks/`, and no raw-body parser**. (`require-internal-api-key.test.ts:17` has a stale comment referencing a `webhook.routes.ts` that does not exist on `origin/main`.)

**Implication:** the ERP side is configured to POST `invoice-submitted` (and, by design, `payment-confirmed`) webhooks to control-plane endpoints that currently **404**. So building this both (a) closes a **functional gap** and (b) must land with the **C1 security verification** below from day one. Coordinate with the owner of the ERP Server Script side.

## Required implementation (C1) — write failing tests FIRST
**Raw body:** register `addContentTypeParser("application/json", { parseAs: "string" })` and stash `req.rawBody` — HMAC must be computed over the **exact received bytes**, never `JSON.stringify(req.body)`.

**Endpoints:** `POST /webhooks/invoice-submitted` (per-tenant `webhookSecret`) and `POST /webhooks/payment-confirmed` (global `WHISH_MONEY_WEBHOOK_SECRET`). Confirm which secret each provider actually signs with.

**Verification (fail closed):**
- If the relevant secret is unset → **401** (never accept unsigned).
- Read the signature from the **`X-Whish-Signature` header only** — never from a `signature` field in the body.
- Compute HMAC-SHA256 over `req.rawBody`; compare with **constant-time** logic (length check, then `crypto.timingSafeEqual` on buffers).

**Replay dedupe:** reserve a Prisma `IdempotencyKey` on `transaction_id`; a unique-constraint violation (P2002) → return `200 { ok, deduped: true }` and create **no** second Payment Entry.

**Business-rule validation:** resolve `order_id` → real tenant + invoice; validate the webhook `amount` against the invoice; **do not overpay / over-submit**.

**Body size:** covered by the app-level `bodyLimit` added in H4.

## Tests to write first (all initially failing)
1. secret unset → 401 (fail closed)
2. missing `X-Whish-Signature` → 401
3. invalid signature → 401
4. valid raw-body HMAC → accepted (reaches business logic)
5. replayed `transaction_id` → `{ deduped: true }`, no second Payment Entry
6. amount/order mismatch → rejected (no overpay)

## Notes
- A design reference exists on the **divergent local `main`** (`src/modules/webhooks/webhook.routes.ts`) — use as input, re-implemented against `origin/main`'s app structure (the H4 branch already adds the raw-body-compatible plugin setup pattern).
- Implement as a **reviewed, net-new feature PR** against `origin/main`, not by reconciling divergent local `main`.
