import test from "node:test";
import assert from "node:assert/strict";

process.env.PROVISIONING_API_TOKEN = process.env.PROVISIONING_API_TOKEN ?? "test-provisioning-token";
process.env.ERP_ADMIN_PASSWORD = process.env.ERP_ADMIN_PASSWORD ?? "test-admin-password";
process.env.ERP_REMOTE_BASE_URL = process.env.ERP_REMOTE_BASE_URL ?? "http://127.0.0.1:18080";
process.env.ERP_REMOTE_TOKEN = process.env.ERP_REMOTE_TOKEN ?? "test-remote-token";

test("createErpExecutionBackend defaults to DockerExecBackend", async () => {
  const { createErpExecutionBackend } = await import("./erp-backend-factory.js");
  const backend = createErpExecutionBackend("docker");
  assert.equal(backend.constructor.name, "DockerExecBackend");
});

test("createErpExecutionBackend selects RemoteErpBackend", async () => {
  const { createErpExecutionBackend } = await import("./erp-backend-factory.js");
  const backend = createErpExecutionBackend("remote");
  assert.equal(backend.constructor.name, "RemoteErpBackend");
});

test("selected backend exposes required typed methods", async () => {
  const { createErpExecutionBackend } = await import("./erp-backend-factory.js");
  const backend = createErpExecutionBackend("docker");

  assert.equal(typeof backend.createSite, "function");
  assert.equal(typeof backend.installErp, "function");
  assert.equal(typeof backend.enableScheduler, "function");
  assert.equal(typeof backend.addDomain, "function");
  assert.equal(typeof backend.createApiUser, "function");
  assert.equal(typeof backend.healthCheck, "function");
});
