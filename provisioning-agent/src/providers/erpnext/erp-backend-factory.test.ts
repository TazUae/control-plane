import test from "node:test";
import assert from "node:assert/strict";

test("createErpExecutionBackend returns a backend with all required methods", async () => {
  process.env.PROVISIONING_API_TOKEN ??= "test-provisioning-token";
  process.env.ERP_ADMIN_PASSWORD ??= "test-admin-password";

  const { createErpExecutionBackend } = await import("./erp-backend-factory.js");
  const backend = createErpExecutionBackend();

  assert.equal(typeof backend.createSite, "function");
  assert.equal(typeof backend.installErp, "function");
  assert.equal(typeof backend.enableScheduler, "function");
  assert.equal(typeof backend.addDomain, "function");
  assert.equal(typeof backend.createApiUser, "function");
});
