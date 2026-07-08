import { ProvisioningError } from "../../lib/provisioning/errors.js";
import type { ProvisioningAdapter, ProvisioningCallContext } from "../../lib/provisioning/interface.js";

export type ReadinessGateOptions = {
  enabled: boolean;
  settleMs: number;
  /** Injectable seams for tests. */
  sleep?: (ms: number) => Promise<void>;
  onWait?: (reason: string | undefined) => void;
};

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Gate `erp_installed` on a real readiness verdict. Probes the site; if not
 * ready, waits `settleMs` once and re-checks. If still not ready, throws a
 * retryable ERP_TIMEOUT so the step-retry loop tries again — installing ERPNext
 * against a freshly-created, unsettled schema is what provokes MariaDB 1412.
 *
 * No-ops when the gate is disabled or the adapter has no readiness probe, so
 * older adapters and the runner's existing tests are unaffected.
 */
export async function ensureSiteReady(
  adapter: Pick<ProvisioningAdapter, "siteReadiness">,
  site: string,
  ctx: ProvisioningCallContext | undefined,
  options: ReadinessGateOptions
): Promise<void> {
  if (!options.enabled || !adapter.siteReadiness) return;
  const sleep = options.sleep ?? defaultSleep;

  let verdict = await adapter.siteReadiness(site, ctx);
  if (verdict.ready) return;

  options.onWait?.(verdict.reason);
  await sleep(options.settleMs);

  verdict = await adapter.siteReadiness(site, ctx);
  if (verdict.ready) return;

  throw new ProvisioningError("ERP_TIMEOUT", "Site not ready for ERP install", {
    retryable: true,
    details: `readiness reason=${verdict.reason ?? "unknown"}`,
  });
}
