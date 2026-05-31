import test from "node:test";
import assert from "node:assert/strict";

process.env.ERP_CREDENTIAL_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");

import {
  planTenantCredentialBackfill,
  buildTenantCredentialBackfillUpdate,
  summarizeCredentialBackfill,
  type BackfillTenant,
} from "./tenant-credential-backfill.js";
import { openSecret } from "./crypto/secret-box.js";

// A legacy tenant: plaintext present, no encrypted columns yet.
const legacy = (id: string): BackfillTenant => ({
  id,
  erpApiKey: `key-${id}`,
  erpApiSecret: `secret-${id}`,
  webhookSecret: `wh-${id}`,
  erpApiKeyEnc: null,
  erpApiSecretEnc: null,
  webhookSecretEnc: null,
  credentialEncryptionVersion: null,
});

test("(1) plan reports rows needing backfill (pure, no writes)", () => {
  const p = planTenantCredentialBackfill(legacy("t1"));
  assert.equal(p.tenantId, "t1");
  assert.equal(p.needsErpApiKeyEnc, true);
  assert.equal(p.needsErpApiSecretEnc, true);
  assert.equal(p.needsWebhookSecretEnc, true);
  assert.equal(p.hasAnyCredential, true);
  assert.equal(p.alreadyComplete, false);
  assert.equal(p.needsBackfill, true);
});

test("(2) fully-encrypted tenant is skipped (already complete)", () => {
  const t: BackfillTenant = {
    id: "t2",
    erpApiKey: "k", erpApiSecret: "s", webhookSecret: "w",
    erpApiKeyEnc: "v1:a", erpApiSecretEnc: "v1:b", webhookSecretEnc: "v1:c",
    credentialEncryptionVersion: 1,
  };
  const p = planTenantCredentialBackfill(t);
  assert.equal(p.needsBackfill, false);
  assert.equal(p.alreadyComplete, true);
  assert.equal(buildTenantCredentialBackfillUpdate(t), null);
});

test("(3) partial row: only the missing encrypted field is filled", () => {
  const t: BackfillTenant = {
    id: "t3",
    erpApiKey: "k", erpApiSecret: "s", webhookSecret: "w",
    erpApiKeyEnc: "v1:already", // present -> must NOT be overwritten
    erpApiSecretEnc: null,
    webhookSecretEnc: null,
    credentialEncryptionVersion: 1,
  };
  const update = buildTenantCredentialBackfillUpdate(t);
  assert.ok(update);
  assert.equal(update.erpApiKeyEnc, undefined, "existing encrypted field must not be overwritten");
  assert.match(update.erpApiSecretEnc ?? "", /^v1:/);
  assert.match(update.webhookSecretEnc ?? "", /^v1:/);
  assert.equal(update.credentialEncryptionVersion, 1);
});

test("(4) update never contains plaintext fields", () => {
  const update = buildTenantCredentialBackfillUpdate(legacy("t4"));
  assert.ok(update);
  const allowed = new Set(["erpApiKeyEnc", "erpApiSecretEnc", "webhookSecretEnc", "credentialEncryptionVersion"]);
  for (const k of Object.keys(update)) {
    assert.ok(allowed.has(k), `unexpected key in update payload: ${k}`);
  }
});

test("(5) generated encrypted fields decrypt back to the originals", () => {
  const update = buildTenantCredentialBackfillUpdate(legacy("t5"));
  assert.ok(update);
  assert.equal(openSecret(update.erpApiKeyEnc as string), "key-t5");
  assert.equal(openSecret(update.erpApiSecretEnc as string), "secret-t5");
  assert.equal(openSecret(update.webhookSecretEnc as string), "wh-t5");
});

test("(6) missing encryption key fails safely (throws, no partial write)", () => {
  const original = process.env.ERP_CREDENTIAL_ENCRYPTION_KEY;
  delete process.env.ERP_CREDENTIAL_ENCRYPTION_KEY;
  try {
    assert.throws(() => buildTenantCredentialBackfillUpdate(legacy("t6")));
  } finally {
    process.env.ERP_CREDENTIAL_ENCRYPTION_KEY = original;
  }
});

test("(7) summary contains counts + IDs only, never credential values", () => {
  const tenants: BackfillTenant[] = [
    legacy("need-1"),
    legacy("need-2"),
    { id: "complete-1", erpApiKey: "k", erpApiKeyEnc: "v1:x", erpApiSecret: "s", erpApiSecretEnc: "v1:y", webhookSecret: "w", webhookSecretEnc: "v1:z" },
    { id: "empty-1" }, // no credentials at all
  ];
  const s = summarizeCredentialBackfill(tenants);
  assert.equal(s.totalScanned, 4);
  assert.equal(s.needingBackfill, 2);
  assert.equal(s.needingErpApiKeyEnc, 2);
  assert.equal(s.needingErpApiSecretEnc, 2);
  assert.equal(s.needingWebhookSecretEnc, 2);
  assert.equal(s.alreadyComplete, 1);
  assert.equal(s.skippedNoCredentials, 1);
  assert.deepEqual(s.tenantIdsNeedingBackfill.sort(), ["need-1", "need-2"]);
  // The summary must never carry credential material.
  const blob = JSON.stringify(s);
  for (const leak of ["key-need-1", "secret-need-1", "wh-need-1", "v1:"]) {
    assert.ok(!blob.includes(leak), `summary leaked credential material: ${leak}`);
  }
});

test("(8) idempotent: re-planning after encrypted fields exist is a no-op", () => {
  const t = legacy("t8");
  const update = buildTenantCredentialBackfillUpdate(t);
  assert.ok(update);
  // Simulate the row after the backfill write landed.
  const after: BackfillTenant = {
    ...t,
    erpApiKeyEnc: update.erpApiKeyEnc,
    erpApiSecretEnc: update.erpApiSecretEnc,
    webhookSecretEnc: update.webhookSecretEnc,
    credentialEncryptionVersion: update.credentialEncryptionVersion,
  };
  assert.equal(planTenantCredentialBackfill(after).needsBackfill, false);
  assert.equal(buildTenantCredentialBackfillUpdate(after), null);
});

test("(9) plaintext present but empty string is treated as no credential", () => {
  const t: BackfillTenant = { id: "t9", erpApiKey: "", erpApiSecret: "", webhookSecret: "" };
  const p = planTenantCredentialBackfill(t);
  assert.equal(p.hasAnyCredential, false);
  assert.equal(p.needsBackfill, false);
  assert.equal(buildTenantCredentialBackfillUpdate(t), null);
});
