/**
 * Legacy path disabled: Control Plane orchestration uses HTTP only (`PROVISIONING_API_URL`).
 * Do not use docker exec from this repository; see `erp-worker/LEGACY.md` and canonical `scripts/worker.ts`.
 */
class ERPAdapter {
  constructor() {
    throw new Error(
      "Legacy erp-worker docker-based ERP adapter is disabled. Use the canonical Control Plane worker (scripts/worker.ts) with PROVISIONING_API_URL."
    );
  }
}

module.exports = ERPAdapter;
