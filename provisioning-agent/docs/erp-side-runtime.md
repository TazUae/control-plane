# ERP-side runtime for non-Docker execution (Option 2)

**Operator steps (systemd, health, rollback):** **`docs/erp-side-runbook.md`**. **Templates:** `deploy/erp-side/systemd/`.

## Problem: why `host_bench` fails in a generic Dokploy app container

The HTTP API and `ErpExecutionBackend` contract are unchanged. What *does* change with **`ERP_EXECUTION_MODE=host_bench`** is **where the Node process must run**.

`HostBenchExecBackend` runs the allowlisted `bench` CLI with `cwd` set to **`ERP_BENCH_PATH`** (see `src/providers/erpnext/host-bench-exec-backend.ts`). That requires:

1. **`bench` on `PATH`** (or **`ERP_BENCH_EXECUTABLE`** pointing at a real script/binary).
2. **A real Frappe bench workspace** at **`ERP_BENCH_PATH`** (e.g. `/home/frappe/frappe-bench`), readable by the agent process.

The standard **`provisioning-agent` Docker image** (`provisioning-agent/Dockerfile`) is a minimal **Node 20** image. It does **not** install Frappe/bench, and it does **not** contain your ERP tree. So in that container:

- `bench` is typically **not** installed.
- `/home/frappe/frappe-bench` (or your real path) **does not exist** unless you explicitly mount it.

That is **expected**: the generic agent container is the wrong *physical* runtime for `host_bench`. It is still the right place for **`docker`** mode (`DockerExecBackend`), which only needs the Docker CLI to `docker exec` into the ERP container.

## Where the ERP-side execution runtime should live

**`host_bench` is for processes that co-locate with the real bench** — same machine or same VM as the Frappe bench install, with the bench directory and permissions your ops model allows.

Recommended patterns (pick one):

### A. Systemd (or similar) on the ERP host / bench VM

- Run `provisioning-agent` **on the host** (or on the same VM that holds bench), as a dedicated user that may run `bench` and read the bench tree.
- Bind HTTP only to a private interface or firewall to the internal network Control Plane uses.
- Set **`ERP_EXECUTION_MODE=host_bench`**, **`ERP_BENCH_PATH`**, and **`ERP_BENCH_EXECUTABLE`** to match that host.

### B. Docker on the ERP host with explicit bench mounts (advanced)

- Run the **same** `provisioning-agent` image, but **not** as an isolated generic stack app:
  - Mount the **host** bench directory into the container at **`ERP_BENCH_PATH`**.
  - Mount or install **`bench`** inside the image **or** use **`ERP_BENCH_EXECUTABLE`** to a path that exists in the container (often copied from host via mount).
  - Run as a user/group with permission to read/write the bench tree as required by your Frappe version.
- This is operationally heavier than (A) but keeps a single container artifact.

### C. Keep `docker` until (A) or (B) is ready

- **`DockerExecBackend`** remains valid: agent stays on the internal Docker network and uses **`docker exec`** into **`ERP_CONTAINER_NAME`**. No bench inside the agent image.

**Control Plane** only needs a stable internal URL (`PROVISIONING_API_URL`); it does not care whether the agent uses `docker` or `host_bench` behind the same routes.

## Permissions

Whatever user runs the agent must be able to:

- Execute **`bench`** (or the script at **`ERP_BENCH_EXECUTABLE`**).
- Use **`ERP_BENCH_PATH`** as the working directory for those invocations.

Follow your ERP security baseline (often the `frappe` user or a dedicated ops user). Do **not** widen the product API: execution stays limited to **`ErpExecutionBackend`** methods and **`buildBenchOperationArgs`** — no shell passthrough.

## Startup validation

When **`ERP_EXECUTION_MODE=host_bench`**, the server calls **`validateHostBenchPaths`** (`src/config/host-bench-runtime.ts`) before binding HTTP:

- **`ERP_BENCH_PATH`** must exist and be a directory.
- If **`ERP_BENCH_EXECUTABLE`** looks like a filesystem path, that path must exist and be readable.

A bare name such as `bench` is not preflight-checked (depends on `PATH` at runtime).

## Migration from the current setup

1. **Leave Control Plane config unchanged** (same `PROVISIONING_API_URL`, token, timeouts).
2. **Choose a runtime** (A or B above) where bench and **`ERP_BENCH_PATH`** actually exist.
3. **Deploy `provisioning-agent` there** with the same env vars as today, except:
   - Set **`ERP_EXECUTION_MODE=host_bench`**.
   - Set **`ERP_BENCH_PATH`** / **`ERP_BENCH_EXECUTABLE`** to match that host.
4. **Smoke-test** `GET /health` and one provisioning flow from Control Plane.
5. **Decommission** reliance on **`DockerExecBackend`** on the old agent host if you no longer need **`ERP_EXECUTION_MODE=docker`** there.

## `DockerExecBackend` role (temporary compatibility only)

**`DockerExecBackend`** (`ERP_EXECUTION_MODE=docker`, default) is a **temporary compatibility** mode: the agent has the Docker CLI and reaches bench **inside** the ERP container via **`docker exec`**. Use it for **generic** Dokploy stacks where the agent image does **not** co-locate with the bench tree.

It is **not** the long-term target for Option 2 when you can run **`host_bench`** on an ERP-side runtime (**`docs/erp-side-runbook.md`**). Same HTTP contract; migrate by relocating the process and setting **`ERP_EXECUTION_MODE=host_bench`**, then pointing Control Plane at the new reachable URL if needed.
