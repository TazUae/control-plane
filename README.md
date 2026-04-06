# control-plane

API, worker, and related services for tenant provisioning and ERP coordination. This repository includes `provisioning-agent`, `erp-execution-service`, and other packages under one tree.

## Environment configuration

| Context | Source of truth |
|--------|-------------------|
| **Production (Dokploy)** | Variables in the Dokploy project/environment for this stack. They are passed into containers via `docker-compose.dokploy.yml` using explicit `environment:` entries (`${VAR}` interpolation from the host). |
| **Schema / template** | `.env.example` in each package that needs one — lists required keys with safe placeholders only. |
| **Local development** | A gitignored `.env` file (copy from `.env.example` and edit). Used by `docker-compose.yml` through `env_file:`. |

**Do not commit a real `.env`** or production secrets. After changing Dokploy env vars, **redeploy** the stack so running containers receive the updates.

### Docker Compose layout

- **`docker-compose.yml`** — local development. Uses `env_file` (default path `.env`, override with `ENV_FILE` if needed). Example: `ENV_FILE=.env.example docker compose config` to validate without a `.env` file.
- **`docker-compose.dokploy.yml`** — production / Dokploy. **No `env_file`**; only `environment:` mapping from host/Dokploy env. Set the **Compose file path** in Dokploy to `docker-compose.dokploy.yml` (repo root).

### Key drift check

Compare variable **names** in `.env` vs `.env.example` (values are not printed):

```bash
./scripts/check-env-keys.sh
```

### Related packages

For the standalone `erp-execution-service` image and its compose variants, see [`erp-execution-service/README.md`](erp-execution-service/README.md).
