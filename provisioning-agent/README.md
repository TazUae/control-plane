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
