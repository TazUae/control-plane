import test from "node:test";
import assert from "node:assert/strict";
import { assertValidSlugOrSite, normalizeSlug } from "./validation.js";

test("normalizeSlug trims and lowercases", () => {
  assert.equal(normalizeSlug("  Tenant-A "), "tenant-a");
});

test("assertValidSlugOrSite accepts conservative slug format", () => {
  assert.doesNotThrow(() => assertValidSlugOrSite("tenant-123", "slug"));
});

test("assertValidSlugOrSite rejects dots and invalid chars", () => {
  assert.throws(() => assertValidSlugOrSite("tenant.local", "slug"));
  assert.throws(() => assertValidSlugOrSite("tenant_A", "slug"));
});
