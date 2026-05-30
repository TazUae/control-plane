# Control-plane deferred hardening: C1 / M1 / H4 (PLAN ONLY)

**Status:** Plan only. These could **not** be cleanly extracted onto the current `origin/main` during the security-branch run, so they are documented here instead of implemented (per the "do not invent large new modules / do not run unauthorized installs" guardrails). H2 (constant-time API key), H3 (stop logging adminPassword), `.gitignore` hygiene, and the H1/H5/H6 audit plans **were** applied on `security/cp-hardening`.

## Why deferred (evidence)
Re-audit of current `origin/main`:
- `src/modules/webhooks/` and `src/modules/erp-proxy/` **do not exist** on `origin/main` — they were net-new modules on the divergent local `main`.
- `src/app.ts` on `origin/main` registers **no** helmet/rate-limit; `package.json` has neither `@fastify/helmet` nor `@fastify/rate-limit`.

## C1 — Payment webhook hardening (NOT on origin/main)
The payment-webhook route module is absent on `origin/main`, so the fix is net-new feature work, not an extraction. When the webhook route is (re)introduced on `origin/main`, it MUST:
- **Fail closed** if `WHISH_MONEY_WEBHOOK_SECRET` is unset (return 401; never accept unsigned).
- Verify HMAC over the **raw request body** captured before JSON parsing, comparing against an **`X-Whish-Signature` header** — never `JSON.stringify(req.body)`, never a `signature` field inside the body.
- Use a **constant-time** comparison (length check + `crypto.timingSafeEqual`).
- **Replay dedupe**: reserve an idempotency key on `transaction_id` (unique-constraint P2002 → return `{ ok, deduped: true }`, no second Payment Entry).
- Tests: valid signature → accepted; wrong/tampered/missing signature → 401; replayed event → deduped.
Reference implementation exists on local divergent `main` (`modules/webhooks/webhook.routes.ts`, commit context around `9a4cd2d`) — use as design input, re-applied to `origin/main`'s app structure (raw-body parser registration on the Fastify instance).

## M1 — ERP proxy bounds (NOT on origin/main)
The ERP proxy route module is absent on `origin/main`. When (re)introduced, the upstream Frappe request MUST be bounded:
- **Request timeout** (default 15s; recommend env-configurable `ERP_PROXY_TIMEOUT_MS`).
- **Max response size cap** (default ~5 MB; recommend env-configurable `ERP_PROXY_MAX_RESPONSE_BYTES`) — destroy the socket past the cap.
- Tests: hanging upstream → bounded 502 (no indefinite hang); oversized response → rejected 502.
Reference: local `modules/erp-proxy/erp-proxy.routes.ts`.

## H4 — Rate limit + helmet + body limit (needs deps + install)
Requires adding **Fastify-v4-compatible** plugins and a dependency install (not authorized in this run):
- `@fastify/rate-limit@^9`, `@fastify/helmet@^11` (NOT v10/v13 — those need Fastify v5).
- **Await** the plugin registration in `app.ts`: `@fastify/rate-limit` installs an `onRoute` hook that only attaches to routes registered *after* it loads; a non-awaited `app.register(...)` leaves routes unthrottled (proven during prior work). Use top-level `await app.register(...)`.
- Make `RATE_LIMIT_MAX` / `RATE_LIMIT_TIME_WINDOW` env-configurable.
- Test MUST prove enforcement: exceed the limit → expect **429** (header presence alone is insufficient).
Reference: local commit `0789fc9` + `app.security.test.ts`.

## Next step
Implement C1/M1/H4 as **net-new, reviewed feature PRs against current `origin/main`** (each with the tests above), on a branch where a dependency install is authorized — not by reconciling the divergent local `main`.
