# ERP-side deployment templates

Files here support running **`provisioning-agent`** on the **same machine as Frappe bench** with **`ERP_EXECUTION_MODE=host_bench`**.

- **Operator procedure:** `docs/erp-side-runbook.md`
- **Why this layout exists:** `docs/erp-side-runtime.md`

## systemd

- `systemd/provisioning-agent.service.example` — unit file template
- `systemd/provisioning-agent.env.example` — environment file template

Copy to `/etc/systemd/system/` and `/etc/provisioning-agent/` respectively, edit paths and secrets, then `daemon-reload` and `enable --now provisioning-agent`.
