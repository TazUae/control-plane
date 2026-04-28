import test from "node:test";
import assert from "node:assert/strict";
import { ProvisioningError } from "./errors.js";

const timestamp = "2026-04-01T15:00:00.000Z";

async function loadHttpAdapter() {
  process.env.DATABASE_URL ??= "postgresql://postgres:postgres@127.0.0.1:5432/controlplane";
  process.env.REDIS_URL ??= "redis://127.0.0.1:6379";
  process.env.CONTROL_PLANE_API_KEY ??= "test-control-plane-api-key";
  process.env.PROVISIONING_API_URL ??= "https://provisioning.example.com";
  process.env.PROVISIONING_API_TOKEN ??= "token-token-token-token";
  process.env.ERP_BASE_DOMAIN ??= "erp.example.com";
  const module = await import("./http-adapter.js");
  return module.HttpProvisioningAdapter;
}

test("createSite POST body matches agent contract (siteName, domain, apiUsername only)", async () => {
  const HttpProvisioningAdapter = await loadHttpAdapter();
  let postedBody: unknown;
  const adapter = new HttpProvisioningAdapter({
    fetchFn: async (_url, init) => {
      postedBody = init?.body ? JSON.parse(String(init.body)) : undefined;
      return new Response(
        JSON.stringify({
          ok: true,
          data: {
            action: "createSite",
            site: "acme",
            outcome: "applied",
            dbName: "_db",
          },
          timestamp,
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    },
  });

  await adapter.createSite("acme", { requestId: "req-1", tenantId: "tenant-1" });
  assert.deepEqual(postedBody, {
    siteName: "acme",
    domain: "acme.erp.example.com",
    apiUsername: "cp_acme",
  });
});

test("maps structured non-retryable remote failure into ProvisioningError", async () => {
  const HttpProvisioningAdapter = await loadHttpAdapter();
  const adapter = new HttpProvisioningAdapter({
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

test("accepts idempotent already-done success payload", async () => {
  const HttpProvisioningAdapter = await loadHttpAdapter();
  const adapter = new HttpProvisioningAdapter({
    fetchFn: async () =>
      new Response(
        JSON.stringify({
          ok: true,
          data: {
            action: "createSite",
            site: "acme",
            outcome: "already_done",
            alreadyExists: true,
            message: "Site already exists",
          },
          timestamp,
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        }
      ),
  });

  const result = await adapter.createSite("acme");
  assert.equal(result.action, "createSite");
  assert.equal(result.outcome, "already_done");
  assert.equal(result.alreadyExists, true);
});

test("maps dbName from createSite success payload", async () => {
  const HttpProvisioningAdapter = await loadHttpAdapter();
  const adapter = new HttpProvisioningAdapter({
    fetchFn: async () =>
      new Response(
        JSON.stringify({
          ok: true,
          data: {
            action: "createSite",
            site: "acme",
            outcome: "applied",
            dbName: "_652d9db35da0a831",
          },
          timestamp,
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        }
      ),
  });

  const result = await adapter.createSite("acme");
  assert.equal(result.dbName, "_652d9db35da0a831");
});

test("resolveSiteDbName calls read-db-name endpoint", async () => {
  const HttpProvisioningAdapter = await loadHttpAdapter();
  let calledPath = "";
  const adapter = new HttpProvisioningAdapter({
    fetchFn: async (url) => {
      calledPath = new URL(url.toString()).pathname;
      return new Response(
        JSON.stringify({
          ok: true,
          data: {
            action: "readSiteDbName",
            site: "acme",
            outcome: "applied",
            dbName: "_abc123456789abcd",
          },
          timestamp,
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        }
      );
    },
  });

  const result = await adapter.resolveSiteDbName("acme");
  assert.equal(calledPath, "/sites/read-db-name");
  assert.equal(result.dbName, "_abc123456789abcd");
});

test("installFitdesk calls install-fitdesk endpoint", async () => {
  const HttpProvisioningAdapter = await loadHttpAdapter();
  let calledPath = "";
  const adapter = new HttpProvisioningAdapter({
    fetchFn: async (url) => {
      calledPath = new URL(url.toString()).pathname;
      return new Response(
        JSON.stringify({
          ok: true,
          data: {
            action: "installFitdesk",
            site: "acme",
            outcome: "applied",
          },
          timestamp,
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        }
      );
    },
  });

  const result = await adapter.installFitdesk("acme");
  assert.equal(calledPath, "/sites/install-fitdesk");
  assert.equal(result.action, "installFitdesk");
});
