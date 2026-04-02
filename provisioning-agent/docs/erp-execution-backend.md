# ERP execution backend

## Current state

`provisioning-agent` executes ERP lifecycle actions through the typed `ErpExecutionBackend` interface:

- `createSite`
- `installErp`
- `enableScheduler`
- `addDomain`
- `createApiUser`
- `healthCheck`

Backend selection is controlled by `ERP_EXECUTION_BACKEND`:

- `docker` (default): `DockerExecBackend`
- `remote`: `RemoteErpBackend` scaffold that fails safely with a clear not-implemented error

## Important constraints

- `DockerExecBackend` is a **temporary bridge backend**, not the final production architecture.
- No arbitrary shell execution.
- No `bash -c`.
- No user-controlled command interpolation.
- No generic bench passthrough.
- No generic Docker control exposed upstream.

All commands are argv-based (`spawn(..., { shell: false })`) with strict timeout and error mapping.

## Error model

Execution failures are mapped to structured safe codes:

- `INFRA_UNAVAILABLE`
- `ERP_COMMAND_FAILED`
- `ERP_TIMEOUT`
- `ERP_VALIDATION_FAILED`
- `ERP_PARTIAL_SUCCESS`
- `SITE_ALREADY_EXISTS`

Upper/public layers receive only safe fields:

- `code`
- `message`
- `retryable`
- optional non-sensitive `details`

Raw command stdout/stderr stay internal.

## Migration path: docker -> remote

1. Keep current Control Plane orchestration and route contract unchanged.
2. Keep queue/worker/state-machine flow unchanged.
3. Implement ERP-side narrow execution interface (see `docs/erp-side-execution-interface.md`).
4. Implement `RemoteErpBackend` against that interface.
5. Flip `ERP_EXECUTION_BACKEND=remote` per environment when ready.
6. Remove Docker bridge dependency after successful rollout.
