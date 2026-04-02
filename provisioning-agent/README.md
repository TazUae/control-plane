# provisioning-agent

Internal-only provisioning service for ERP host actions.

## Purpose

- Exposes a narrow HTTP API for approved provisioning actions.
- Uses token auth (`Authorization: Bearer <PROVISIONING_API_TOKEN>`).
- Executes only allowlisted ERP operations through the typed **`ErpExecutionBackend`** interface (`src/providers/erpnext/erp-execution-backend.ts`).
- Backend is selected with **`ERP_EXECUTION_BACKEND`**:
  - **`docker`** (default): `DockerExecBackend` temporary bridge using strict `docker exec` argv.
  - **`remote`**: `RemoteErpBackend` scaffold that fails safely with not-implemented errors.
- No arbitrary shell execution, no `bash -c`, no generic bench passthrough, no generic Docker control.

## Endpoints

- `GET /health`
- `POST /sites/create`
- `POST /sites/install-erp`
- `POST /sites/enable-scheduler`
- `POST /sites/add-domain`
- `POST /sites/create-api-user`

## Setup

1. Copy `.env.example` to `.env` and fill values.
2. Install dependencies:
   - `npm install`
3. Run in development:
   - `npm run dev`
4. Build:
   - `npm run build`
5. Start built service:
   - `npm start`

## Deployment (Dokploy)

### ERP execution backend

`ERP_EXECUTION_BACKEND=docker` is the default and is intentionally temporary.
The long-term target is an ERP-side remote execution interface (`docs/erp-side-execution-interface.md`), with this agent calling a narrow typed API instead of Docker.

### Container

- Build context: `provisioning-agent`
- Dockerfile: `provisioning-agent/Dockerfile`
- Internal port: `8080`
- Health check path: `GET /health`

### Internal-Only Posture

- Do not publish this service on a public domain by default.
- Attach the container only to internal/private networks in Dokploy.
- Allow inbound traffic only from trusted internal services (for example, the Control Plane API).
- Recommended Dokploy setup: no public ingress/domain, internal service name `provisioning-agent`, and shared private network with Control Plane.

### Required Environment Variables

- `NODE_ENV=production`
- `PORT=8080`
- `PROVISIONING_API_TOKEN=<long-random-internal-token>`
- `ERP_ADMIN_PASSWORD=<erp-admin-password>`
- `ERP_BENCH_PATH=/home/frappe/frappe-bench`
- `ERP_BASE_DOMAIN=<internal-base-domain>`
- `ERP_API_USERNAME_PREFIX=cp`
- `ERP_COMMAND_TIMEOUT_MS=120000`

### ERP execution backend

- **`ERP_EXECUTION_BACKEND`**: `docker` (default) or `remote`.
- **`ERP_CONTAINER_NAME`**: required for `docker` backend.

### Networking Assumptions

- `provisioning-agent` and `control-plane-api` are on the same internal Docker network.
- The service name `provisioning-agent` is resolvable via internal DNS on that network.
- Control Plane calls the agent through an internal URL, not a public endpoint.

### Example Control Plane URL

- `http://provisioning-agent:8080`
- Control Plane should set `PROVISIONING_API_URL=http://provisioning-agent:8080` in deployment configuration.

### Health Expectations

- Dokploy health check target: `GET /health`.
- Expected response: HTTP `200` with envelope `ok: true`, and `data.status: "ok"`, `data.service: "provisioning-agent"`.

## Notes

- This service is designed for internal network deployment only.
- No generic command execution endpoint is provided; **no arbitrary command execution** — only typed backend methods (`createSite`, `installErp`, etc.), never raw bench or shell passthrough.
- Response envelopes are contract-aligned for Control Plane integration.
- ERP execution is allowlisted per action; both backends use `spawn` with argv only (no shell).
- Configure ERP runtime with `ERP_EXECUTION_BACKEND`, `ERP_BENCH_PATH`, `ERP_BASE_DOMAIN`, `ERP_API_USERNAME_PREFIX`, `ERP_COMMAND_TIMEOUT_MS`, and `ERP_CONTAINER_NAME` (docker backend). See `docs/erp-execution-backend.md`.
