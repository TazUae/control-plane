# Provisioning Interface Execution Checklist

## Phase C Status (current)

- [x] Added typed ERP execution backend abstraction in provisioning-agent runtime path.
- [x] Kept `docker` as default backend for compatibility.
- [x] Added `remote` backend path with explicit non-fallback behavior.
- [x] Added typed ERP-side lifecycle request/response contract.
- [x] Added remote failure mapping to existing taxonomy.
- [x] Added remote backend env configuration keys.
- [x] Added tests for config-missing, timeout, validation, and already-exists mapping.

## Scope Guardrails

- [x] Keep queue topology unchanged (`tenant-provisioning`, BullMQ producer/worker flow).
- [x] Preserve `runProvisioning` step order and retry behavior (max retries, backoff, step state writes).
- [x] Avoid DB schema changes unless blocked by a hard requirement.
- [x] Keep Docker adapter available as fallback; do not remove it.
- [x] Ship minimal, production-safe changes with feature-flagged adapter selection.

## Phase 1 - Interface and Contract

- [ ] Confirm existing adapter boundary in `src/lib/provisioning/interface.ts` remains the single execution contract.
- [ ] Define HTTP provisioning contract per existing step methods (createSite/installErp/enableScheduler/addDomain/createApiUser/healthCheck).
- [ ] Define response/error mapping rules into current `ProvisioningError` model.

## Phase 2 - Configuration and Selection

- [ ] Add env keys for adapter mode and HTTP endpoint/auth/timeout in `src/config/env.ts`.
- [ ] Update adapter factory in `src/lib/provisioning/index.ts` to select Docker or HTTP adapter by env.
- [ ] Default to Docker mode for safe rollout; HTTP mode opt-in only.

## Phase 3 - HTTP Adapter Implementation

- [ ] Add `src/lib/provisioning/http-provisioning-adapter.ts` implementing `ProvisioningAdapter`.
- [ ] Implement per-step HTTP calls with strict input validation and timeout handling.
- [ ] Translate transport, timeout, and remote business failures into typed `ProvisioningError` codes.
- [ ] Add structured logs aligned with current logger conventions (context IDs, no secret leakage).

## Phase 4 - Verification and Non-Regression

- [ ] Verify queue enqueue path remains unchanged in `src/modules/tenants/tenant.routes.ts`.
- [ ] Verify worker entry and processing path remain unchanged in `scripts/worker.ts`.
- [ ] Verify state runner behavior remains unchanged in `src/jobs/state/runner.ts`.
- [ ] Add/update retry classification tests only if new error codes are introduced.

## Phase 5 - Rollout Safety

- [ ] Test in Docker mode (baseline parity with current behavior).
- [ ] Test in HTTP mode (success path, retryable failures, non-retryable failures).
- [ ] Validate idempotency + lock behavior unaffected under both modes.
- [ ] Capture rollback plan: switch env back to Docker adapter without redeploying code.

## Done Criteria

- [ ] Existing queue/worker/state-runner behavior is preserved.
- [ ] HTTP adapter is selectable and production-safe behind env gating.
- [ ] No unintended schema or flow regressions detected.
- [ ] Operational logs and error semantics remain consistent.

## Legacy Docker Path Status

- Direct docker execution from Control Plane is deprecated.
- Remaining docker adapter exists only as temporary fallback when `PROVISIONING_API_URL` is unset.
- Production target architecture is Control Plane orchestration + provisioning-agent execution.
- For provisioning-agent ERP execution, `ERP_EXECUTION_BACKEND=docker` remains default until ERP-side lifecycle service is deployed.
