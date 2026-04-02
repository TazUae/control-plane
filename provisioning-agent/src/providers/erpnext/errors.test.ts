import test from "node:test";
import assert from "node:assert/strict";
import { AgentError } from "../../lib/errors.js";
import { mapBackendFailure } from "./errors.js";

test("mapBackendFailure maps already-exists output", () => {
  const err = new AgentError("ERP_COMMAND_FAILED", "failed", {
    stderr: "Site already exists",
    statusCode: 400,
  });
  const mapped = mapBackendFailure(err, "Provisioning command failed");
  assert.equal(mapped.code, "SITE_ALREADY_EXISTS");
  assert.equal(mapped.retryable, false);
});

test("mapBackendFailure preserves timeout mapping", () => {
  const err = new AgentError("ERP_TIMEOUT", "timed out", { statusCode: 504 });
  const mapped = mapBackendFailure(err, "Provisioning command failed");
  assert.equal(mapped.code, "ERP_TIMEOUT");
});

test("mapBackendFailure maps ENOENT to INFRA_UNAVAILABLE", () => {
  const nativeErr = Object.assign(new Error("spawn docker ENOENT"), { code: "ENOENT" });
  const mapped = mapBackendFailure(nativeErr, "Provisioning command failed");
  assert.equal(mapped.code, "INFRA_UNAVAILABLE");
  assert.equal(mapped.retryable, true);
});
