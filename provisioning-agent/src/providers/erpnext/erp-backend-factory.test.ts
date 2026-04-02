import test from "node:test";
import assert from "node:assert/strict";

test("createErpExecutionBackend defaults to DockerExecBackend", async () => {
  process.env.PROVISIONING_API_TOKEN ??= "test-provisioning-token";
  process.env.ERP_ADMIN_PASSWORD ??= "test-admin-password";

  const { createErpExecutionBackend } = await import("./erp-backend-factory.js");
  const backend = createErpExecutionBackend("docker");
  assert.equal(backend.constructor.name, "DockerExecBackend");
});

test("createErpExecutionBackend selects RemoteErpBackend", async () => {
  process.env.PROVISIONING_API_TOKEN ??= "test-provisioning-token";
  process.env.ERP_ADMIN_PASSWORD ??= "test-admin-password";
  const { createErpExecutionBackend } = await import("./erp-backend-factory.js");
  const backend = createErpExecutionBackend("remote");
  assert.equal(backend.constructor.name, "RemoteErpBackend");
});

test("selected backend exposes required typed methods", async () => {
  process.env.PROVISIONING_API_TOKEN ??= "test-provisioning-token";
  process.env.ERP_ADMIN_PASSWORD ??= "test-admin-password";
  const { createErpExecutionBackend } = await import("./erp-backend-factory.js");
  const backend = createErpExecutionBackend("docker");

  assert.equal(typeof backend.createSite, "function");
  assert.equal(typeof backend.installErp, "function");
  assert.equal(typeof backend.enableScheduler, "function");
  assert.equal(typeof backend.addDomain, "function");
  assert.equal(typeof backend.createApiUser, "function");
  assert.equal(typeof backend.healthCheck, "function");
});
