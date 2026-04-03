# ERP-side execution service

This document describes the **`erp-execution-service`** package in this repository: a small Fastify service that runs **only** allowlisted ERP lifecycle actions behind an internal HTTP API. It is designed to be called by **`provisioning-agent` → `RemoteErpBackend`** without changing Control Plane orchestration or queue logic.

## Allowed actions only

| Action | Payload |
|--------|---------|
| `createSite` | `{ "site": string }` |
| `installErp` | `{ "site": string }` |
| `enableScheduler` | `{ "site": string }` |
| `addDomain` | `{ "site": string, "domain": string }` |
| `createApiUser` | `{ "site": string, "apiUsername": string }` |
| `healthCheck` | `{ "deep"?: boolean }` |

No other actions or generic command paths are supported.

## Endpoints

### `GET /internal/health`

Health probe for internal orchestration (no authentication).

**Example response**

```json
{
  "ok": true,
  "data": {
    "status": "ok",
    "service": "erp-execution-service"
  }
}
```

### `POST /v1/erp/lifecycle`

Executes one lifecycle action. **Requires Bearer authentication.**

**Headers**

- `Authorization: Bearer <ERP_REMOTE_TOKEN>`
- `Content-Type: application/json`

**Request**

```json
{
  "action": "healthCheck",
  "payload": {}
}
```

**Success response**

```json
{
  "ok": true,
  "data": {
    "durationMs": 31,
    "metadata": { "status": "ok" }
  },
  "timestamp": "2026-04-03T12:00:00.000Z"
}
```

**Failure response**

```json
{
  "ok": false,
  "error": {
    "code": "ERP_COMMAND_FAILED",
    "message": "ERP lifecycle command failed",
    "retryable": false
  },
  "timestamp": "2026-04-03T12:00:00.000Z"
}
```

Unauthorized requests return **401** with a failure-shaped body (`code: ERP_VALIDATION_FAILED`, `message: Unauthorized`).

## Failure taxonomy (aligned with provisioning-agent)

| Code | Meaning |
|------|---------|
| `INFRA_UNAVAILABLE` | Missing runtime/executable, spawn failure, or other dependency failure |
| `ERP_COMMAND_FAILED` | Allowlisted command ran but exited non-zero |
| `ERP_TIMEOUT` | Action exceeded `ERP_COMMAND_TIMEOUT_MS` |
| `ERP_VALIDATION_FAILED` | Invalid JSON envelope, invalid payload, semantic validation failure, or unauthorized |
| `ERP_PARTIAL_SUCCESS` | Reserved for ambiguous states (not used in normal flows for this service) |
| `SITE_ALREADY_EXISTS` | Duplicate site/domain / “already exists” style condition |

HTTP status codes align with `provisioning-agent` `remote-mapper` expectations (for example `503` / `400` / `504` / `422` / `500` / `409` for the six failure codes).

**Important:** Raw **stdout/stderr** from bench are **not** returned in API responses. They may appear only in **internal** service logs for debugging.

## Internal-only deployment expectation

- Run beside the ERP bench (or on the same host) with **restricted network access**.
- Not intended as a public-facing API.
- Pair with `provisioning-agent` using a shared secret (`ERP_REMOTE_TOKEN`).

## Explicit prohibitions

This service does **not** implement:

- Arbitrary shell execution
- A generic command runner
- Unrestricted bench passthrough
- Generic Docker or host control APIs

Execution is limited to fixed **argv** sequences for each allowlisted action inside `ErpExecutionAdapter`.

## Relationship to provisioning-agent

- **Contract:** `provisioning-agent/src/providers/erpnext/remote-contract.ts` and `RemoteErpBackend` POST to `/v1/erp/lifecycle` with the same envelope.
- **Docker default:** `ERP_EXECUTION_BACKEND=docker` remains the default; `DockerExecBackend` is a **temporary** bridge until environments switch to `remote`.
