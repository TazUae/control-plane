# control-plane

API, worker, and related services for tenant provisioning and ERP coordination. This repository includes `provisioning-agent`, `erp-execution-service`, and other packages under one tree.

## Deployment

**Docker Compose loads variables from a committed `.env` template** next to each `docker-compose.yml` (see `.env.example` for documentation). Services use `env_file: - .env` — there are no `environment:` blocks in compose files.

- After `git pull`, edit `.env` on the server (or use Dokploy / your platform to **override** values) with real production secrets. **Do not commit** secrets: use `.env.local`, `.env.production`, or `.env.secrets` for machine-specific overlays (those filenames are gitignored).
- Dokploy can still inject or replace variables; ensure the final container receives the same keys listed in `.env.example`.

For the standalone `erp-execution-service` image and its compose variants, see [`erp-execution-service/README.md`](erp-execution-service/README.md).
