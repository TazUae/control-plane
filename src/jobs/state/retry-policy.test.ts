import test from "node:test";
import assert from "node:assert/strict";
import {
  shouldRetryProvisioningError,
  isTransientProvisioningError,
  computeBackoffMs,
} from "./retry-policy.js";
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

test("MariaDB 1412 in stderr is retryable even when the envelope says non-retryable", () => {
  const err = new ProvisioningError("ERP_COMMAND_FAILED", "bench command failed", {
    retryable: false,
    stderr: "pymysql.err.OperationalError: (1412, 'Table definition has changed, please retry transaction')",
  });
  assert.equal(isTransientProvisioningError(err), true);
  assert.equal(shouldRetryProvisioningError(err), true);
});

test("lock-wait and deadlock signatures are transient", () => {
  const lockWait = new ProvisioningError("ERP_COMMAND_FAILED", "x", {
    retryable: false,
    stderr: "(1205, 'Lock wait timeout exceeded; try restarting transaction')",
  });
  const deadlock = new ProvisioningError("ERP_COMMAND_FAILED", "x", {
    retryable: false,
    details: "errno 1213 Deadlock found when trying to get lock",
  });
  assert.equal(shouldRetryProvisioningError(lockWait), true);
  assert.equal(shouldRetryProvisioningError(deadlock), true);
});

test("an ordinary command failure is not treated as transient", () => {
  const err = new ProvisioningError("ERP_COMMAND_FAILED", "install failed", {
    retryable: false,
    stderr: "ModuleNotFoundError: No module named 'erpnext'",
  });
  assert.equal(isTransientProvisioningError(err), false);
  assert.equal(shouldRetryProvisioningError(err), false);
});

test("a bare number like account_count=1412 is not a false positive", () => {
  const err = new ProvisioningError("ERP_COMMAND_FAILED", "x", {
    retryable: false,
    stdout: "company=Acme account_count=1412",
  });
  assert.equal(isTransientProvisioningError(err), false);
});

test("computeBackoffMs without jitter is deterministic exponential, capped", () => {
  assert.equal(computeBackoffMs(1, { jitter: false, baseMs: 3000, factor: 2, capMs: 30000 }), 3000);
  assert.equal(computeBackoffMs(2, { jitter: false, baseMs: 3000, factor: 2, capMs: 30000 }), 6000);
  assert.equal(computeBackoffMs(3, { jitter: false, baseMs: 3000, factor: 2, capMs: 30000 }), 12000);
  assert.equal(computeBackoffMs(10, { jitter: false, baseMs: 3000, factor: 2, capMs: 30000 }), 30000);
});

test("computeBackoffMs with jitter stays within [exp/2, exp]", () => {
  const lo = computeBackoffMs(2, { baseMs: 3000, factor: 2, capMs: 30000, random: () => 0 });
  const hi = computeBackoffMs(2, { baseMs: 3000, factor: 2, capMs: 30000, random: () => 1 });
  assert.equal(lo, 3000);
  assert.equal(hi, 6000);
});
