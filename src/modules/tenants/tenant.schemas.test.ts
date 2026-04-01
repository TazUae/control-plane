import test from "node:test";
import assert from "node:assert/strict";
import { CreateTenantSchema } from "./tenant.schemas.js";

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
