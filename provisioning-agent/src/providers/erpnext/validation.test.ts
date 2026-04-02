import test from "node:test";
import assert from "node:assert/strict";
import { validateDomain, validateSite, validateUsername } from "./validation.js";

test("validateSite accepts conservative site slug", () => {
  assert.equal(validateSite("acme-1"), "acme-1");
});

test("validateSite rejects invalid site values", () => {
  assert.throws(() => validateSite("ACME"), /invalid site format/i);
  assert.throws(() => validateSite("acme.example"), /invalid site format/i);
  assert.throws(() => validateSite("ab"));
  assert.throws(() => validateSite("a".repeat(51)));
});

test("validateDomain accepts valid FQDN", () => {
  assert.equal(validateDomain("acme.erp.local"), "acme.erp.local");
});

test("validateDomain rejects invalid domain", () => {
  assert.throws(() => validateDomain("acme"), /invalid domain format/i);
});

test("validateUsername enforces safe pattern", () => {
  assert.equal(validateUsername("cp_acme"), "cp_acme");
  assert.throws(() => validateUsername("1bad"), /invalid username format/i);
});
