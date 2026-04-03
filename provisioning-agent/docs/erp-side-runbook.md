# Operator runbook: ERP-side `provisioning-agent` (legacy runtime notes)

This runbook describes legacy ERP-side runtime relocation notes. Strategic backend selection is now `ERP_EXECUTION_BACKEND=docker|remote`; `host_bench` is internal/legacy and not the approved long-term architecture. The **HTTP contract is unchanged**; Control Plane keeps the same endpoints and payloads—only **`PROVISIONING_API_URL`** (reachability) may need to change when the agent’s network location changes.

Background: **`docs/erp-side-runtime.md`**. Backend semantics: **`docs/erp-execution-backend.md`**.

---

## 1. Chosen deployment approach (recommended)

**Primary: systemd-managed Node process on the ERP / bench VM**

- One long-running `node` process (built `provisioning-agent`), owned by a **dedicated Unix user**.
- **Working directory** for the service = application install root (e.g. `/opt/provisioning-agent`), **not** `ERP_BENCH_PATH`. Bench runs use `cwd: ERP_BENCH_PATH` inside `HostBenchExecBackend` only.
- **Process manager:** **systemd** (alternatives: OpenRC, supervisord—same env and `ExecStart` idea).
- **Listen:** default app binds `0.0.0.0:PORT` (`server.ts`). Restrict exposure with **host firewall** and/or **reverse proxy** so only Control Plane (and ops) can reach the port.
- **`DockerExecBackend`:** leave documented as **temporary compatibility** for stacks where the agent has Docker CLI but not bench (`docs/erp-side-runtime.md`). Not used on this host when following this runbook.

**Alternate:** run the same Docker image **on the ERP host** with the bench directory **bind-mounted** into the container—heavier; see **`docs/erp-side-runtime.md` § B**.

---

## 2. Preconditions

| Requirement | Notes |
|-------------|--------|
| **Node.js 20+** | Match `provisioning-agent/Dockerfile` base; LTS from your distro or NodeSource. |
| **Built app** | `npm ci --omit=dev && npm run build` in install root; `node dist/server.js` is the entrypoint. |
| **Bench tree** | Directory at **`ERP_BENCH_PATH`** exists on this host (e.g. `/home/frappe/frappe-bench`). |
| **`bench` CLI** | On `PATH` for the service user, or set **`ERP_BENCH_EXECUTABLE`** to an absolute path. |
| **Service user** | Dedicated account (e.g. `provisioning-agent`). Must be allowed to run `bench` with `cwd = ERP_BENCH_PATH` (often membership in `frappe` group or equivalent—**site-specific**). |
| **Secrets** | **`PROVISIONING_API_TOKEN`** and **`ERP_ADMIN_PASSWORD`** match what Control Plane / ERP expect; store in root-owned mode `640` env file or secret manager. |
| **Network** | Route/firewall from **Control Plane → this host:`PORT`**. If the agent was previously at `http://provisioning-agent:8080` on Docker DNS, after move you typically use **`http://<private-ip-or-dns>:8080`** reachable from CP. |

Legacy host-bench validation fails fast if **`ERP_BENCH_PATH`** is missing or wrong—see `src/config/host-bench-runtime.ts`.

---

## 3. Service configuration

### 3.1 Environment (required)

Set these in an **`EnvironmentFile`** (e.g. `/etc/provisioning-agent/environment`) or equivalent:

| Variable | backend/runtime notes |
|----------|---------------------|
| `NODE_ENV` | `production` |
| `PORT` | e.g. `8080` (must match firewall and Control Plane URL) |
| `PROVISIONING_API_TOKEN` | Strong shared secret with Control Plane |
| `ERP_ADMIN_PASSWORD` | ERP admin password for scripted operations |
| `ERP_EXECUTION_BACKEND` | **`docker`** for current supported strategic path (default); `remote` is scaffold-only and currently returns not-implemented |
| `ERP_BENCH_PATH` | Absolute path to real bench on **this** host |
| `ERP_BENCH_EXECUTABLE` | `bench` or absolute path |
| `ERP_BASE_DOMAIN` | As today |
| `ERP_API_USERNAME_PREFIX` | As today |
| `ERP_COMMAND_TIMEOUT_MS` | As today (e.g. `120000`) |
| `ERP_CONTAINER_NAME` | Required for `docker` backend |

Copy from **`deploy/erp-side/systemd/provisioning-agent.env.example`** and edit secrets/paths.

### 3.2 Working directory

- **`WorkingDirectory=`** (systemd) = install root containing `dist/server.js` and `node_modules` (e.g. `/opt/provisioning-agent`).
- **`ERP_BENCH_PATH`** ≠ app root; it is only the bench tree for spawned `bench` processes.

### 3.3 User and permissions

- Run the service as **non-root** (`User=` / `Group=`).
- Ensure that user can **read/execute** `ERP_BENCH_EXECUTABLE` and **access** `ERP_BENCH_PATH` as required by your Frappe version (sometimes group `frappe`, sometimes sudo—**avoid** granting the agent broad sudo; prefer filesystem ACLs/group).
- Do not place world-readable files containing `PROVISIONING_API_TOKEN` or `ERP_ADMIN_PASSWORD`.

### 3.4 systemd unit (template)

See **`deploy/erp-side/systemd/provisioning-agent.service.example`**. Install as `/etc/systemd/system/provisioning-agent.service` (drop `.example`), run:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now provisioning-agent
```

Adjust **`ExecStart`** if `node` is not `/usr/bin/node` (e.g. nvm-managed paths are possible but less ideal for production—prefer system Node or a wrapper script).

---

## 4. Deployment procedure (operators)

1. **Choose install root** (e.g. `/opt/provisioning-agent`) and owner (e.g. `provisioning-agent:provisioning-agent`).
2. **Copy codebase** or release artifact; run `npm ci --omit=dev && npm run build` as that user (or build in CI and copy `dist/` + `package.json` + lockfile + `node_modules` from `npm ci --omit=dev`).
3. **Create** `/etc/provisioning-agent/environment` from the example; set **`ERP_EXECUTION_BACKEND=docker`** (current strategic default), token, and passwords.
4. **Install** systemd unit; `daemon-reload`, `enable`, **do not start** yet if you need a maintenance window.
5. **Firewall:** allow inbound TCP `PORT` from Control Plane subnet only.
6. **Control Plane:** set **`PROVISIONING_API_URL`** to the new base URL (e.g. `http://10.x.x.x:8080`). Token must match **`PROVISIONING_API_TOKEN`**.
7. **Start:** `systemctl start provisioning-agent`.
8. **Verify** (below).
9. **Decommission** the old generic-container agent if it is fully replaced, or keep it stopped to avoid accidental dual-writes (only one should receive CP traffic).

---

## 5. Startup verification

On the **ERP host**:

```bash
sudo systemctl status provisioning-agent --no-pager
sudo journalctl -u provisioning-agent -n 50 --no-pager
```

If legacy host-bench validation fails, logs show runtime validation errors and the process exits.

**Health (authenticated not required for GET /health):**

```bash
curl -sS "http://127.0.0.1:8080/health"
```

Expect JSON with `"ok": true`, `"data"."status": "ok"`, `"data.service": "provisioning-agent"`.

From a host on the **same network as Control Plane** (adjust host/port):

```bash
curl -sS "http://<agent-host>:8080/health"
```

Optional: trigger a **non-production** provisioning step from Control Plane or a manual `curl` POST with `Authorization: Bearer …` per `docs/provisioning-contract.md`.

---

## 6. Rollback

Goal: restore service using **`DockerExecBackend`** (or the previous agent instance) without changing Control Plane code.

1. **Control Plane:** set **`PROVISIONING_API_URL`** back to the previous base URL (e.g. internal Docker DNS `http://provisioning-agent:8080`).
2. **ERP host:** `sudo systemctl stop provisioning-agent` (and `disable` if removing the service).
3. **Previous agent:** ensure the old container/process is **running** with **`ERP_EXECUTION_BACKEND=docker`** and valid **`ERP_CONTAINER_NAME`**.
4. **Verify:** `GET /health` on the old URL; run a safe read-only or staging provisioning check.
5. **Firewall:** remove ERP-host rules that opened the agent port if no longer needed.

HTTP API semantics are identical between modes; rollback is **routing + runtime**, not contract.

---

## 7. Security reminders (unchanged product rules)

- No generic command API; **`ErpExecutionBackend`** only.
- Keep the agent **internal**; no public ingress by default.
- **`DockerExecBackend`** remains **temporary compatibility** today. The approved long-term direction is **`RemoteErpBackend`** via the ERP-side execution interface; keep any `host_bench` usage internal/legacy only.
