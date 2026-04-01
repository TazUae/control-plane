# Provisioning Interface Contract

This document describes the shared HTTP contract shapes defined in `src/lib/provisioning/contract.ts`.

## Environment Variables

- `PROVISIONING_API_URL`: Base URL of the provisioning service. If set, the Control Plane uses the HTTP adapter.
- `PROVISIONING_API_TOKEN`: Bearer token used as `Authorization: Bearer <token>` for outbound provisioning requests.
- `PROVISIONING_API_TIMEOUT_MS`: Request timeout in milliseconds for HTTP adapter calls (default `120000`).
- If `PROVISIONING_API_URL` is not set, Control Plane falls back to the temporary Docker adapter.

## Deployment Networking Assumptions

- In deployment mode, Control Plane and `provisioning-agent` run on the same internal Docker network.
- `PROVISIONING_API_URL` should point to the internal service DNS name (example: `http://provisioning-agent:8080`).
- `provisioning-agent` should remain internal-only and not publicly exposed by default.
- Control Plane sends bearer auth to the provisioning agent using `PROVISIONING_API_TOKEN`.

## Execution Ownership

- Provisioning command execution belongs to `provisioning-agent` in production architecture.
- Control Plane worker orchestrates step state and retries, then calls the provisioning interface over HTTP.
- Direct docker execution inside Control Plane is a temporary legacy fallback and is deprecated.

## Response Envelope

Success responses:

```json
{
  "ok": true,
  "data": {},
  "timestamp": "2026-04-01T15:00:00.000Z"
}
```

Failure responses:

```json
{
  "ok": false,
  "error": {
    "code": "ERP_TIMEOUT",
    "message": "Provisioning action timed out",
    "retryable": true,
    "details": "Action createSite exceeded 120000ms"
  },
  "timestamp": "2026-04-01T15:00:00.000Z"
}
```

## GET `/health`

Example success:

```json
{
  "ok": true,
  "data": {
    "status": "ok",
    "service": "provisioning-service",
    "version": "1.0.0"
  },
  "timestamp": "2026-04-01T15:00:00.000Z"
}
```

## POST `/sites/create`
## POST `/sites/install-erp`
## POST `/sites/enable-scheduler`
## POST `/sites/add-domain`
## POST `/sites/create-api-user`

These endpoints are expected to be idempotent by design. Repeated calls for the same target state should return a success envelope, even when the operation was already completed previously.

Expected idempotent success semantics:

- `alreadyExists`: use for create-style operations such as `/sites/create`.
- `alreadyInstalled`: use for install operations such as `/sites/install-erp`.
- `alreadyConfigured`: use for configuration operations such as scheduler/domain/api-user steps.
- `outcome`:
  - `applied`: operation changed state during this request.
  - `already_done`: operation was already in the desired state before this request.

Example request payload for all site operation endpoints:

```json
{
  "site": "acme",
  "context": {
    "requestId": "req-123",
    "tenantId": "tenant-abc"
  }
}
```

Example success payload:

```json
{
  "ok": true,
  "data": {
    "action": "createSite",
    "site": "acme",
    "message": "Site created",
    "outcome": "applied",
    "stdout": "ok",
    "stderr": "",
    "durationMs": 940
  },
  "timestamp": "2026-04-01T15:00:00.000Z"
}
```

Example idempotent success payload ("already done"):

```json
{
  "ok": true,
  "data": {
    "action": "createSite",
    "site": "acme",
    "message": "Site already exists",
    "outcome": "already_done",
    "alreadyExists": true
  },
  "timestamp": "2026-04-01T15:00:00.000Z"
}
```

## Error Codes

- `INFRA_UNAVAILABLE`
- `ERP_COMMAND_FAILED`
- `ERP_VALIDATION_FAILED`
- `ERP_TIMEOUT`
- `ERP_PARTIAL_SUCCESS`
- `SITE_ALREADY_EXISTS`
