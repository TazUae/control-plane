# M1 — ERP proxy upstream bounds (PLAN ONLY)

**Status:** Plan only. The ERP proxy **module does not exist on `origin/main`**, so per the "do not invent a large replacement module" rule it is **not implemented** here.

## Finding
- `src/config/env.ts:42` references `/api/erp/doctype/*` proxy routes (config gate: returns 503 if the Frappe base URL is omitted), **but no proxy handler exists**: `src/server.ts` registers only `tenant.routes` + `job.routes`; there is no `modules/erp-proxy/`, no `forwardToFrappe`, and no `resolveTenantFromAuth`. The proxy is net-new (it lived only on the divergent local `main`).
- **Related (separate, smaller):** the *provisioning* adapter `src/lib/provisioning/http-adapter.ts` already bounds **time** (undici `Agent` `headersTimeout`/`bodyTimeout` + an `AbortController` on `timeoutMs` — from the merged fetch-timeout fix) but reads `response.text()` (line ~475) with **no response-size cap**. Bounding that would need a streaming read; tracked here as a candidate, not part of M1.

## Required implementation (M1) when the ERP proxy is built
- **Request timeout:** default 15s, env-configurable (`ERP_PROXY_TIMEOUT_MS`).
- **Response-size cap:** default ~5 MB, env-configurable (`ERP_PROXY_MAX_RESPONSE_BYTES`); destroy the socket once exceeded.
- **Safe failure:** hung upstream → `502/504`, socket destroyed (no FD/socket leak); oversized upstream → rejected (502).
- **Method allowlist:** do not blindly passthrough arbitrary HTTP methods to Frappe (related M-tier hardening).
- **Tests:** hanging upstream → bounded 502 within the timeout (no indefinite hang); oversized response → 502. (Use a local fake upstream + low env limits so the paths run fast/deterministically.)

## Notes
- Design reference exists on the divergent local `main` (`src/modules/erp-proxy/erp-proxy.routes.ts`, with `ERP_PROXY_TIMEOUT_MS`/`ERP_PROXY_MAX_RESPONSE_BYTES` knobs + timeout/size tests) — re-implement against `origin/main` as a reviewed net-new feature PR.
- Do not bypass the Control Plane proxy for ERP I/O; this proxy *is* the sanctioned path once built.
