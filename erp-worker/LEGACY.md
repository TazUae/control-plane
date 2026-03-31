# Legacy Runtime (Do Not Use For Production)

This directory is a legacy worker/API path kept only for reference.

Canonical production runtime is:

- API: `src/server.ts`
- Worker: `scripts/worker.ts`
- Queue: `tenant-provisioning`

Do not deploy `erp-worker` in production unless it is explicitly migrated to the canonical runtime contract.
