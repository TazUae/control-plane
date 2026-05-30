import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

// ---------------------------------------------------------------------------
// H2 — Non-constant-time internal-API-key comparison (timing oracle)
//
// `requireInternalApiKey` (require-internal-api-key.ts:19) compares the inbound
// bearer token against CONTROL_PLANE_API_KEY with `token !== env.CONTROL_PLANE_API_KEY`.
// String `!==` short-circuits at the first differing byte, leaking a timing
// side channel that can reveal the shared API key. This guard protects every
// internal job/tenant route, so the key is high value.
//
// The constant-time reproduction test FAILS against the current code (because
// `crypto.timingSafeEqual` is never invoked) and will PASS once the comparison
// is routed through `crypto.timingSafeEqual`, matching the codebase idiom
// already used in webhook.routes.ts.
// ---------------------------------------------------------------------------

const API_KEY = "control-plane-api-key-test-0001"; // >= 16 chars, satisfies env schema

async function loadMiddleware() {
  // env.ts parses process.env at import time, so seed required keys first.
  process.env.DATABASE_URL ??= "postgresql://postgres:postgres@127.0.0.1:5432/controlplane";
  process.env.REDIS_URL ??= "redis://127.0.0.1:6379";
  process.env.CONTROL_PLANE_API_KEY = API_KEY;
  process.env.PROVISIONING_API_URL ??= "https://provisioning.example.com";
  process.env.PROVISIONING_API_TOKEN ??= "token-token-token-token";
  process.env.ERP_BASE_DOMAIN ??= "erp.example.com";
  const mod = await import("./require-internal-api-key.js");
  return mod.requireInternalApiKey;
}

function mockReq(authHeader?: string) {
  const headers: Record<string, string> = {};
  if (authHeader !== undefined) headers.authorization = authHeader;
  return { headers };
}

function mockReply() {
  return {
    statusCode: undefined as number | undefined,
    body: undefined as unknown,
    code(n: number) {
      this.statusCode = n;
      return this;
    },
    send(b: unknown) {
      this.body = b;
      return this;
    },
  };
}

// --- behavioral guard rails (pass before AND after the fix) ----------------

test("requireInternalApiKey: 401 when Authorization header is missing", async () => {
  const requireInternalApiKey = await loadMiddleware();
  const reply = mockReply();
  await requireInternalApiKey(mockReq(undefined), reply);
  assert.equal(reply.statusCode, 401);
});

test("requireInternalApiKey: 401 when Bearer token is empty", async () => {
  const requireInternalApiKey = await loadMiddleware();
  const reply = mockReply();
  await requireInternalApiKey(mockReq("Bearer "), reply);
  assert.equal(reply.statusCode, 401);
});

test("requireInternalApiKey: 403 when token is wrong", async () => {
  const requireInternalApiKey = await loadMiddleware();
  const reply = mockReply();
  await requireInternalApiKey(mockReq("Bearer the-wrong-api-key-000000"), reply);
  assert.equal(reply.statusCode, 403);
});

test("requireInternalApiKey: allows the correct key (no error reply)", async () => {
  const requireInternalApiKey = await loadMiddleware();
  const reply = mockReply();
  await requireInternalApiKey(mockReq(`Bearer ${API_KEY}`), reply);
  assert.equal(reply.statusCode, undefined);
});

// --- H2 reproduction: must use constant-time comparison --------------------

test("requireInternalApiKey: compares the key in constant time via crypto.timingSafeEqual [H2 repro]", async () => {
  const requireInternalApiKey = await loadMiddleware();
  const original = crypto.timingSafeEqual;
  let timingSafeEqualCalls = 0;
  (crypto as unknown as { timingSafeEqual: typeof crypto.timingSafeEqual }).timingSafeEqual = ((
    a: NodeJS.ArrayBufferView,
    b: NodeJS.ArrayBufferView,
  ) => {
    timingSafeEqualCalls += 1;
    return original(a, b);
  }) as typeof crypto.timingSafeEqual;

  try {
    // A present token must be compared against the expected key in constant time.
    await requireInternalApiKey(mockReq("Bearer the-wrong-api-key-000000"), mockReply());
  } finally {
    (crypto as unknown as { timingSafeEqual: typeof crypto.timingSafeEqual }).timingSafeEqual = original;
  }

  assert.ok(
    timingSafeEqualCalls > 0,
    "Expected requireInternalApiKey() to compare the bearer token against CONTROL_PLANE_API_KEY " +
      "using crypto.timingSafeEqual (constant-time). It currently uses " +
      "`token !== env.CONTROL_PLANE_API_KEY` (control-plane/src/middleware/require-internal-api-key.ts:19), " +
      "which short-circuits at the first differing byte and exposes a timing oracle on the internal API key.",
  );
});
