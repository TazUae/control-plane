# provisioning-agent

Internal-only provisioning service for ERP host actions.

## Purpose

- Exposes a narrow HTTP API for approved provisioning actions.
- Uses token auth (`Authorization: Bearer <PROVISIONING_API_TOKEN>`).
- Executes only allowlisted ERP commands with `spawn(command, argv)` (no shell interpolation, no `bash -c`).

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

### Container

- Build context: `provisioning-agent`
- Dockerfile: `provisioning-agent/Dockerfile`
- Internal port: `8080`
- Health check path: `GET /health`

### Internal-Only Posture

- Do not publish this service on a public domain by default.
- Attach the container only to internal/private networks in Dokploy.
- Allow inbound traffic only from trusted internal services (for example, the Control Plane API).

### Required Environment Variables

- `NODE_ENV=production`
- `PORT=8080`
- `PROVISIONING_API_TOKEN=<long-random-internal-token>`
- `ERP_CONTAINER_NAME=<erp-backend-container-name>`
- `ERP_ADMIN_PASSWORD=<erp-admin-password>`
- `ERP_BENCH_PATH=/home/frappe/frappe-bench`
- `ERP_BASE_DOMAIN=<internal-base-domain>`
- `ERP_API_USERNAME_PREFIX=cp`
- `ERP_COMMAND_TIMEOUT_MS=120000`

### Networking Assumptions

- `provisioning-agent` and `control-plane-api` are on the same internal Docker network.
- The service name `provisioning-agent` is resolvable via internal DNS on that network.
- Control Plane calls the agent through an internal URL, not a public endpoint.

### Example Control Plane URL

- `http://provisioning-agent:8080`

## Notes

- This service is designed for internal network deployment only.
- No generic command execution endpoint is provided.
- Response envelopes are contract-aligned for Control Plane integration.
- ERP execution is allowlisted per action and uses `spawn` with argv only.
- Configure ERP runtime with:
  - `ERP_CONTAINER_NAME`
  - `ERP_BENCH_PATH`
  - `ERP_BASE_DOMAIN`
  - `ERP_API_USERNAME_PREFIX`
  - `ERP_COMMAND_TIMEOUT_MS`
