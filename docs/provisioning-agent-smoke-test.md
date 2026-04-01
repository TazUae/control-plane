# Provisioning Agent Smoke Test

This verifies Control Plane can execute provisioning over HTTP with `provisioning-agent`.

## Preconditions

- `provisioning-agent` is deployed on an internal network.
- Control Plane can resolve and reach `http://provisioning-agent:8080`.
- Both services share the same `PROVISIONING_API_TOKEN`.
- Control Plane env has:
  - `PROVISIONING_API_URL=http://provisioning-agent:8080`
  - `PROVISIONING_API_TOKEN=<same-token-as-agent>`

## Quick Verification Steps

1. Call provisioning-agent health directly from inside Control Plane runtime network:
   - `GET http://provisioning-agent:8080/health`
   - Expect `200` with `ok: true`.
2. Trigger a tenant provisioning request through Control Plane `POST /tenants`.
3. Confirm Control Plane logs include:
   - `Provisioning adapter selected` with `adapter: "http-provisioning"`.
4. Confirm worker logs show provisioning steps progressing as usual.
5. Confirm `ProvisioningJob` status transitions remain unchanged (`queued -> running -> completed/failed`).

## Fallback Check

- Unset `PROVISIONING_API_URL` and restart Control Plane.
- Confirm logs show adapter selection with `fallbackToDocker: true`.
