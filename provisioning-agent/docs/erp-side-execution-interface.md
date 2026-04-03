# ERP-side execution interface (target)

This document defines the narrow ERP-side runtime contract that will back `RemoteErpBackend`.

## Allowed actions only

- create site
- install app (`erpnext`)
- enable scheduler
- add domain
- create API user
- health check

Each action must have typed inputs/outputs and bounded, structured error responses.

### Endpoint

- `POST /v1/erp/lifecycle`

### Auth expectations

- Bearer token authentication is required.
- Caller sends `Authorization: Bearer <ERP_REMOTE_TOKEN>`.
- Missing or invalid auth must return a failure envelope and must not execute lifecycle actions.

### Request envelope

```json
{
  "action": "createSite | installErp | enableScheduler | addDomain | createApiUser | healthCheck",
  "payload": {}
}
```

### Action payload DTOs

- `createSite`: `{ "site": "string" }`
- `installErp`: `{ "site": "string" }`
- `enableScheduler`: `{ "site": "string" }`
- `addDomain`: `{ "site": "string", "domain": "string" }`
- `createApiUser`: `{ "site": "string", "apiUsername": "string" }`
- `healthCheck`: `{ "deep"?: boolean }`

### Response envelope

Success:

```json
{
  "ok": true,
  "data": {
    "durationMs": 31,
    "metadata": { "status": "ok" }
  },
  "timestamp": "2026-04-02T12:00:00.000Z"
}
```

Failure:

```json
{
  "ok": false,
  "error": {
    "code": "INFRA_UNAVAILABLE | ERP_COMMAND_FAILED | ERP_TIMEOUT | ERP_VALIDATION_FAILED | ERP_PARTIAL_SUCCESS | SITE_ALREADY_EXISTS",
    "message": "string",
    "retryable": true,
    "details": "optional string"
  },
  "timestamp": "2026-04-02T12:00:00.000Z"
}
```

### Error taxonomy

- `INFRA_UNAVAILABLE`: transport/system dependency unavailable.
- `ERP_COMMAND_FAILED`: lifecycle action executed but failed.
- `ERP_TIMEOUT`: action exceeded timeout budget.
- `ERP_VALIDATION_FAILED`: request payload invalid.
- `ERP_PARTIAL_SUCCESS`: unexpected/ambiguous failure state.
- `SITE_ALREADY_EXISTS`: idempotent site/domain duplicate condition.

### Timeout behavior

- Caller timeout is configured by `ERP_REMOTE_TIMEOUT_MS`.
- Timeout at transport level must map to `ERP_TIMEOUT` and be retryable.

### Idempotency expectations

- `createSite`/`addDomain` duplicate-safe responses must map to `SITE_ALREADY_EXISTS`.
- Action handlers should be safely repeatable where possible and return typed failure codes for already-satisfied state.

## Explicitly forbidden

- Arbitrary shell execution
- Generic command runner endpoint
- Unrestricted bench passthrough
- Generic Docker control

## Design notes

- Keep Control Plane orchestration model unchanged.
- Keep current queue/worker/state-machine flow unchanged.
- Keep provisioning-agent HTTP contract stable.
- Keep execution API narrow and operation-specific.
- Validate inputs before command execution.
- Do not return raw stdout/stderr to upper layers.
