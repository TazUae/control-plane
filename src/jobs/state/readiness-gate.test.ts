import test from "node:test";
import assert from "node:assert/strict";
import { ensureSiteReady } from "./readiness-gate.js";
import { ProvisioningError, isProvisioningError } from "../../lib/provisioning/errors.js";
import type { SiteReadinessResult } from "../../lib/provisioning/interface.js";

function adapterReturning(...verdicts: SiteReadinessResult[]) {
  const calls: string[] = [];
  return {
    calls,
    siteReadiness: async (site: string): Promise<SiteReadinessResult> => {
      calls.push(site);
      return verdicts[Math.min(calls.length - 1, verdicts.length - 1)];
    },
  };
}

const noSleep = async () => {};

test("passes immediately when the site is ready on the first check", async () => {
  const adapter = adapterReturning({ ready: true });
  await ensureSiteReady(adapter, "acme", undefined, {
    enabled: true,
    settleMs: 5000,
    sleep: noSleep,
  });
  assert.equal(adapter.calls.length, 1);
});

test("waits once and passes when the site becomes ready on re-check", async () => {
  const adapter = adapterReturning({ ready: false, reason: "missing_core_doctypes" }, { ready: true });
  let waited: string | undefined = "not-called";
  await ensureSiteReady(adapter, "acme", undefined, {
    enabled: true,
    settleMs: 5000,
    sleep: noSleep,
    onWait: (reason) => {
      waited = reason;
    },
  });
  assert.equal(adapter.calls.length, 2);
  assert.equal(waited, "missing_core_doctypes");
});

test("throws a retryable ERP_TIMEOUT when still not ready after re-check", async () => {
  const adapter = adapterReturning({ ready: false, reason: "list_apps_failed" });
  await assert.rejects(
    ensureSiteReady(adapter, "acme", undefined, { enabled: true, settleMs: 5000, sleep: noSleep }),
    (err: unknown) => {
      assert.ok(isProvisioningError(err));
      assert.equal((err as ProvisioningError).code, "ERP_TIMEOUT");
      assert.equal((err as ProvisioningError).retryable, true);
      return true;
    }
  );
  assert.equal(adapter.calls.length, 2);
});

test("no-ops when the gate is disabled", async () => {
  const adapter = adapterReturning({ ready: false });
  await ensureSiteReady(adapter, "acme", undefined, { enabled: false, settleMs: 5000, sleep: noSleep });
  assert.equal(adapter.calls.length, 0);
});

test("no-ops when the adapter has no readiness probe", async () => {
  await ensureSiteReady({}, "acme", undefined, { enabled: true, settleMs: 5000, sleep: noSleep });
  // Reaching here without throwing is the assertion.
  assert.ok(true);
});
