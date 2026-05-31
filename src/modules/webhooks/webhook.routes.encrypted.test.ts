import test, { after } from "node:test";
import assert from "node:assert/strict";

// H1 Phase B — webhook secret verification must work when the tenant's secret is
// stored ENCRYPTED (webhookSecretEnc) as well as for legacy plaintext tenants.
// Auth happens before the notification-flag gate, so we run with the flag ENABLED
// and assert: correct secret (sealed in DB) → 200; wrong secret → 401.

const SECRET = "tenant-secret-xyz-0123456789abcdef";
const PATH = "/webhooks/invoice-submitted";

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
    process.env.CONTROL_PLANE_API_KEY ??= "control-plane-api-key-test-0001";
    process.env.PROVISIONING_API_URL ??= "https://provisioning.example.com";
    process.env.PROVISIONING_API_TOKEN ??= "token-token-token-token";
    process.env.ERP_BASE_DOMAIN ??= "erp.example.com";
    process.env.INVOICE_WEBHOOK_NOTIFY_ENABLED = "true";
    // Encryption key required to seal/open the stored webhook secret.
    process.env.ERP_CREDENTIAL_ENCRYPTION_KEY = Buffer.alloc(32, 5).toString("base64");

    const { app } = (await import("../../app.js")) as unknown as { app: App };
    try {
      const { redis } = (await import("../../lib/redis.js")) as unknown as {
        redis: { on: (e: string, c: () => void) => void; disconnect: () => void };
      };
      redis.on("error", () => {});
      redis.disconnect();
    } catch { /* ignore */ }

    // Seal the secret with the same key the app will use to open it.
    const { sealSecret } = await import("../../lib/crypto/secret-box.js");
    const sealed = sealSecret(SECRET);

    const { prisma } = (await import("../../lib/prisma.js")) as unknown as { prisma: Record<string, unknown> };
    Object.defineProperty(prisma, "tenant", {
      value: {
        // Encrypted-only tenant: plaintext column is null, ciphertext is present.
        findUnique: async ({ where }: { where: { slug: string } }) =>
          where.slug === "acme" ? { id: "t1", webhookSecret: null, webhookSecretEnc: sealed } : null,
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
    Object.defineProperty(prisma, "auditEvent", {
      value: { create: async () => ({ id: "a" }) },
      configurable: true, writable: true,
    });

    await import("./webhook.routes.js");
    await app.ready();
    return app;
  })();
  return cached;
}

after(async () => { if (cached) { const app = await cached; await app.close(); } });

function body(): string {
  return JSON.stringify({
    event: "invoice_submitted",
    invoice_name: "SINV-ENC-0001",
    customer: "C-1",
    customer_name: "Acme Co",
    grand_total: 250,
    tenant_slug: "acme",
  });
}
const H = (secret?: string) => ({
  "content-type": "application/json",
  ...(secret ? { "x-webhook-secret": secret } : {}),
});

test("correct secret matched against encrypted webhookSecretEnc → 200 (auth passes)", async () => {
  const app = await loadApp();
  const res = await app.inject({ method: "POST", url: PATH, headers: H(SECRET), payload: body() });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().ok, true);
});

test("wrong secret against encrypted tenant → 401 (fail closed)", async () => {
  const app = await loadApp();
  const res = await app.inject({ method: "POST", url: PATH, headers: H("wrong-secret"), payload: body() });
  assert.equal(res.statusCode, 401);
});
