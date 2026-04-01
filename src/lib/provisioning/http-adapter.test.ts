import test from "node:test";
import assert from "node:assert/strict";
import { ProvisioningError } from "./errors.js";

const timestamp = "2026-04-01T15:00:00.000Z";

async function loadHttpAdapter() {
  process.env.DATABASE_URL ??= "postgresql://postgres:postgres@127.0.0.1:5432/controlplane";
  process.env.REDIS_URL ??= "redis://127.0.0.1:6379";
  process.env.CONTROL_PLANE_API_KEY ??= "test-control-plane-api-key";
  process.env.ERP_ADMIN_PASSWORD ??= "test-admin-password";
  const module = await import("./http-adapter.js");
  return module.HttpProvisioningAdapter;
}

test("maps structured non-retryable remote failure into ProvisioningError", async () => {
  const HttpProvisioningAdapter = await loadHttpAdapter();
  const adapter = new HttpProvisioningAdapter({
    baseUrl: "https://provisioning.example.com",
    token: "token-token-token-token",
    fetchFn: async () =>
      new Response(
        JSON.stringify({
          ok: false,
          error: {
            code: "SITE_ALREADY_EXISTS",
            message: "Site already exists",
            retryable: false,
          },
          timestamp,
        }),
        {
          status: 409,
          headers: { "content-type": "application/json" },
        }
      ),
  });

  await assert.rejects(
    async () => adapter.createSite("acme"),
    (error: unknown) => {
      assert.ok(error instanceof ProvisioningError);
      assert.equal(error.code, "SITE_ALREADY_EXISTS");
      assert.equal(error.retryable, false);
      return true;
    }
  );
});

test("maps structured retryable remote failure into ProvisioningError", async () => {
  const HttpProvisioningAdapter = await loadHttpAdapter();
  const adapter = new HttpProvisioningAdapter({
    baseUrl: "https://provisioning.example.com",
    token: "token-token-token-token",
    fetchFn: async () =>
      new Response(
        JSON.stringify({
          ok: false,
          error: {
            code: "INFRA_UNAVAILABLE",
            message: "Upstream unavailable",
            retryable: true,
          },
          timestamp,
        }),
        {
          status: 503,
          headers: { "content-type": "application/json" },
        }
      ),
  });

  await assert.rejects(
    async () => adapter.installErp("acme"),
    (error: unknown) => {
      assert.ok(error instanceof ProvisioningError);
      assert.equal(error.code, "INFRA_UNAVAILABLE");
      assert.equal(error.retryable, true);
      return true;
    }
  );
});

test("maps unstructured 5xx responses to INFRA_UNAVAILABLE", async () => {
  const HttpProvisioningAdapter = await loadHttpAdapter();
  const adapter = new HttpProvisioningAdapter({
    baseUrl: "https://provisioning.example.com",
    token: "token-token-token-token",
    fetchFn: async () => new Response("upstream crashed", { status: 503 }),
  });

  await assert.rejects(
    async () => adapter.enableScheduler("acme"),
    (error: unknown) => {
      assert.ok(error instanceof ProvisioningError);
      assert.equal(error.code, "INFRA_UNAVAILABLE");
      assert.equal(error.retryable, true);
      return true;
    }
  );
});

test("maps aborted request to ERP_TIMEOUT", async () => {
  const HttpProvisioningAdapter = await loadHttpAdapter();
  const adapter = new HttpProvisioningAdapter({
    baseUrl: "https://provisioning.example.com",
    token: "token-token-token-token",
    timeoutMs: 20,
    fetchFn: async (_url, init) =>
      await new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        signal?.addEventListener("abort", () => {
          const error = new Error("aborted");
          (error as Error & { name?: string }).name = "AbortError";
          reject(error);
        });
      }),
  });

  await assert.rejects(
    async () => adapter.addDomain("acme"),
    (error: unknown) => {
      assert.ok(error instanceof ProvisioningError);
      assert.equal(error.code, "ERP_TIMEOUT");
      assert.equal(error.retryable, true);
      return true;
    }
  );
});
