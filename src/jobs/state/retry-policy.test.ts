import test from "node:test";
import assert from "node:assert/strict";
import { shouldRetryProvisioningError } from "./retry-policy.js";
import { ProvisioningError } from "../../lib/provisioning/errors.js";

test("retryable infra failure classification", () => {
  const err = new ProvisioningError("INFRA_UNAVAILABLE", "docker unavailable");
  assert.equal(shouldRetryProvisioningError(err), true);
});

test("retryable timeout failure classification", () => {
  const err = new ProvisioningError("ERP_TIMEOUT", "timed out");
  assert.equal(shouldRetryProvisioningError(err), true);
});

test("non-retryable validation failure classification", () => {
  const err = new ProvisioningError("ERP_VALIDATION_FAILED", "invalid slug", { retryable: false });
  assert.equal(shouldRetryProvisioningError(err), false);
});

test("site already exists is non-retryable", () => {
  const err = new ProvisioningError("SITE_ALREADY_EXISTS", "already exists", { retryable: false });
  assert.equal(shouldRetryProvisioningError(err), false);
});
