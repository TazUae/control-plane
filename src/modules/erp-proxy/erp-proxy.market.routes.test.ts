import test, { after } from "node:test";
import assert from "node:assert/strict";
import { SignJWT } from "jose";

// Phase 3 — GET /api/erp/tenant/market: tenant-scoped read of the authoritative
// operating market. Scope is the JWT `tenantId` claim; there is no route
// parameter, so isolation is proven by minting different claims, not by
// supplying different inputs to one call.

const JWT_SECRET = "fitdesk-jwt-secret-at-least-32-chars-long-0002";
const PATH = "/api/erp/tenant/market";

type Fixture = {
  id: string;
  slug: string;
  status: string;
  erpSite: string | null;
  erpApiKey: string | null;
  erpApiSecret: string | null;
  companyName: string;
  defaultCurrency: string;
  operatingMarket: string | null;
  operatingMarketSource: string | null;
  operatingMarketVerifiedAt: Date | null;
};

const VERIFIED_LB: Fixture = {
  id: "tenant-a", slug: "acme", status: "active",
  erpSite: "acme", erpApiKey: "k", erpApiSecret: "s",
  companyName: "Acme", defaultCurrency: "USD",
  operatingMarket: "LB", operatingMarketSource: "operator_verified",
  operatingMarketVerifiedAt: new Date("2026-07-20T10:00:00.000Z"),
};

const UNVERIFIED: Fixture = {
  id: "tenant-b", slug: "beta", status: "active",
  erpSite: "beta", erpApiKey: "k", erpApiSecret: "s",
  companyName: "Beta", defaultCurrency: "USD",
  operatingMarket: null, operatingMarketSource: null,
  operatingMarketVerifiedAt: null,
};

const INACTIVE: Fixture = {
  ...UNVERIFIED,
  id: "tenant-inactive", slug: "gamma", status: "suspended",
};

const UNPROVISIONED: Fixture = {
  ...UNVERIFIED,
  id: "tenant-unprovisioned", slug: "delta",
  erpSite: null, erpApiKey: null, erpApiSecret: null,
};

const FIXTURES: Record<string, Fixture> = {
  [VERIFIED_LB.id]: VERIFIED_LB,
  [UNVERIFIED.id]: UNVERIFIED,
  [INACTIVE.id]: INACTIVE,
  [UNPROVISIONED.id]: UNPROVISIONED,
};

type App = {
  inject: (o: unknown) => Promise<{ statusCode: number; json: () => any }>;
  ready: () => Promise<void>;
  close: () => Promise<void>;
};
let cached: Promise<App> | null = null;

function loadApp(): Promise<App> {
  if (cached) return cached;
  cached = (async () => {
    process.env.DATABASE_URL ??= "postgresql://postgres:postgres@127.0.0.1:5432/controlplane";
    process.env.REDIS_URL ??= "redis://127.0.0.1:6379";
    process.env.CONTROL_PLANE_API_KEY ??= "control-plane-api-key-test-0002";
    process.env.PROVISIONING_API_URL ??= "https://provisioning.example.com";
    process.env.PROVISIONING_API_TOKEN ??= "token-token-token-token";
    process.env.ERP_BASE_DOMAIN ??= "erp.example.com";
    process.env.FITDESK_JWT_SECRET = JWT_SECRET;

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
        findUnique: async ({ where }: { where: { id: string } }) => FIXTURES[where.id] ?? null,
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

function mintToken(tenantId: string, opts?: { secret?: string; expiredSecondsAgo?: number }): Promise<string> {
  const secret = opts?.secret ?? JWT_SECRET;
  let builder = new SignJWT({ tenantId }).setProtectedHeader({ alg: "HS256" });
  builder = opts?.expiredSecondsAgo
    ? builder.setExpirationTime(Math.floor(Date.now() / 1000) - opts.expiredSecondsAgo)
    : builder.setExpirationTime("2m");
  return builder.sign(new TextEncoder().encode(secret));
}

after(async () => {
  if (cached) { const a = await cached; await a.close(); }
});

// --- 401 --------------------------------------------------------------------

test("401: no Authorization header", async () => {
  const app = await loadApp();
  const res = await app.inject({ method: "GET", url: PATH });
  assert.equal(res.statusCode, 401);
});

test("401: malformed bearer token", async () => {
  const app = await loadApp();
  const res = await app.inject({
    method: "GET", url: PATH,
    headers: { authorization: "Bearer not-a-real-jwt" },
  });
  assert.equal(res.statusCode, 401);
});

test("401: token signed with the wrong secret", async () => {
  const app = await loadApp();
  const token = await mintToken(VERIFIED_LB.id, { secret: "a-completely-different-secret-32-chars-min" });
  const res = await app.inject({
    method: "GET", url: PATH,
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(res.statusCode, 401);
});

test("401: expired token", async () => {
  const app = await loadApp();
  const token = await mintToken(VERIFIED_LB.id, { expiredSecondsAgo: 60 });
  const res = await app.inject({
    method: "GET", url: PATH,
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(res.statusCode, 401);
});

// --- isolation ----------------------------------------------------------------

test("isolation: a JWT for tenant A returns exactly A's row", async () => {
  const app = await loadApp();
  const token = await mintToken(VERIFIED_LB.id);
  const res = await app.inject({ method: "GET", url: PATH, headers: { authorization: `Bearer ${token}` } });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().operatingMarket, "LB");
});

test("isolation: a JWT for tenant B returns B's row, not A's", async () => {
  const app = await loadApp();
  const token = await mintToken(UNVERIFIED.id);
  const res = await app.inject({ method: "GET", url: PATH, headers: { authorization: `Bearer ${token}` } });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().operatingMarket, null);
});

test("isolation: no query, body, or path input can select a different tenant", async () => {
  const app = await loadApp();
  const token = await mintToken(UNVERIFIED.id);
  const res = await app.inject({
    method: "GET",
    url: `${PATH}?tenantId=${VERIFIED_LB.id}`,
    headers: { authorization: `Bearer ${token}` },
    payload: { tenantId: VERIFIED_LB.id },
  });
  assert.equal(res.statusCode, 200);
  // Scope came from the JWT claim (tenant B), not the query/body (tenant A).
  assert.equal(res.json().operatingMarket, null);
});

// --- 403 / 404 / 503 ----------------------------------------------------------

test("403: tenant is not active", async () => {
  const app = await loadApp();
  const token = await mintToken(INACTIVE.id);
  const res = await app.inject({ method: "GET", url: PATH, headers: { authorization: `Bearer ${token}` } });
  assert.equal(res.statusCode, 403);
});

test("404: unknown tenant", async () => {
  const app = await loadApp();
  const token = await mintToken("no-such-tenant");
  const res = await app.inject({ method: "GET", url: PATH, headers: { authorization: `Bearer ${token}` } });
  assert.equal(res.statusCode, 404);
});

test("503: ERP credentials not yet provisioned", async () => {
  const app = await loadApp();
  const token = await mintToken(UNPROVISIONED.id);
  const res = await app.inject({ method: "GET", url: PATH, headers: { authorization: `Bearer ${token}` } });
  assert.equal(res.statusCode, 503);
});

// --- response shape ------------------------------------------------------------

test("unverified tenant: { null, false, null }", async () => {
  const app = await loadApp();
  const token = await mintToken(UNVERIFIED.id);
  const res = await app.inject({ method: "GET", url: PATH, headers: { authorization: `Bearer ${token}` } });
  assert.deepEqual(res.json(), { operatingMarket: null, verified: false, verifiedAt: null });
});

test("verified tenant: { 'LB', true, <iso> }", async () => {
  const app = await loadApp();
  const token = await mintToken(VERIFIED_LB.id);
  const res = await app.inject({ method: "GET", url: PATH, headers: { authorization: `Bearer ${token}` } });
  assert.deepEqual(res.json(), {
    operatingMarket: "LB",
    verified: true,
    verifiedAt: "2026-07-20T10:00:00.000Z",
  });
});

// --- negative-leak assertion ----------------------------------------------------

test("negative leak: exactly three keys, never country or credentials", async () => {
  const app = await loadApp();
  const token = await mintToken(VERIFIED_LB.id);
  const res = await app.inject({ method: "GET", url: PATH, headers: { authorization: `Bearer ${token}` } });
  const body = res.json();
  assert.deepEqual(Object.keys(body).sort(), ["operatingMarket", "verified", "verifiedAt"]);
  assert.ok(!("country" in body));
  assert.ok(!("erpApiKey" in body));
  assert.ok(!("erpApiSecret" in body));
  assert.ok(!("erpSite" in body));
});
