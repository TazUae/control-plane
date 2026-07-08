import test from "node:test";
import assert from "node:assert/strict";
import {
  getSafePublicFailureMessage,
  getStatusAwarePublicFailureMessage,
  SAFE_TRANSIENT_DB_MESSAGE,
  SAFE_UNKNOWN_FAILURE_MESSAGE,
} from "./safe-failure-message.js";

test("returns null when there is no failure reason", () => {
  assert.equal(getSafePublicFailureMessage(null), null);
  assert.equal(getSafePublicFailureMessage(undefined), null);
  assert.equal(getSafePublicFailureMessage(""), null);
});

test("maps MariaDB 1412 stderr to the safe transient message", () => {
  const raw =
    "pymysql.err.OperationalError: (1412, 'Table definition has changed, please retry transaction')";
  assert.equal(getSafePublicFailureMessage(raw), SAFE_TRANSIENT_DB_MESSAGE);
});

test("maps MariaDB 1205/1213 stderr to the safe transient message", () => {
  assert.equal(
    getSafePublicFailureMessage("(1205, 'Lock wait timeout exceeded; try restarting transaction')"),
    SAFE_TRANSIENT_DB_MESSAGE
  );
  assert.equal(
    getSafePublicFailureMessage("errno 1213 Deadlock found when trying to get lock"),
    SAFE_TRANSIENT_DB_MESSAGE
  );
});

test("maps an unrelated internal failure to the safe unknown message, never the raw text", () => {
  const raw =
    "Traceback (most recent call last):\n  File \"/home/frappe/frappe-bench/apps/erpnext/setup.py\", line 42\nModuleNotFoundError: No module named 'erpnext'\ndb_password=super-secret-value";
  const result = getSafePublicFailureMessage(raw);
  assert.equal(result, SAFE_UNKNOWN_FAILURE_MESSAGE);
  assert.doesNotMatch(result ?? "", /Traceback|frappe-bench|ModuleNotFoundError|super-secret-value/);
});

test("a bare number like account_count=1412 does not trigger the transient message", () => {
  assert.equal(
    getSafePublicFailureMessage("company=Acme account_count=1412"),
    SAFE_UNKNOWN_FAILURE_MESSAGE
  );
});

test("output is always exactly one of the two safe sentences, regardless of raw content", () => {
  const samples = [
    "stack trace with /etc/passwd and internal IP 10.0.0.5",
    "HTTP 500: <html>Internal Server Error</html>",
    "site_config.json db_password=hunter2",
    "(1412, 'Table definition has changed, please retry transaction')",
  ];
  for (const raw of samples) {
    const result = getSafePublicFailureMessage(raw);
    assert.ok(result === SAFE_TRANSIENT_DB_MESSAGE || result === SAFE_UNKNOWN_FAILURE_MESSAGE);
    assert.notEqual(result, raw);
  }
});

// --- getStatusAwarePublicFailureMessage -----------------------------------

test("running status with a transient signature says 'Retrying safely'", () => {
  const raw = "(1412, 'Table definition has changed, please retry transaction')";
  assert.equal(getStatusAwarePublicFailureMessage("running", raw), SAFE_TRANSIENT_DB_MESSAGE);
});

test("queued/enqueue_failed (non-terminal) with a transient signature also says 'Retrying safely'", () => {
  const raw = "errno 1205 Lock wait timeout exceeded";
  assert.equal(getStatusAwarePublicFailureMessage("queued", raw), SAFE_TRANSIENT_DB_MESSAGE);
  assert.equal(getStatusAwarePublicFailureMessage("enqueue_failed", raw), SAFE_TRANSIENT_DB_MESSAGE);
});

test("terminal failed status always says contact-support, even with a transient-looking reason", () => {
  // Retries are exhausted once the job is terminally failed, so even a 1412-style
  // reason must NOT read as "still retrying" — this is the key status-aware case.
  const raw = "(1412, 'Table definition has changed, please retry transaction')";
  const message = getStatusAwarePublicFailureMessage("failed", raw);
  assert.equal(message, SAFE_UNKNOWN_FAILURE_MESSAGE);
  assert.notEqual(message, SAFE_TRANSIENT_DB_MESSAGE);
});

test("terminal failed status with a non-transient reason says contact-support", () => {
  const raw = "ModuleNotFoundError: No module named 'erpnext'";
  assert.equal(getStatusAwarePublicFailureMessage("failed", raw), SAFE_UNKNOWN_FAILURE_MESSAGE);
});

test("no stored reason yields null regardless of status", () => {
  assert.equal(getStatusAwarePublicFailureMessage("running", null), null);
  assert.equal(getStatusAwarePublicFailureMessage("failed", null), null);
  assert.equal(getStatusAwarePublicFailureMessage("completed", null), null);
});
