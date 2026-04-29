import test from "node:test";
import assert from "node:assert/strict";
import { CreateTenantSchema, GetTenantParamsSchema } from "./tenant.schemas.js";

const VALID_BASE = {
  slug: "Tenant-001",
  plan: "pro",
  region: "eu",
  country: "AE",
  companyName: "Test Gym LLC",
  companyAbbr: "TG",
};

test("valid tenant provisioning request passes schema", () => {
  const parsed = CreateTenantSchema.safeParse(VALID_BASE);

  assert.equal(parsed.success, true);
  if (parsed.success) {
    assert.equal(parsed.data.slug, "tenant-001");
    assert.equal(parsed.data.country, "AE");
    assert.equal(parsed.data.companyName, "Test Gym LLC");
  }
});

test("country is uppercased", () => {
  const parsed = CreateTenantSchema.safeParse({ ...VALID_BASE, country: "ae" });
  assert.equal(parsed.success, true);
  if (parsed.success) assert.equal(parsed.data.country, "AE");
});

test("rejects missing country", () => {
  const { country: _c, ...rest } = VALID_BASE;
  const parsed = CreateTenantSchema.safeParse(rest);
  assert.equal(parsed.success, false);
});

test("rejects missing companyName", () => {
  const { companyName: _n, ...rest } = VALID_BASE;
  const parsed = CreateTenantSchema.safeParse(rest);
  assert.equal(parsed.success, false);
});

test("rejects missing companyAbbr", () => {
  const { companyAbbr: _a, ...rest } = VALID_BASE;
  const parsed = CreateTenantSchema.safeParse(rest);
  assert.equal(parsed.success, false);
});

test("rejects country with more than 2 chars", () => {
  const parsed = CreateTenantSchema.safeParse({ ...VALID_BASE, country: "UAE" });
  assert.equal(parsed.success, false);
});

test("optional currency override is accepted and uppercased", () => {
  const parsed = CreateTenantSchema.safeParse({ ...VALID_BASE, defaultCurrency: "usd" });
  assert.equal(parsed.success, true);
  if (parsed.success) assert.equal(parsed.data.defaultCurrency, "USD");
});

test("invalid slug/site validation rejects request", () => {
  const parsed = CreateTenantSchema.safeParse({ ...VALID_BASE, slug: "tenant.local" });
  assert.equal(parsed.success, false);
});

test("GET /tenants/:id params accept valid uuid", () => {
  const id = "550e8400-e29b-41d4-a716-446655440000";
  const parsed = GetTenantParamsSchema.safeParse({ id });
  assert.equal(parsed.success, true);
  if (parsed.success) {
    assert.equal(parsed.data.id, id);
  }
});

test("GET /tenants/:id params reject invalid id", () => {
  const parsed = GetTenantParamsSchema.safeParse({ id: "not-a-uuid" });
  assert.equal(parsed.success, false);
});
