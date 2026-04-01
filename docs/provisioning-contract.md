# Provisioning Interface Contract

This document describes the shared HTTP contract shapes defined in `src/lib/provisioning/contract.ts`.

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
    "stdout": "ok",
    "stderr": "",
    "durationMs": 940
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
