import test, { after } from "node:test";
import assert from "node:assert/strict";

// Phase 4 — POST/DELETE /tenants/:id/operating-market. Exercises the
// in-transaction audit design (D2): a real interactive transaction is
// simulated (draft-then-commit-on-success), so an audit-write failure
// provably leaves the tenant row untouched, not merely "expected to."

const API_KEY = "control-plane-api-key-test-0003";

type TenantRow = {
  id: string;
  operatingMarket: string | null;
  operatingMarketSource: string | null;
  operatingMarketVerifiedAt: Date | null;
  operatingMarketVerifiedBy: string | null;
};

const FRESH_ID = "11111111-1111-4111-8111-111111111111";
const GRANTED_ID = "22222222-2222-4222-8222-222222222222";
const MISSING_ID = "99999999-9999-4999-8999-999999999999";

const store = new Map<string, TenantRow>();
const auditLog: any[] = [];
let failNextAudit = false;

function seed() {
  store.clear();
  auditLog.length = 0;
  failNextAudit = false;
  store.set(FRESH_ID, {
    id: FRESH_ID,
    operatingMarket: null,
    operatingMarketSource: null,
    operatingMarketVerifiedAt: null,
    operatingMarketVerifiedBy: null,
  });
  store.set(GRANTED_ID, {
    id: GRANTED_ID,
    operatingMarket: "LB",
    operatingMarketSource: "operator_verified",
    operatingMarketVerifiedAt: new Date("2026-07-01T00:00:00.000Z"),
    operatingMarketVerifiedBy: "first-operator",
  });
}

async function fakeTransaction(callback: (tx: any) => Promise<any>) {
  const drafts: Record<string, TenantRow> = {};
  const draftAudits: any[] = [];

  const tx = {
    tenant: {
      findUnique: async ({ where }: { where: { id: string } }) => {
        if (!(where.id in drafts)) {
          const real = store.get(where.id);
          if (!real) return null;
          drafts[where.id] = { ...real };
        }
        return { ...drafts[where.id] };
      },
      update: async ({ where, data }: { where: { id: string }; data: Partial<TenantRow> }) => {
        drafts[where.id] = { ...drafts[where.id], ...data } as TenantRow;
        return { ...drafts[where.id] };
      },
    },
    auditEvent: {
      create: async ({ data }: { data: unknown }) => {
        if (failNextAudit) {
          failNextAudit = false;
          throw new Error("simulated audit write failure");
        }
        draftAudits.push(data);
      },
    },
  };

  // Real interactive transactions are all-or-nothing: only commit the drafts
  // (and the audit rows) if the callback resolves without throwing.
  const result = await callback(tx);
  for (const [id, row] of Object.entries(drafts)) store.set(id, row);
  auditLog.push(...draftAudits);
  return result;
}

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
    process.env.CONTROL_PLANE_API_KEY = API_KEY;
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
      value: { findUnique: async ({ where }: any) => store.get(where.id) ?? null },
      configurable: true,
      writable: true,
    });
    Object.defineProperty(prisma, "$transaction", {
      value: fakeTransaction,
      configurable: true,
      writable: true,
    });

    await import("./tenant.routes.js");
    await app.ready();
    return app;
  })();
  return cached;
}

after(async () => {
  if (cached) { const a = await cached; await a.close(); }
});

const auth = { authorization: `Bearer ${API_KEY}` };

// --- auth ---------------------------------------------------------------------

test("grant: no key -> 401", async () => {
  seed();
  const app = await loadApp();
  const res = await app.inject({
    method: "POST", url: `/tenants/${FRESH_ID}/operating-market`,
    payload: { market: "LB", verifiedBy: "op-1" },
  });
  assert.equal(res.statusCode, 401);
});

test("grant: bad key -> 403 (not 401)", async () => {
  seed();
  const app = await loadApp();
  const res = await app.inject({
    method: "POST", url: `/tenants/${FRESH_ID}/operating-market`,
    headers: { authorization: "Bearer wrong-key" },
    payload: { market: "LB", verifiedBy: "op-1" },
  });
  assert.equal(res.statusCode, 403);
});

// --- validation -----------------------------------------------------------------

for (const bad of ["XX", "lb", "", "USA"]) {
  test(`grant: unsupported market "${bad}" -> 422`, async () => {
    seed();
    const app = await loadApp();
    const res = await app.inject({
      method: "POST", url: `/tenants/${FRESH_ID}/operating-market`,
      headers: auth,
      payload: { market: bad, verifiedBy: "op-1" },
    });
    assert.equal(res.statusCode, 422);
  });
}

test("grant: empty verifiedBy -> 400", async () => {
  seed();
  const app = await loadApp();
  const res = await app.inject({
    method: "POST", url: `/tenants/${FRESH_ID}/operating-market`,
    headers: auth,
    payload: { market: "LB", verifiedBy: "" },
  });
  assert.equal(res.statusCode, 400);
});

// --- grant ------------------------------------------------------------------------

test("grant: valid grant sets all four fields and writes exactly one audit row", async () => {
  seed();
  const app = await loadApp();
  const res = await app.inject({
    method: "POST", url: `/tenants/${FRESH_ID}/operating-market`,
    headers: auth,
    payload: { market: "LB", verifiedBy: "op-1" },
  });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.tenantId, FRESH_ID);
  assert.equal(body.operatingMarket, "LB");
  assert.equal(body.operatingMarketSource, "operator_verified");
  assert.ok(body.operatingMarketVerifiedAt);
  assert.equal(body.operatingMarketVerifiedBy, "op-1");
  assert.equal(body.changed, true);

  assert.equal(auditLog.length, 1);
  const row = auditLog[0];
  assert.equal(row.type, "tenant.operating_market.verified");
  assert.equal(row.tenantId, FRESH_ID);
  assert.equal(row.payload.authenticatedServiceIdentity, "control-plane-admin-key");
  assert.equal(row.payload.assertedHumanOperator, "op-1");
  assert.equal(row.payload.changed, true);
  assert.equal(row.payload.before.operatingMarket, null);
  assert.equal(row.payload.after.operatingMarket, "LB");
  assert.ok(typeof row.payload.requestId === "string" && row.payload.requestId.length > 0);
});

test("grant: idempotent re-grant of the same market -> changed:false, row untouched, audit still written", async () => {
  seed();
  const app = await loadApp();
  const res = await app.inject({
    method: "POST", url: `/tenants/${GRANTED_ID}/operating-market`,
    headers: auth,
    payload: { market: "LB", verifiedBy: "second-operator" },
  });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.changed, false);
  // The row is NOT overwritten by the second operator's re-affirmation.
  assert.equal(body.operatingMarketVerifiedBy, "first-operator");
  assert.equal(body.operatingMarketVerifiedAt, "2026-07-01T00:00:00.000Z");

  assert.equal(auditLog.length, 1);
  assert.equal(auditLog[0].payload.changed, false);
  assert.equal(auditLog[0].payload.assertedHumanOperator, "second-operator");
});

test("grant: 404 unknown tenant emits no audit row", async () => {
  seed();
  const app = await loadApp();
  const res = await app.inject({
    method: "POST", url: `/tenants/${MISSING_ID}/operating-market`,
    headers: auth,
    payload: { market: "LB", verifiedBy: "op-1" },
  });
  assert.equal(res.statusCode, 404);
  assert.equal(auditLog.length, 0);
});

test("grant: simulated audit-write failure leaves the tenant row unchanged (no false success)", async () => {
  seed();
  failNextAudit = true;
  const app = await loadApp();
  const res = await app.inject({
    method: "POST", url: `/tenants/${FRESH_ID}/operating-market`,
    headers: auth,
    payload: { market: "LB", verifiedBy: "op-1" },
  });
  assert.equal(res.statusCode, 500);
  assert.equal(auditLog.length, 0);
  // The row must be exactly as seeded -- the update was rolled back with the audit.
  const row = store.get(FRESH_ID)!;
  assert.equal(row.operatingMarket, null);
  assert.equal(row.operatingMarketVerifiedBy, null);
});

// --- revoke -----------------------------------------------------------------------

test("revoke: sets all four fields to null and writes an audit row", async () => {
  seed();
  const app = await loadApp();
  const res = await app.inject({
    method: "DELETE", url: `/tenants/${GRANTED_ID}/operating-market`,
    headers: auth,
    payload: { verifiedBy: "op-2" },
  });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.deepEqual(Object.keys(body).sort(), ["changed", "operatingMarket", "tenantId"]);
  assert.equal(body.operatingMarket, null);
  assert.equal(body.changed, true);

  assert.equal(auditLog.length, 1);
  assert.equal(auditLog[0].type, "tenant.operating_market.revoked");
  assert.equal(auditLog[0].payload.before.operatingMarket, "LB");
  assert.equal(auditLog[0].payload.after.operatingMarket, null);

  const row = store.get(GRANTED_ID)!;
  assert.equal(row.operatingMarket, null);
  assert.equal(row.operatingMarketSource, null);
  assert.equal(row.operatingMarketVerifiedAt, null);
  assert.equal(row.operatingMarketVerifiedBy, null);
});

test("revoke: already-NULL market -> changed:false, still audited", async () => {
  seed();
  const app = await loadApp();
  const res = await app.inject({
    method: "DELETE", url: `/tenants/${FRESH_ID}/operating-market`,
    headers: auth,
    payload: { verifiedBy: "op-2" },
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().changed, false);
  assert.equal(auditLog.length, 1);
});

test("revoke: empty verifiedBy -> 400", async () => {
  seed();
  const app = await loadApp();
  const res = await app.inject({
    method: "DELETE", url: `/tenants/${GRANTED_ID}/operating-market`,
    headers: auth,
    payload: { verifiedBy: "" },
  });
  assert.equal(res.statusCode, 400);
});
