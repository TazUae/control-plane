import test from "node:test";
import assert from "node:assert/strict";
import type { ErpExecutionBackend } from "../providers/erpnext/erp-execution-backend.js";

function stubBackend(overrides: Partial<ErpExecutionBackend>): ErpExecutionBackend {
  const base: ErpExecutionBackend = {
    createSite: async () => ({ stdout: "", stderr: "", durationMs: 0 }),
    installErp: async () => ({ stdout: "", stderr: "", durationMs: 0 }),
    enableScheduler: async () => ({ stdout: "", stderr: "", durationMs: 0 }),
    addDomain: async () => ({ stdout: "", stderr: "", durationMs: 0 }),
    createApiUser: async () => ({ stdout: "", stderr: "", durationMs: 0 }),
  };
  return { ...base, ...overrides };
}

test("passes backend success through service and executor", async () => {
  process.env.PROVISIONING_API_TOKEN ??= "test-provisioning-token";
  process.env.ERP_ADMIN_PASSWORD ??= "test-admin-password";
  process.env.ERP_BASE_DOMAIN ??= "erp.test";
  process.env.ERP_API_USERNAME_PREFIX ??= "cp";

  const { ProvisioningService } = await import("./provisioning-service.js");

  const service = new ProvisioningService(
    stubBackend({
      createSite: async () => ({ stdout: "done", stderr: "", durationMs: 12 }),
    })
  );

  const result = await service.run("createSite", "acme");
  assert.equal(result.outcome, "applied");
  assert.equal(result.site, "acme");
  assert.equal(result.durationMs, 12);
});
