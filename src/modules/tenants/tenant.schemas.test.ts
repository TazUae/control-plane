import test from "node:test";
import assert from "node:assert/strict";
import { CreateTenantSchema, GetTenantParamsSchema } from "./tenant.schemas.js";

test("valid tenant provisioning request passes schema", () => {
  const parsed = CreateTenantSchema.safeParse({
    slug: "Tenant-001",
    plan: "pro",
    region: "eu",
  });

  assert.equal(parsed.success, true);
  if (parsed.success) {
    assert.equal(parsed.data.slug, "tenant-001");
  }
});

test("invalid slug/site validation rejects request", () => {
  const parsed = CreateTenantSchema.safeParse({
    slug: "tenant.local",
    plan: "pro",
    region: "eu",
  });
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
