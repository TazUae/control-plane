import test from "node:test";
import assert from "node:assert/strict";
import { AgentError } from "../../lib/errors.js";

process.env.PROVISIONING_API_TOKEN = process.env.PROVISIONING_API_TOKEN ?? "test-provisioning-token";
process.env.ERP_ADMIN_PASSWORD = process.env.ERP_ADMIN_PASSWORD ?? "test-admin-password";

test("RemoteErpBackend fails clearly when remote config is missing", async () => {
  const { RemoteErpBackend } = await import("./remote-erp-backend.js");
  assert.throws(
    () => new RemoteErpBackend({ baseUrl: "", token: "" }),
    (error: unknown) => {
      assert.ok(error instanceof AgentError);
      assert.equal(error.code, "INFRA_UNAVAILABLE");
      assert.equal(error.statusCode, 503);
      assert.match(error.details ?? "", /ERP_REMOTE_BASE_URL/);
      assert.match(error.details ?? "", /ERP_REMOTE_TOKEN/);
      return true;
    }
  );
});

test("RemoteErpBackend health check success is typed and mapped", async () => {
  const { RemoteErpBackend } = await import("./remote-erp-backend.js");
  const fetchMock: typeof fetch = async () =>
    new Response(
      JSON.stringify({
        ok: true,
        data: {
          durationMs: 42,
          metadata: { status: "ok" },
        },
      }),
      {
        status: 200,
        headers: { "content-type": "application/json" },
      }
    );

  const backend = new RemoteErpBackend(
    { baseUrl: "http://127.0.0.1:18080", token: "test-remote-token", timeoutMs: 500 },
    fetchMock
  );

  const result = await backend.healthCheck({ deep: true });
  assert.equal(result.durationMs, 42);
  assert.equal(result.metadata?.status, "ok");
});

test("RemoteErpBackend maps already-exists remote failure to SITE_ALREADY_EXISTS", async () => {
  const { RemoteErpBackend } = await import("./remote-erp-backend.js");
  const fetchMock: typeof fetch = async () =>
    new Response(
      JSON.stringify({
        ok: false,
        error: {
          code: "SITE_ALREADY_EXISTS",
          message: "Site already exists",
          retryable: false,
        },
      }),
      { status: 409, headers: { "content-type": "application/json" } }
    );
  const backend = new RemoteErpBackend(
    { baseUrl: "http://127.0.0.1:18080", token: "test-remote-token", timeoutMs: 500 },
    fetchMock
  );
  await assert.rejects(
    async () => backend.createSite({ site: "demo" }),
    (error: unknown) => {
      assert.ok(error instanceof AgentError);
      assert.equal(error.code, "SITE_ALREADY_EXISTS");
      assert.equal(error.statusCode, 409);
      assert.equal(error.retryable, false);
      return true;
    }
  );
});

test("RemoteErpBackend maps transport timeout to ERP_TIMEOUT", async () => {
  const { RemoteErpBackend } = await import("./remote-erp-backend.js");
  const fetchMock: typeof fetch = async () => {
    throw new Error("request timed out");
  };
  const backend = new RemoteErpBackend(
    { baseUrl: "http://127.0.0.1:18080", token: "test-remote-token", timeoutMs: 25 },
    fetchMock
  );

  await assert.rejects(
    async () => backend.healthCheck({}),
    (error: unknown) => {
      assert.ok(error instanceof AgentError);
      assert.equal(error.code, "ERP_TIMEOUT");
      assert.equal(error.statusCode, 504);
      assert.equal(error.retryable, true);
      return true;
    }
  );
});

test("RemoteErpBackend maps remote validation failure to ERP_VALIDATION_FAILED", async () => {
  const { RemoteErpBackend } = await import("./remote-erp-backend.js");
  const fetchMock: typeof fetch = async () =>
    new Response(
      JSON.stringify({
        ok: false,
        error: {
          code: "ERP_VALIDATION_FAILED",
          message: "Invalid site value",
          retryable: false,
          details: "site must match required format",
        },
      }),
      { status: 422, headers: { "content-type": "application/json" } }
    );
  const backend = new RemoteErpBackend(
    { baseUrl: "http://127.0.0.1:18080", token: "test-remote-token", timeoutMs: 500 },
    fetchMock
  );

  await assert.rejects(
    async () => backend.createSite({ site: "bad.site" }),
    (error: unknown) => {
      assert.ok(error instanceof AgentError);
      assert.equal(error.code, "ERP_VALIDATION_FAILED");
      assert.equal(error.statusCode, 422);
      assert.equal(error.retryable, false);
      return true;
    }
  );
});
