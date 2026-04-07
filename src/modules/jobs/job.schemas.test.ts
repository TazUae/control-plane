import test from "node:test";
import assert from "node:assert/strict";
import { GetJobParamsSchema } from "./job.schemas.js";

test("GET /jobs/:id params accept valid uuid", () => {
  const id = "550e8400-e29b-41d4-a716-446655440000";
  const parsed = GetJobParamsSchema.safeParse({ id });
  assert.equal(parsed.success, true);
  if (parsed.success) {
    assert.equal(parsed.data.id, id);
  }
});

test("GET /jobs/:id params reject invalid id", () => {
  const parsed = GetJobParamsSchema.safeParse({ id: "not-a-uuid" });
  assert.equal(parsed.success, false);
});
