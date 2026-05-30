import test, { after } from "node:test";
import assert from "node:assert/strict";

// H4 — prove the security middleware is actually applied on Fastify v4:
//   * app boots with @fastify/helmet (11.x) + @fastify/rate-limit (9.x) [a v5 plugin
//     would throw at ready()]
//   * helmet sets security response headers
//   * the rate limiter returns 429 once the limit is exceeded
//   * the app-level bodyLimit rejects oversized payloads (413)
//
// /health is stubbed (no real DB/Redis) so the request loop is fast. RATE_LIMIT_MAX is
// small; the body + boot probes (2 requests) stay under it, and the rate-limit test runs
// last so its 429s don't bleed into the others.

type App = {
  inject: (o: unknown) => Promise<{ statusCode: number; headers: Record<string, unknown> }>;
  post: (path: string, handler: () => Promise<unknown>) => void;
  ready: () => Promise<void>;
  close: () => Promise<void>;
};
let cached: Promise<App> | null = null;

function loadApp(): Promise<App> {
  if (cached) return cached;
  cached = (async () => {
    process.env.DATABASE_URL ??= "postgresql://postgres:postgres@127.0.0.1:5432/controlplane";
    process.env.REDIS_URL ??= "redis://127.0.0.1:6379";
    process.env.CONTROL_PLANE_API_KEY ??= "control-plane-api-key-test-0001";
    process.env.PROVISIONING_API_URL ??= "https://provisioning.example.com";
    process.env.PROVISIONING_API_TOKEN ??= "token-token-token-token";
    process.env.ERP_BASE_DOMAIN ??= "erp.example.com";
    process.env.RATE_LIMIT_MAX = "3";
    process.env.RATE_LIMIT_TIME_WINDOW = "1 minute";
    process.env.BODY_LIMIT_BYTES = "100";

    const { app } = (await import("./app.js")) as unknown as { app: App };

    // Fast, deterministic /health (no real DB/Redis) so the rate-limit loop is cheap.
    const { prisma } = (await import("./lib/prisma.js")) as unknown as { prisma: Record<string, unknown> };
    Object.defineProperty(prisma, "$queryRaw", { value: async () => [{ ok: 1 }], configurable: true, writable: true });
    const { redis } = (await import("./lib/redis.js")) as unknown as {
      redis: Record<string, unknown> & { on: (e: string, c: () => void) => void; disconnect: () => void };
    };
    redis.on("error", () => {});
    Object.defineProperty(redis, "ping", { value: async () => "PONG", configurable: true, writable: true });
    redis.disconnect(); // stop reconnect loop so the test process exits

    // Throwaway route (registered before ready) to exercise the app-level bodyLimit.
    app.post("/__sec_bodytest", async () => ({ ok: true }));
    await app.ready(); // throws if a plugin is Fastify-version-incompatible
    return app;
  })();
  return cached;
}

after(async () => { if (cached) { const a = await cached; await a.close(); } });

test("app boots with helmet + rate-limit and sets security headers", async () => {
  const app = await loadApp();
  const res = await app.inject({ method: "GET", url: "/health" });
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers["x-content-type-options"], "nosniff", "expected @fastify/helmet to set X-Content-Type-Options");
});

test("body-limit rejects oversized payloads with 413", async () => {
  const app = await loadApp();
  const big = JSON.stringify({ data: "x".repeat(500) }); // well over BODY_LIMIT_BYTES=100
  const res = await app.inject({
    method: "POST",
    url: "/__sec_bodytest",
    headers: { "content-type": "application/json" },
    payload: big,
  });
  assert.equal(res.statusCode, 413, "payload exceeding BODY_LIMIT_BYTES must be rejected with 413");
});

test("rate limiter returns 429 once the limit is exceeded", async () => {
  const app = await loadApp();
  let limited = 0;
  for (let i = 0; i < 10; i++) {
    const r = await app.inject({ method: "GET", url: "/health" });
    if (r.statusCode === 429) limited += 1;
  }
  assert.ok(limited > 0, "expected @fastify/rate-limit to return 429 once RATE_LIMIT_MAX is exceeded");
});
