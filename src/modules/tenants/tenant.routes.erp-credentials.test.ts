import test, { after } from "node:test";
import assert from "node:assert/strict";

// H1 Phase B — GET /tenants/:id/erp-credentials must return DECRYPTED credentials
// (encrypted-primary with plaintext fallback) and must NEVER return the ciphertext
// (*Enc) columns in the response body.

const API_KEY = "control-plane-api-key-test-0001";
const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const PATH = `/tenants/${TENANT_ID}/erp-credentials`;

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
    process.env.ERP_CREDENTIAL_ENCRYPTION_KEY = Buffer.alloc(32, 3).toString("base64");

    const { app } = (await import("../../app.js")) as unknown as { app: App };
    try {
      const { redis } = (await import("../../lib/redis.js")) as unknown as {
        redis: { on: (e: string, c: () => void) => void; disconnect: () => void };
      };
      redis.on("error", () => {});
      redis.disconnect();
    } catch { /* ignore */ }

    const { sealSecret } = await import("../../lib/crypto/secret-box.js");
    const encKey = sealSecret("PLAIN-API-KEY-SHOULD-NOT-WIN");
    const encSecret = sealSecret("REAL-API-SECRET");

    const { prisma } = (await import("../../lib/prisma.js")) as unknown as { prisma: Record<string, unknown> };
    Object.defineProperty(prisma, "tenant", {
      value: {
        findUnique: async ({ where }: { where: { id: string } }) =>
          where.id === TENANT_ID
            ? {
                id: TENANT_ID,
                slug: "enc",
                erpSite: "enc.erp.example.com",
                // Encrypted columns present; plaintext apiKey deliberately stale to
                // prove the encrypted value is preferred.
                erpApiKey: "STALE-PLAINTEXT",
                erpApiSecret: null,
                webhookSecret: "WH-PLAIN",
                erpApiKeyEnc: encKey,
                erpApiSecretEnc: encSecret,
                webhookSecretEnc: null,
              }
            : null,
      },
      configurable: true, writable: true,
    });

    await import("./tenant.routes.js");
    await app.ready();
    return app;
  })();
  return cached;
}

after(async () => { if (cached) { const app = await cached; await app.close(); } });

const auth = { authorization: `Bearer ${API_KEY}` };

test("returns decrypted credentials (encrypted preferred over stale plaintext)", async () => {
  const app = await loadApp();
  const res = await app.inject({ method: "GET", url: PATH, headers: auth });
  assert.equal(res.statusCode, 200);
  const out = res.json();
  assert.equal(out.erpApiKey, "PLAIN-API-KEY-SHOULD-NOT-WIN"); // decrypted enc value
  assert.equal(out.erpApiSecret, "REAL-API-SECRET");
  assert.equal(out.webhookSecret, "WH-PLAIN"); // plaintext fallback
  assert.equal(out.erpSite, "enc.erp.example.com");
});

test("response body never contains ciphertext (*Enc) fields", async () => {
  const app = await loadApp();
  const res = await app.inject({ method: "GET", url: PATH, headers: auth });
  const out = res.json();
  assert.equal(out.erpApiKeyEnc, undefined);
  assert.equal(out.erpApiSecretEnc, undefined);
  assert.equal(out.webhookSecretEnc, undefined);
  assert.equal(out.credentialEncryptionVersion, undefined);
  // And no value in the response should look like our versioned ciphertext.
  assert.ok(!JSON.stringify(out).includes("v1:"), "response must not leak v1: ciphertext");
});

test("missing API key → rejected", async () => {
  const app = await loadApp();
  const res = await app.inject({ method: "GET", url: PATH, headers: {} });
  assert.equal(res.statusCode, 401);
});
