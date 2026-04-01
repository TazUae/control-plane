# ERP execution backend

## Purpose

Provisioning operations (create site, install ERP, scheduler, domain, API user) are implemented behind a **narrow typed interface** (`ErpExecutionBackend` in `src/providers/erpnext/erp-execution-backend.ts`). HTTP routes, request validation, response envelopes, and error mapping stay unchanged; only the execution layer is pluggable.

## Current backend (temporary): `DockerExecBackend`

**Location:** `src/providers/erpnext/docker-exec-backend.ts`

Today the agent runs allowlisted `bench` commands via `docker exec` on the configured ERP container. This is **explicitly temporary**: it couples provisioning to Docker and host layout. It remains the default until a non-Docker execution path is ready.

**Characteristics:**

- Uses `spawn` with a fixed `docker` argv built only from `buildBenchArgs` in `commands.ts` (no shell, no user-controlled argv).
- Environment variables (`ERP_CONTAINER_NAME`, `ERP_BENCH_PATH`, etc.) configure the container and bench path.

## Target long-term backend

The intended direction is a **non-Docker** implementation of the same `ErpExecutionBackend` interface—for example:

- Direct `bench` on the host or a dedicated worker VM.
- A stable internal API that performs the same operations without exposing bench or shell to callers.

That new class would replace `DockerExecBackend` in `server.ts` wiring while `ErpnextExecutor` and routes stay the same.

## Migration path

1. Implement `ErpExecutionBackend` with the new transport (no changes to Zod schemas or route paths).
2. Swap `new DockerExecBackend()` for the new implementation in `server.ts` (or a small factory if multiple modes are needed).
3. Remove or archive `DockerExecBackend` when Docker is no longer required in deployment.
4. Keep `exec.ts` scoped to backends that truly need process spawn; avoid leaking it as a public API.

## Security rule (non-negotiable)

**No arbitrary command execution:** the product must never expose:

- A generic shell runner or `bash -c`.
- Raw bench passthrough or user-controlled argv.
- Any endpoint or service API that runs arbitrary strings as commands.

Only the fixed methods on `ErpExecutionBackend` are allowed call sites for provisioning execution; each method corresponds to one approved operation with typed inputs.
