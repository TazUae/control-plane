# ERP-side execution interface (target)

This document defines the narrow ERP-side runtime contract that will back `RemoteErpBackend`.

## Allowed actions only

- create site
- install app (`erpnext`)
- enable scheduler
- add domain
- create API user
- health check

Each action must have typed inputs/outputs and bounded, structured error responses.

## Explicitly forbidden

- Arbitrary shell execution
- Generic command runner endpoint
- Unrestricted bench passthrough
- Generic Docker control

## Design notes

- Keep Control Plane orchestration model unchanged.
- Keep current queue/worker/state-machine flow unchanged.
- Keep provisioning-agent HTTP contract stable.
- Keep execution API narrow and operation-specific.
- Validate inputs before command execution.
- Do not return raw stdout/stderr to upper layers.
