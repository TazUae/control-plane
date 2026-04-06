# erp-execution-service

Internal-only Node.js service that exposes a **narrow, typed** HTTP API for approved ERP lifecycle actions. It is the intended target for `provisioning-agent` when `ERP_EXECUTION_BACKEND=remote`.

## Purpose

- **Allowlisted actions only** (`createSite`, `readSiteDbName`, `installErp`, `enableScheduler`, `addDomain`, `createApiUser`, `healthCheck`).
- **Bearer authentication** using `ERP_REMOTE_TOKEN` (same secret configured on the provisioning-agent caller).
- **Structured responses** aligned with `provisioning-agent` `remote-contract.ts` (`ok` / `data` or `ok` / `error`).
- **No** arbitrary shell, generic command runner, bench subprocesses, Docker control, or host control APIs — lifecycle calls are **HTTP POSTs** to ERPNext (`ERP_BASE_URL`).

## Endpoints

| Method | Path | Auth |
|--------|------|------|
| `GET` | `/internal/health` | None (internal probes) |
| `POST` | `/v1/erp/lifecycle` | `Authorization: Bearer <ERP_REMOTE_TOKEN>` |

## Stack

- Node.js, TypeScript, Fastify, Zod, Pino

## Scripts

```bash
npm install
npm run dev      # tsx src/server.ts
npm run build    # tsc -> dist/
npm start        # node dist/server.js
npm test
```

## Required environment variables

| Variable | Description |
|----------|-------------|
| `ERP_REMOTE_TOKEN` | Bearer token (min 16 chars) shared with provisioning-agent and sent to ERPNext |
| `ERP_BASE_URL` | ERPNext base URL (e.g. `http://axis-erp-backend:8000`) |
| `ERP_ADMIN_PASSWORD` | Admin password passed to `frappe.api.provisioning.create_site` |
| `ERP_COMMAND_TIMEOUT_MS` | Per-action HTTP timeout (see `.env.example`) |
| `PORT` | Listen port (must match Compose port mapping; see `.env.example`) |
| `NODE_ENV` | `development` \| `test` \| `production` |

ERPNext must implement `frappe.api.provisioning.read_site_db_name` (used for `readSiteDbName` and post-`createSite` `db_name` resolution).

## Deployment

- Deploy **only on private/internal networks** with reachability to ERPNext (`ERP_BASE_URL`).
- Do not expose this service on the public internet without additional controls.
- Point `provisioning-agent` at `ERP_REMOTE_BASE_URL` (e.g. `http://erp-execution-service:8790`) and set `ERP_REMOTE_TOKEN` to the **same value** on both sides.

### Docker / Dokploy

- This package has its own **`Dockerfile`** at `erp-execution-service/Dockerfile` (build context is this directory).
- **Local:** copy **`.env.example`** to **`.env`** (gitignored). Compose files use `env_file` with `${ENV_FILE:-.env}` so you can point at the example for validation: `ENV_FILE=.env.example docker compose config`.
- **Production:** use **`docker-compose.dokploy.yml`**. Runtime values come from **Dokploy env** (explicit `environment:` entries — no `env_file`). Set the **Compose file path** in Dokploy to `erp-execution-service/docker-compose.dokploy.yml`. After changing Dokploy env, **redeploy**.
- **If Dokploy reports “Compose file not found”:** set **Compose file path** to `erp-execution-service/docker-compose.dokploy.yml`. If your Dokploy version clones into a subfolder, adjust the prefix (e.g. `code/erp-execution-service/docker-compose.dokploy.yml`). Ensure the **branch** is correct and redeploy after pushing.
- Identical **local** stacks also exist as `compose.yml`, `compose.yaml`, and `docker-compose.yaml` for tooling that prefers those names.

## Documentation

- Related design notes (when this package lives inside the control-plane monorepo): [`docs/erp-side-execution-service.md`](https://github.com/TazUae/control-plane/blob/main/docs/erp-side-execution-service.md)

## TODOs before switching production from Docker to remote

- Confirm network path from `provisioning-agent` to this service (DNS, TLS if required).
- Set `ERP_REMOTE_BASE_URL`, `ERP_REMOTE_TOKEN`, and `ERP_REMOTE_TIMEOUT_MS` on provisioning-agent.
- Load-test timeouts and tune `ERP_COMMAND_TIMEOUT_MS` vs `ERP_REMOTE_TIMEOUT_MS` (caller should be ≥ server-side execution budget).
- Flip `ERP_EXECUTION_BACKEND=remote` per environment after validation; keep `docker` as rollback until stable.
