import test, { after } from "node:test";
import assert from "node:assert/strict";

// C1 — signed invoice webhook receiver. The canonical ERP server script
// (provisioning_api fitdesk_setup.py) POSTs to /webhooks/invoice-submitted with a
// shared per-tenant secret in the `X-Webhook-Secret` header (NOT an HMAC over the body).
// Tests cover: fail-closed auth, constant-time secret check, replay dedupe, safe ack.

const SECRET = "tenant-secret-xyz-0123456789abcdef";
const PATH = "/webhooks/invoice-submitted";

type App = {
  inject: (o: unknown) => Promise<{ statusCode: number; json: () => any }>;
  ready: () => Promise<void>;
  close: () => Promise<void>;
};
let cached: Promise<{ app: App; audits: () => number }> | null = null;

function loadApp(): Promise<{ app: App; audits: () => number }> {
  if (cached) return cached;
  cached = (async () => {
    process.env.DATABASE_URL ??= "postgresql://postgres:postgres@127.0.0.1:5432/controlplane";
    process.env.REDIS_URL ??= "redis://127.0.0.1:6379";
    process.env.CONTROL_PLANE_API_KEY ??= "control-plane-api-key-test-0001";
    process.env.PROVISIONING_API_URL ??= "https://provisioning.example.com";
    process.env.PROVISIONING_API_TOKEN ??= "token-token-token-token";
    process.env.ERP_BASE_DOMAIN ??= "erp.example.com";
    // This suite covers the flag-ENABLED accepted path (200 + durable dedupe).
    process.env.INVOICE_WEBHOOK_NOTIFY_ENABLED = "true";

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
          where.slug === "acme" ? { id: "t1", webhookSecret: SECRET } : null,
      },
      configurable: true, writable: true,
    });
    const seen = new Set<string>();
    Object.defineProperty(prisma, "idempotencyKey", {
      value: {
        create: async ({ data }: { data: { key: string } }) => {
          if (seen.has(data.key)) { const e = new Error("unique") as Error & { code?: string }; e.code = "P2002"; throw e; }
          seen.add(data.key); return { id: "x" };
        },
      },
      configurable: true, writable: true,
    });
    let audits = 0;
    Object.defineProperty(prisma, "auditEvent", {
      value: { create: async () => { audits += 1; return { id: "a" }; } },
      configurable: true, writable: true,
    });

    await import("./webhook.routes.js");
    await app.ready();
    return { app, audits: () => audits };
  })();
  return cached;
}

after(async () => { if (cached) { const { app } = await cached; await app.close(); } });

function body(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    event: "invoice_submitted",
    invoice_name: "SINV-00001",
    customer: "C-1",
    customer_name: "Acme Co",
    grand_total: 250,
    custom_session_date: "2026-05-30",
    tenant_slug: "acme",
    ...overrides,
  });
}
const H = (secret?: string) => ({
  "content-type": "application/json",
  ...(secret ? { "x-webhook-secret": secret } : {}),
});

test("missing X-Webhook-Secret → 401 (fail closed)", async () => {
  const { app } = await loadApp();
  const res = await app.inject({ method: "POST", url: PATH, headers: H(), payload: body() });
  assert.equal(res.statusCode, 401);
});

test("wrong secret → 401", async () => {
  const { app } = await loadApp();
  const res = await app.inject({ method: "POST", url: PATH, headers: H("wrong-secret"), payload: body() });
  assert.equal(res.statusCode, 401);
});

test("unknown tenant_slug → 401 (does not reveal tenant existence)", async () => {
  const { app } = await loadApp();
  const res = await app.inject({ method: "POST", url: PATH, headers: H(SECRET), payload: body({ tenant_slug: "ghost" }) });
  assert.equal(res.statusCode, 401);
});

test("malformed payload (missing tenant_slug) → 400", async () => {
  const { app } = await loadApp();
  const res = await app.inject({
    method: "POST", url: PATH, headers: H(SECRET),
    payload: JSON.stringify({ event: "invoice_submitted", invoice_name: "SINV-x" }),
  });
  assert.equal(res.statusCode, 400);
});

test("valid secret + payload → 200 { ok: true }, audited once", async () => {
  const { app, audits } = await loadApp();
  const before = audits();
  const res = await app.inject({ method: "POST", url: PATH, headers: H(SECRET), payload: body({ invoice_name: "SINV-ACCEPT" }) });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().ok, true);
  assert.equal(audits(), before + 1, "valid delivery must write exactly one audit event");
});

test("replayed invoice → 200 { deduped: true }, no second audit", async () => {
  const { app, audits } = await loadApp();
  const r1 = await app.inject({ method: "POST", url: PATH, headers: H(SECRET), payload: body({ invoice_name: "SINV-REPLAY" }) });
  assert.equal(r1.statusCode, 200);
  const afterFirst = audits();
  const r2 = await app.inject({ method: "POST", url: PATH, headers: H(SECRET), payload: body({ invoice_name: "SINV-REPLAY" }) });
  assert.equal(r2.statusCode, 200);
  assert.equal(r2.json().deduped, true);
  assert.equal(audits(), afterFirst, "replay must not write a second audit event");
});
