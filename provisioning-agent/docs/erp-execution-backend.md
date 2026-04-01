# ERP execution backend

## Purpose

Provisioning operations (create site, install ERP, scheduler, domain, API user) are implemented behind a **narrow typed interface** (`ErpExecutionBackend` in `src/providers/erpnext/erp-execution-backend.ts`). HTTP routes, request validation, response envelopes, and error mapping stay unchanged; only the execution layer is pluggable.

**Where `host_bench` must run:** the generic `provisioning-agent` Docker image does not include Frappe or bench. See **`docs/erp-side-runtime.md`** for rationale; **`docs/erp-side-runbook.md`** for deployment, health checks, and rollback.

## Backend selection (`ERP_EXECUTION_MODE`)

Wiring is in `src/providers/erpnext/erp-backend-factory.ts` (`createErpExecutionBackend()`), used at startup from `server.ts`.

| Value | Backend | When to use |
|--------|---------|-------------|
| **`host_bench`** (preferred when available) | `HostBenchExecBackend` | **Process** must run on the same machine (or VM) as the real Frappe bench; `bench` is invoked with `cwd` = `ERP_BENCH_PATH`. Not the default slim agent container unless bench is mounted. No Docker CLI. |
| **`docker`** (default) | `DockerExecBackend` | Agent reaches ERP via `docker exec` into `ERP_CONTAINER_NAME`. **Temporary compatibility only** when the agent has Docker CLI but not bench (e.g. generic Dokploy). Long-term Option 2: **`host_bench`** on ERP-side runtime (`docs/erp-side-runbook.md`). |

Set in environment:

```bash
# Preferred on a VM or bare-metal host next to bench:
ERP_EXECUTION_MODE=host_bench
ERP_BENCH_PATH=/home/frappe/frappe-bench
ERP_BENCH_EXECUTABLE=bench

# Legacy default (unchanged if unset):
ERP_EXECUTION_MODE=docker
ERP_CONTAINER_NAME=<erp-backend-container-name>
```

If `ERP_EXECUTION_MODE` is omitted, it defaults to **`docker`** so existing Dokploy and Docker-based deployments keep the same behavior without config changes.

## Preferred backend: `HostBenchExecBackend`

**Location:** `src/providers/erpnext/host-bench-exec-backend.ts`

Runs the same allowlisted bench subcommands as Docker mode, using **`buildBenchOperationArgs`** from `commands.ts` — argv passed to `bench` with **`spawn(ERP_BENCH_EXECUTABLE, args, { cwd: ERP_BENCH_PATH, shell: false })`**. This is the first non-Docker implementation: no `docker exec`, still no arbitrary commands and no bench passthrough from HTTP.

Configure **`ERP_BENCH_EXECUTABLE`** if `bench` is not on `PATH` (for example an absolute path to the bench script).

## Fallback: `DockerExecBackend` (temporary compatibility)

**Location:** `src/providers/erpnext/docker-exec-backend.ts`

Runs allowlisted operations via **`docker exec -w <ERP_BENCH_PATH> <ERP_CONTAINER_NAME> bench …`**. Use this when the agent only has Docker access to the ERP container and **cannot** run `bench` locally. Prefer **`host_bench`** on an ERP-side process once bench co-location is available (`docs/erp-side-runbook.md`).

## Shared allowlist

Bench argv (after the `bench` command) is built only by **`buildBenchOperationArgs`** in `src/providers/erpnext/commands.ts`. Docker mode composes **`buildDockerExecBenchArgv`** = docker prefix + those args. Both backends stay narrow and typed.

## Migration away from Docker backend

1. Place the agent process on an **ERP-side runtime** with bench and **`ERP_BENCH_PATH`** (see **`docs/erp-side-runtime.md`**: systemd on the bench VM, or Docker on that host with explicit bench mounts — not the stock slim image alone).
2. Ensure `bench` works as `ERP_BENCH_EXECUTABLE` with `cwd` = `ERP_BENCH_PATH` for the process user.
3. Set **`ERP_EXECUTION_MODE=host_bench`** (and optionally **`ERP_BENCH_EXECUTABLE`**).
4. Redeploy; HTTP API and Control Plane integration are unchanged.
5. Remove Docker-only dependencies from the old agent host when satisfied.

## Security rule (non-negotiable)

**No arbitrary command execution:** the product must never expose:

- A generic shell runner or `bash -c`.
- Raw bench passthrough or user-controlled argv.
- Any endpoint or service API that runs arbitrary strings as commands.

Only the fixed methods on `ErpExecutionBackend` are allowed call sites for provisioning execution; each method corresponds to one approved operation with typed inputs.
