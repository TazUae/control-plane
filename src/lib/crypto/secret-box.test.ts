import test from "node:test";
import assert from "node:assert/strict";

// secret-box reads the key lazily from process.env, so set a deterministic test key.
process.env.ERP_CREDENTIAL_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");

import { sealSecret, openSecret } from "./secret-box.js";

test("round-trips a secret (ciphertext differs from plaintext, v1 format)", () => {
  const sealed = sealSecret("super-secret-api-key");
  assert.notEqual(sealed, "super-secret-api-key");
  assert.match(sealed, /^v1:/);
  assert.equal(openSecret(sealed), "super-secret-api-key");
});

test("round-trips an empty string", () => {
  assert.equal(openSecret(sealSecret("")), "");
});

test("tamper detection: a corrupted ciphertext fails to open", () => {
  const parts = sealSecret("x").split(":");
  const tampered = `${parts[0]}:${parts[1]}:${parts[2]}:${Buffer.from("tampered-ct").toString("base64")}`;
  assert.throws(() => openSecret(tampered));
});

test("wrong key fails to open", () => {
  const sealed = sealSecret("y");
  const original = process.env.ERP_CREDENTIAL_ENCRYPTION_KEY;
  process.env.ERP_CREDENTIAL_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");
  try {
    assert.throws(() => openSecret(sealed));
  } finally {
    process.env.ERP_CREDENTIAL_ENCRYPTION_KEY = original;
  }
});

test("malformed / unsupported-version ciphertext is rejected", () => {
  assert.throws(() => openSecret("v2:a:b:c"));
  assert.throws(() => openSecret("not-a-ciphertext"));
});

test("missing key throws when sealing", () => {
  const original = process.env.ERP_CREDENTIAL_ENCRYPTION_KEY;
  delete process.env.ERP_CREDENTIAL_ENCRYPTION_KEY;
  try {
    assert.throws(() => sealSecret("z"));
  } finally {
    process.env.ERP_CREDENTIAL_ENCRYPTION_KEY = original;
  }
});

test("performs no logging during seal/open", () => {
  const orig = console.log;
  let calls = 0;
  console.log = () => { calls += 1; };
  try {
    openSecret(sealSecret("leaky-secret"));
  } finally {
    console.log = orig;
  }
  assert.equal(calls, 0);
});
