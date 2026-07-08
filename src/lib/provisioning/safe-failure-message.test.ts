import test from "node:test";
import assert from "node:assert/strict";
import {
  getSafePublicFailureMessage,
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
