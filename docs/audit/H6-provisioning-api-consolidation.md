# H6 — Consolidate the divergent `provisioning_api` Frappe apps (AUDIT + PLAN ONLY)

**Status:** Audit only. **No directories deleted or renamed in this run.**

## Problem
Multiple Frappe apps share the name `provisioning_api` with **divergent code and security models**, creating a deploy-the-wrong-one hazard (workspace `CLAUDE.md` flags untracked/divergent ERP app files as a deployment risk).

## Evidence
- **Canonical (full app): top-level `provisioning_api/`.** Contains `api/bootstrap.py`, `fitdesk_setup.py`, `user.py`, `financial_setup_runner.py`, `domain_setup.py`, `regional.py`, `smoke_test.py`, `scheduling.py`. The bench-agent invokes **exactly these** methods (`bench-agent/src/axis_bench_agent/bench.py`: `provisioning_api.api.bootstrap.setup_locale`, `...fitdesk_setup.setup_fitdesk_schema`, `...user.create_api_user`, `...financial_setup_runner.run_financial_setup`, …). For provisioning to function, **this** app must be installed on the bench. Its whitelisted methods (`scheduling.py`) are session-authed (no `allow_guest`).
- **Divergent stub: `erp-execution-service/provisioning_api/`.** Only `api/provisioning.py` (guest+token RPCs that `return not_implemented_payload(...)`) + `scheduling.py` + `auth.py` + `fd_session*` doctypes. **Lacks** bootstrap/fitdesk_setup/user — if this were the installed app, provisioning would fail (missing methods). Its `allow_guest=True` RPCs are themselves safe (constant-time `X-Provisioning-Token` check, fail-closed, stub bodies) — see `auth.py` — but their existence adds confusion.
- **Branch-snapshot copies:** `erp-execution-service-{fetch-timeout,main-clean,phase2-split,transfer}/provisioning_api/` and `provisioning_api-commit-0a/` — all the stub variant.

## Impact
If the stub app is deployed instead of the canonical one, provisioning breaks. Divergent copies make it unclear which is authoritative and risk drift in DocTypes/server scripts.

## Cleanup plan (do NOT delete/rename yet)
1. **Confirm the deploy path:** trace the Dockerfile/compose/`bench get-app|install-app` source to determine which `provisioning_api/` is actually installed on the bench. (Method-existence evidence points to the **top-level** app.)
2. **Designate canonical:** top-level `provisioning_api/`. Record its owning repo + app version.
3. **Reconcile the stub:** decide whether `erp-execution-service/provisioning_api/` is legacy, a deliberate contract stub for the guest `read_site_db_name` path, or dead. If the guest `read_site_db_name` is needed, fold it into the canonical app (single source).
4. **Remove duplicates:** delete the branch-snapshot copies (see the previously-provided, still-deferred `rm -rf` list) **only after** confirming no unmerged work via `diff`.
5. **Guardrail:** add a doc/CI check asserting a single `provisioning_api` source of truth.

## Deploy-path confirmation (this run)
Confirmed via `bench-agent/Dockerfile` (lines ~6-29): the bench image **bakes the top-level `../provisioning_api`** into `/home/frappe/frappe-bench/apps/provisioning_api` for `bench install-app provisioning_api` (built from the repo root so the context includes `../provisioning_api`). **→ The top-level `provisioning_api/` is the canonical, deployed app**, consistent with the method-existence evidence.

**Verify before consolidating:** `erp-execution-service/docker-compose.dokploy.yml:27` sets `ERP_METHOD_CREATE_SITE=provisioning_api.api.provisioning.create_site`. Confirm `api/provisioning.create_site` exists in the **canonical top-level** app — if that method currently lives only in the `erp-execution-service/provisioning_api` stub, the deployed app may be missing a configured entrypoint (a real consolidation gap; fold it into the canonical app). No directories were deleted/renamed this run.

## Risks
- Deleting a copy that's actually deployed, or that holds unmerged DocType/server-script changes, would break provisioning. Confirm the deploy path and diff every copy before any removal (separate, approved step).
