import test from "node:test";
import assert from "node:assert/strict";

async function loadDetectIdempotentOutcome() {
  process.env.PROVISIONING_API_TOKEN ??= "test-provisioning-token";
  process.env.ERP_ADMIN_PASSWORD ??= "test-admin-password";
  const module = await import("./executor.js");
  return module.detectIdempotentOutcome;
}

test("detectIdempotentOutcome recognizes already existing site", async () => {
  const detectIdempotentOutcome = await loadDetectIdempotentOutcome();
  const result = detectIdempotentOutcome("createSite", "", "Site already exists");
  assert.equal(result?.outcome, "already_done");
  assert.equal(result?.alreadyExists, true);
});

test("detectIdempotentOutcome recognizes already installed app", async () => {
  const detectIdempotentOutcome = await loadDetectIdempotentOutcome();
  const result = detectIdempotentOutcome("installErp", "App is installed", "");
  assert.equal(result?.outcome, "already_done");
  assert.equal(result?.alreadyInstalled, true);
});

test("detectIdempotentOutcome recognizes scheduler already enabled", async () => {
  const detectIdempotentOutcome = await loadDetectIdempotentOutcome();
  const result = detectIdempotentOutcome("enableScheduler", "", "Scheduler is already enabled");
  assert.equal(result?.alreadyConfigured, true);
});

test("detectIdempotentOutcome recognizes duplicate domain", async () => {
  const detectIdempotentOutcome = await loadDetectIdempotentOutcome();
  const result = detectIdempotentOutcome("addDomain", "", "Duplicate entry");
  assert.equal(result?.alreadyConfigured, true);
});

test("detectIdempotentOutcome returns null for non-idempotent output", async () => {
  const detectIdempotentOutcome = await loadDetectIdempotentOutcome();
  const result = detectIdempotentOutcome("createApiUser", "failed", "permission denied");
  assert.equal(result, null);
});
