import test, { after } from "node:test";
import assert from "node:assert/strict";

// Pending payment-notification API: tenant-scoped, internal-key protected.
const KEY = "control-plane-api-key-test-0001";

type App = {
  inject: (o: unknown) => Promise<{ statusCode: number; json: () => any }>;
  ready: () => Promise<void>;
  close: () => Promise<void>;
};
// store key = `${tenantId}:${invoiceName}`
const store = new Map<string, any>();
let cached: Promise<App> | null = null;

function seed() {
  store.clear();
  const mk = (tenantId: string, invoiceName: string, status: string) => ({
    tenantId, invoiceName, customer: `${invoiceName}-cust`, customerName: "Acme Co",
    grandTotal: 250, currency: null, sessionDate: null, status,
    createdAt: new Date(), sentAt: null, dismissedAt: null,
  });
  store.set("t1:SINV-1", mk("t1", "SINV-1", "pending"));
  store.set("t1:SINV-2", mk("t1", "SINV-2", "pending"));
  store.set("t1:SINV-SENT", mk("t1", "SINV-SENT", "sent"));
  store.set("t2:SINV-OTHER", mk("t2", "SINV-OTHER", "pending")); // different tenant
}

function loadApp(): Promise<App> {
  if (cached) return cached;
  cached = (async () => {
    process.env.DATABASE_URL ??= "postgresql://postgres:postgres@127.0.0.1:5432/controlplane";
    process.env.REDIS_URL ??= "redis://127.0.0.1:6379";
    process.env.CONTROL_PLANE_API_KEY = KEY;
    process.env.PROVISIONING_API_URL ??= "https://provisioning.example.com";
    process.env.PROVISIONING_API_TOKEN ??= "token-token-token-token";
    process.env.ERP_BASE_DOMAIN ??= "erp.example.com";

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
        findUnique: async ({ where }: { where: { slug: string } }) =>
          where.slug === "acme" ? { id: "t1" } : where.slug === "other" ? { id: "t2" } : null,
      },
      configurable: true, writable: true,
    });
    Object.defineProperty(prisma, "pendingPaymentNotification", {
      value: {
        findMany: async ({ where }: { where: { tenantId: string; status: string } }) =>
          [...store.values()].filter((r) => r.tenantId === where.tenantId && r.status === where.status),
        update: async ({ where, data }: { where: { tenantId_invoiceName: { tenantId: string; invoiceName: string } }; data: Record<string, unknown> }) => {
          const k = `${where.tenantId_invoiceName.tenantId}:${where.tenantId_invoiceName.invoiceName}`;
          if (!store.has(k)) { const e = new Error("not found") as Error & { code?: string }; e.code = "P2025"; throw e; }
          store.set(k, { ...store.get(k), ...data });
          return store.get(k);
        },
      },
      configurable: true, writable: true,
    });

    await import("./pending-notification.routes.js");
    await app.ready();
    return app;
  })();
  return cached;
}

after(async () => { if (cached) { const a = await cached; await a.close(); } });
const auth = (k?: string) => (k ? { authorization: `Bearer ${k}` } : {});

test("GET pending requires the internal API key", async () => {
  seed();
  const app = await loadApp();
  const res = await app.inject({ method: "GET", url: "/tenants/acme/pending-payment-notifications" });
  assert.equal(res.statusCode, 401);
});

test("GET pending returns only this tenant's pending rows (no cross-tenant leak)", async () => {
  seed();
  const app = await loadApp();
  const res = await app.inject({ method: "GET", url: "/tenants/acme/pending-payment-notifications", headers: auth(KEY) });
  assert.equal(res.statusCode, 200);
  const names = res.json().notifications.map((n: { invoiceName: string }) => n.invoiceName).sort();
  assert.deepEqual(names, ["SINV-1", "SINV-2"]); // pending only; not SINV-SENT, not the other tenant
});

test("GET pending 404s for an unknown tenant", async () => {
  seed();
  const app = await loadApp();
  const res = await app.inject({ method: "GET", url: "/tenants/ghost/pending-payment-notifications", headers: auth(KEY) });
  assert.equal(res.statusCode, 404);
});

test("POST sent requires the internal API key", async () => {
  seed();
  const app = await loadApp();
  const res = await app.inject({ method: "POST", url: "/tenants/acme/pending-payment-notifications/SINV-1/sent" });
  assert.equal(res.statusCode, 401);
});

test("POST sent marks the row sent and is idempotent", async () => {
  seed();
  const app = await loadApp();
  const r1 = await app.inject({ method: "POST", url: "/tenants/acme/pending-payment-notifications/SINV-1/sent", headers: auth(KEY) });
  assert.equal(r1.statusCode, 200);
  assert.equal(store.get("t1:SINV-1").status, "sent");
  assert.ok(store.get("t1:SINV-1").sentAt, "sentAt should be set");
  const r2 = await app.inject({ method: "POST", url: "/tenants/acme/pending-payment-notifications/SINV-1/sent", headers: auth(KEY) });
  assert.equal(r2.statusCode, 200, "marking sent again must be idempotent");
});

test("POST sent 404s for an unknown invoice", async () => {
  seed();
  const app = await loadApp();
  const res = await app.inject({ method: "POST", url: "/tenants/acme/pending-payment-notifications/SINV-NOPE/sent", headers: auth(KEY) });
  assert.equal(res.statusCode, 404);
});

test("a tenant cannot mark another tenant's notification sent", async () => {
  seed();
  const app = await loadApp();
  // SINV-OTHER belongs to tenant t2 (slug "other"); marking it under "acme" (t1) must 404.
  const res = await app.inject({ method: "POST", url: "/tenants/acme/pending-payment-notifications/SINV-OTHER/sent", headers: auth(KEY) });
  assert.equal(res.statusCode, 404);
  assert.equal(store.get("t2:SINV-OTHER").status, "pending", "other tenant's row must be untouched");
});
