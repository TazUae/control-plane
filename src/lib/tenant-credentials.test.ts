import test from "node:test";
import assert from "node:assert/strict";

process.env.ERP_CREDENTIAL_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");

import {
  readTenantErpCredentials,
  buildEncryptedCredentialWrite,
  buildWebhookSecretWrite,
  buildErpApiCredentialWrite,
} from "./tenant-credentials.js";
import { sealSecret, openSecret } from "./crypto/secret-box.js";

// ─── Read behavior (encrypted-primary, plaintext fallback) ──────────────────────

test("prefers encrypted fields when present (decrypts them)", () => {
  const creds = readTenantErpCredentials({
    erpApiKey: "PLAINTEXT-KEY",
    erpApiKeyEnc: sealSecret("ENC-KEY"),
    erpApiSecret: null,
    erpApiSecretEnc: sealSecret("ENC-SECRET"),
    webhookSecret: "PLAIN-WH",
    webhookSecretEnc: null,
  });
  assert.equal(creds.erpApiKey, "ENC-KEY");
  assert.equal(creds.erpApiSecret, "ENC-SECRET");
  assert.equal(creds.webhookSecret, "PLAIN-WH"); // falls back: no ciphertext
});

test("falls back to plaintext when no encrypted fields (legacy tenant)", () => {
  const creds = readTenantErpCredentials({
    erpApiKey: "K",
    erpApiSecret: "S",
    webhookSecret: "W",
    erpApiKeyEnc: null,
    erpApiSecretEnc: null,
    webhookSecretEnc: null,
  });
  assert.deepEqual(creds, { erpApiKey: "K", erpApiSecret: "S", webhookSecret: "W" });
});

test("missing fields resolve to null", () => {
  assert.deepEqual(readTenantErpCredentials({}), {
    erpApiKey: null,
    erpApiSecret: null,
    webhookSecret: null,
  });
});

test("webhook secret resolves from encrypted column when present", () => {
  const creds = readTenantErpCredentials({ webhookSecret: null, webhookSecretEnc: sealSecret("WH-ENC") });
  assert.equal(creds.webhookSecret, "WH-ENC");
});

test("webhook secret resolves from legacy plaintext column", () => {
  const creds = readTenantErpCredentials({ webhookSecret: "WH-LEGACY", webhookSecretEnc: null });
  assert.equal(creds.webhookSecret, "WH-LEGACY");
});

// ─── Phase A helper (retained) ──────────────────────────────────────────────────

test("buildEncryptedCredentialWrite seals provided values and sets version", () => {
  const w = buildEncryptedCredentialWrite({ erpApiKey: "K", webhookSecret: "W" });
  assert.equal(w.credentialEncryptionVersion, 1);
  assert.match(w.erpApiKeyEnc ?? "", /^v1:/);
  assert.equal(w.erpApiSecretEnc, undefined); // not provided -> skipped
  assert.match(w.webhookSecretEnc ?? "", /^v1:/);
});

// ─── Phase B dual-write: webhook secret ─────────────────────────────────────────

test("buildWebhookSecretWrite (encryption DISABLED) writes plaintext only", () => {
  const w = buildWebhookSecretWrite("wh-secret", false);
  assert.equal(w.webhookSecret, "wh-secret");
  assert.equal(w.webhookSecretEnc, undefined);
  assert.equal(w.credentialEncryptionVersion, undefined);
  assert.deepEqual(Object.keys(w), ["webhookSecret"]); // exactly the legacy payload
});

test("buildWebhookSecretWrite (encryption ENABLED) writes plaintext AND encrypted", () => {
  const w = buildWebhookSecretWrite("wh-secret", true);
  assert.equal(w.webhookSecret, "wh-secret"); // plaintext preserved
  assert.match(w.webhookSecretEnc ?? "", /^v1:/);
  assert.equal(w.credentialEncryptionVersion, 1);
  assert.equal(openSecret(w.webhookSecretEnc as string), "wh-secret"); // decrypts to original
});

// ─── Phase B dual-write: ERP API credentials ────────────────────────────────────

test("buildErpApiCredentialWrite (encryption DISABLED) writes plaintext only", () => {
  const w = buildErpApiCredentialWrite("api-key", "api-secret", false);
  assert.equal(w.erpApiKey, "api-key");
  assert.equal(w.erpApiSecret, "api-secret");
  assert.equal(w.erpApiKeyEnc, undefined);
  assert.equal(w.erpApiSecretEnc, undefined);
  assert.equal(w.credentialEncryptionVersion, undefined);
  assert.deepEqual(Object.keys(w).sort(), ["erpApiKey", "erpApiSecret"]);
});

test("buildErpApiCredentialWrite (encryption ENABLED) writes plaintext AND encrypted", () => {
  const w = buildErpApiCredentialWrite("api-key", "api-secret", true);
  assert.equal(w.erpApiKey, "api-key"); // plaintext preserved
  assert.equal(w.erpApiSecret, "api-secret");
  assert.match(w.erpApiKeyEnc ?? "", /^v1:/);
  assert.match(w.erpApiSecretEnc ?? "", /^v1:/);
  assert.equal(w.credentialEncryptionVersion, 1);
  assert.equal(openSecret(w.erpApiKeyEnc as string), "api-key");
  assert.equal(openSecret(w.erpApiSecretEnc as string), "api-secret");
});

test("dual-write ENABLED without a key throws safely (no partial write)", () => {
  const original = process.env.ERP_CREDENTIAL_ENCRYPTION_KEY;
  delete process.env.ERP_CREDENTIAL_ENCRYPTION_KEY;
  try {
    assert.throws(() => buildErpApiCredentialWrite("k", "s", true));
    assert.throws(() => buildWebhookSecretWrite("w", true));
  } finally {
    process.env.ERP_CREDENTIAL_ENCRYPTION_KEY = original;
  }
});

test("dual-write helpers perform no logging", () => {
  const orig = console.log;
  let calls = 0;
  console.log = () => { calls += 1; };
  try {
    buildWebhookSecretWrite("w", true);
    buildErpApiCredentialWrite("k", "s", true);
    buildWebhookSecretWrite("w", false);
  } finally {
    console.log = orig;
  }
  assert.equal(calls, 0);
});
