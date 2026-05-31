import test from "node:test";
import assert from "node:assert/strict";

process.env.ERP_CREDENTIAL_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");

import { readTenantErpCredentials, buildEncryptedCredentialWrite } from "./tenant-credentials.js";
import { sealSecret } from "./crypto/secret-box.js";

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

test("falls back to plaintext when no encrypted fields (Phase A state)", () => {
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

test("buildEncryptedCredentialWrite seals provided values and sets version", () => {
  const w = buildEncryptedCredentialWrite({ erpApiKey: "K", webhookSecret: "W" });
  assert.equal(w.credentialEncryptionVersion, 1);
  assert.match(w.erpApiKeyEnc ?? "", /^v1:/);
  assert.equal(w.erpApiSecretEnc, undefined); // not provided -> skipped
  assert.match(w.webhookSecretEnc ?? "", /^v1:/);
});
