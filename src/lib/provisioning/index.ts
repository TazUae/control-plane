import { HttpProvisioningAdapter } from "./http-adapter.js";
import { ProvisioningAdapter } from "./interface.js";
import { logger } from "../logger.js";

// ---------------------------------------------------------------------------
// Multi-bench routing — design notes (not yet built).
//
// Current topology (single bench):
//   Control Plane → provisioning-agent → erp-execution-service → bench-agent → bench
//   One PROVISIONING_API_URL env var; one adapter instance; one bench.
//
// When a second bench is required (capacity, region, or tenant isolation):
//
//   Schema additions (future migrations):
//     Tenant.benchShard  String?   — null = default shard (shard "0").
//     BenchShard table:  id, provisioning_api_url, label, createdAt
//       Maps shard identifier → provisioning-agent URL for that bench stack.
//       Populated by ops; never auto-assigned.
//
//   Factory change:
//     Replace `getProvisioningAdapter()` with `getAdapterForShard(shard: string)`:
//       - Look up BenchShard row by shard identifier.
//       - Return (or cache) an HttpProvisioningAdapter for that shard's
//         PROVISIONING_API_URL.
//
//   Runner change (runner.ts):
//     At job start, read `tenant.benchShard ?? "0"`, call
//     `getAdapterForShard(shard)` instead of `getProvisioningAdapter()`.
//     No other changes to the state machine.
//
//   Worker / queue change:
//     Each bench worker process listens on a shard-specific queue
//     ("tenant-provisioning:shard-0", "tenant-provisioning:shard-1", …) with
//     concurrency 1. New-tenant assignment writes the shard to Tenant.benchShard
//     and enqueues to the matching queue. Existing tenants stay on shard 0.
//
//   Routing policy (simple starting point):
//     Assign shard by consistent hash of tenant.slug, or round-robin at
//     create time. A shard map table lets ops rebalance manually without
//     code changes.
//
//   BENCH_AGENT_URL in erp-execution-service:
//     Each erp-execution-service instance is already pointed at exactly one
//     bench-agent via BENCH_AGENT_URL (env var). No change needed there.
//     The shard's PROVISIONING_API_URL selects which provisioning-agent (and
//     therefore which erp-execution-service and bench-agent) handles the job.
//
// The ProvisioningAdapter interface is already bench-agnostic; routing is
// entirely in this factory layer. The state machine in runner.ts is unchanged.
// ---------------------------------------------------------------------------

let adapter: ProvisioningAdapter | null = null;

export function getProvisioningAdapter(): ProvisioningAdapter {
  if (!adapter) {
    adapter = new HttpProvisioningAdapter();
    logger.info({ adapter: adapter.kind }, "Provisioning adapter selected");
  }
  return adapter;
}
