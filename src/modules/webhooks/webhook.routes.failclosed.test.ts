import test, { after } from "node:test";
import assert from "node:assert/strict";

// Option C — fail-VISIBLE behavior when the notification pipeline is disabled
// (INVOICE_WEBHOOK_NOTIFY_ENABLED=false, the default). A valid invoice webhook must
// NOT return 2xx (the ERP server script marks custom_whatsapp_sent=1 on any 2xx), so
// we authenticate + audit "pending" + return 503, WITHOUT recording an idempotency key
// (so retries are not deduped away once the pipeline goes live).

const SECRET = "tenant-secret-xyz-0123456789abcdef";
const PATH = "/webhooks/invoice-submitted";

type App = {
  inject: (o: unknown) => Promise<{ statusCode: number; json: () => any }>;
  ready: () => Promise<void>;
  close: () => Promise<void>;
};
let cached: Promise<{ app: App; idemCreates: () => number; audits: () => Array<{ type: string; payload: unknown }> }> | null = null;

function loadApp() {
  if (cached) return cached;
  cached = (async () => {
    process.env.DATABASE_URL ??= "postgresql://postgres:postgres@127.0.0.1:5432/controlplane";
    process.env.REDIS_URL ??= "redis://127.0.0.1:6379";
    process.env.CONTROL_PLANE_API_KEY ??= "control-plane-api-key-test-0001";
    process.env.PROVISIONING_API_URL ??= "https://provisioning.example.com";
    process.env.PROVISIONING_API_TOKEN ??= "token-token-token-token";
    process.env.ERP_BASE_DOMAIN ??= "erp.example.com";
    // Notification pipeline DISABLED (this is the default; set explicitly for clarity).
    process.env.INVOICE_WEBHOOK_NOTIFY_ENABLED = "false";

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
    let idemCreates = 0;
    Object.defineProperty(prisma, "idempotencyKey", {
      value: { create: async () => { idemCreates += 1; return { id: "x" }; } },
      configurable: true, writable: true,
    });
    const audits: Array<{ type: string; payload: unknown }> = [];
    Object.defineProperty(prisma, "auditEvent", {
      value: { create: async ({ data }: { data: { type: string; payload: unknown } }) => { audits.push({ type: data.type, payload: data.payload }); return { id: "a" }; } },
      configurable: true, writable: true,
    });

    await import("./webhook.routes.js");
    await app.ready();
    return { app, idemCreates: () => idemCreates, audits: () => audits };
  })();
  return cached;
}

after(async () => { if (cached) { const { app } = await cached; await app.close(); } });

function body(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    event: "invoice_submitted", invoice_name: "SINV-00001", customer: "C-1",
    customer_name: "Acme Co", grand_total: 250, custom_session_date: "2026-05-30",
    tenant_slug: "acme", ...overrides,
  });
}
const H = (secret?: string) => ({ "content-type": "application/json", ...(secret ? { "x-webhook-secret": secret } : {}) });

test("valid secret + flag OFF → 503 (NOT 2xx)", async () => {
  const { app } = await loadApp();
  const res = await app.inject({ method: "POST", url: PATH, headers: H(SECRET), payload: body({ invoice_name: "SINV-503" }) });
  assert.equal(res.statusCode, 503);
  assert.equal(res.json().ok, false);
  assert.equal(res.json().error, "notification_pipeline_unavailable");
});

test("flag OFF does NOT create an idempotency key, so retries are not deduped away", async () => {
  const { app, idemCreates } = await loadApp();
  const r1 = await app.inject({ method: "POST", url: PATH, headers: H(SECRET), payload: body({ invoice_name: "SINV-RETRY" }) });
  const r2 = await app.inject({ method: "POST", url: PATH, headers: H(SECRET), payload: body({ invoice_name: "SINV-RETRY" }) });
  assert.equal(r1.statusCode, 503);
  assert.equal(r2.statusCode, 503, "repeated webhook must still 503 (not a deduped 200)");
  assert.notEqual(r2.json().deduped, true);
  assert.equal(idemCreates(), 0, "fail-visible path must NOT write an idempotency key");
});

test("flag OFF writes a pending audit event WITHOUT the secret", async () => {
  const { app, audits } = await loadApp();
  await app.inject({ method: "POST", url: PATH, headers: H(SECRET), payload: body({ invoice_name: "SINV-AUDIT" }) });
  const pending = audits().find((a) => a.type.includes("pending"));
  assert.ok(pending, "expected a pending audit event");
  assert.ok(!JSON.stringify(pending!.payload).includes(SECRET), "audit payload must not contain the webhook secret");
});

test("missing secret still → 401 (auth precedes the flag gate)", async () => {
  const { app } = await loadApp();
  const res = await app.inject({ method: "POST", url: PATH, headers: H(), payload: body() });
  assert.equal(res.statusCode, 401);
});

test("invalid secret still → 401", async () => {
  const { app } = await loadApp();
  const res = await app.inject({ method: "POST", url: PATH, headers: H("wrong"), payload: body() });
  assert.equal(res.statusCode, 401);
});

test("malformed payload still → 400", async () => {
  const { app } = await loadApp();
  const res = await app.inject({ method: "POST", url: PATH, headers: H(SECRET), payload: JSON.stringify({ event: "invoice_submitted" }) });
  assert.equal(res.statusCode, 400);
});
