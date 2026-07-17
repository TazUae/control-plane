import test, { after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { SignJWT } from "jose";

// ---------------------------------------------------------------------------
// M1 — ERP proxy hardening: forwardToFrappe must (a) abort a hanging upstream via
// its request timeout (never hang indefinitely) and (b) reject an oversized
// upstream response. Both surface as 502 to the caller.
//
// A controllable fake Frappe upstream is pointed at via ERP_FRAPPE_BASE_URL
// (an existing, already-optional config knob used only to redirect proxy
// traffic in tests/dev). The timeout (15_000ms) and response-size cap
// (5_000_000 bytes) are the real production hardcoded constants in
// erp-proxy.routes.ts — this suite does not shrink them via env, so the
// hang-abort test genuinely waits out the real timeout window.
// ---------------------------------------------------------------------------

const JWT_SECRET = "fitdesk-jwt-secret-at-least-32-chars-long-0001";

let mode: "hang" | "flood" = "hang";
const upstream = http.createServer((req, res) => {
  req.on("error", () => {});
  res.on("error", () => {});
  if (mode === "hang") return; // never respond → exercises the request timeout
  // Exceed the real 5_000_000-byte cap; leave the response unfinished so the
  // proxy's size-cap check (not a normal end-of-stream) is what aborts it.
  res.writeHead(200, { "content-type": "application/json" });
  res.write(Buffer.alloc(6_000_000, "x"));
});
upstream.on("clientError", () => {});

const upstreamUrl = new Promise<string>((resolve) => {
  upstream.listen(0, "127.0.0.1", () => {
    const addr = upstream.address() as { port: number };
    resolve(`http://127.0.0.1:${addr.port}`);
  });
});

type App = { inject: (o: unknown) => Promise<{ statusCode: number }>; ready: () => Promise<void>; close: () => Promise<void> };
let cached: Promise<App> | null = null;

function loadApp(baseUrl: string): Promise<App> {
  if (cached) return cached;
  cached = (async () => {
    process.env.DATABASE_URL ??= "postgresql://postgres:postgres@127.0.0.1:5432/controlplane";
    process.env.REDIS_URL ??= "redis://127.0.0.1:6379";
    process.env.CONTROL_PLANE_API_KEY ??= "control-plane-api-key-test-0001";
    process.env.PROVISIONING_API_URL ??= "https://provisioning.example.com";
    process.env.PROVISIONING_API_TOKEN ??= "token-token-token-token";
    process.env.ERP_BASE_DOMAIN ??= "erp.example.com";
    process.env.FITDESK_JWT_SECRET = JWT_SECRET;
    process.env.ERP_FRAPPE_BASE_URL = baseUrl;

    const { app } = (await import("../../app.js")) as unknown as { app: App };
    try {
      const { redis } = (await import("../../lib/redis.js")) as unknown as {
        redis: { on: (e: string, c: () => void) => void; disconnect: () => void };
      };
      redis.on("error", () => {});
      redis.disconnect();
    } catch { /* ignore */ }

    const { prisma } = (await import("../../lib/prisma.js")) as unknown as { prisma: Record<string, unknown> };
    Object.defineProperty(prisma, "tenant", {
      value: {
        findUnique: async () => ({
          id: "t1", slug: "acme", status: "active",
          erpSite: "acme", erpApiKey: "k", erpApiSecret: "s",
          companyName: "Acme", defaultCurrency: "USD",
        }),
      },
      configurable: true,
      writable: true,
    });

    await import("./erp-proxy.routes.js");
    await app.ready();
    return app;
  })();
  return cached;
}

function mintToken(): Promise<string> {
  return new SignJWT({ tenantId: "t1" })
    .setProtectedHeader({ alg: "HS256" })
    .sign(new TextEncoder().encode(JWT_SECRET));
}

after(async () => {
  if (cached) { const a = await cached; await a.close(); }
  await new Promise<void>((r) => upstream.close(() => r()));
});

test(
  "ERP proxy: hanging upstream is aborted by the request timeout (no indefinite hang) [M1]",
  { timeout: 45_000 },
  async () => {
    const base = await upstreamUrl;
    const app = await loadApp(base);
    mode = "hang";
    const token = await mintToken();
    const t0 = Date.now();
    const res = await app.inject({
      method: "GET",
      url: "/api/erp/doctype/Item",
      headers: { authorization: `Bearer ${token}` },
    });
    const elapsed = Date.now() - t0;
    assert.equal(res.statusCode, 502, "a hanging upstream must surface as a 502, not hang");
    // The real production timeout is 15_000ms (unchanged by this test); allow a
    // small floor tolerance for timer scheduling jitter, and an upper bound well
    // under the test's own guard so a regression back to "never aborts" fails via
    // this assertion rather than only via the outer test timeout.
    // The upper bound is deliberately loose: this file runs concurrently with the
    // rest of the suite, so wall-clock elapsed absorbs CPU contention on top of the
    // real 15s wait. Only the floor pins the behaviour to the proxy's timeout; the
    // ceiling exists to separate "aborted late" from "never aborted".
    assert.ok(elapsed >= 14_900, `expected the request to run out the ~15s timeout (took ${elapsed}ms)`);
    assert.ok(elapsed < 40_000, `must still abort well inside the test's own timeout guard (took ${elapsed}ms)`);
  }
);

test("ERP proxy: oversized upstream response is rejected safely [M1]", async () => {
  const base = await upstreamUrl;
  const app = await loadApp(base);
  mode = "flood";
  const token = await mintToken();
  const res = await app.inject({
    method: "GET",
    url: "/api/erp/doctype/Item",
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(res.statusCode, 502, "a response exceeding the size cap must be aborted and surfaced as 502");
});
