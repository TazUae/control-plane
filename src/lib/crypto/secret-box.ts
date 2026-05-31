import crypto from "node:crypto";

// H1: authenticated symmetric encryption for credentials at rest.
// Format: `v1:<iv_b64>:<tag_b64>:<ciphertext_b64>` (AES-256-GCM, 12-byte IV, 16-byte tag).
// The key is read lazily from ERP_CREDENTIAL_ENCRYPTION_KEY (base64 of 32 bytes) so this
// module is usable without the key present until a seal/open is actually performed.
// This module performs NO logging.

const VERSION = "v1";
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;

function getKey(): Buffer {
  const raw = process.env.ERP_CREDENTIAL_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error("ERP_CREDENTIAL_ENCRYPTION_KEY is not set");
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== KEY_BYTES) {
    throw new Error("ERP_CREDENTIAL_ENCRYPTION_KEY must be base64 of exactly 32 bytes");
  }
  return key;
}

/** Encrypt a plaintext secret. Returns a versioned, self-describing ciphertext string. */
export function sealSecret(plaintext: string): string {
  const key = getKey();
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${VERSION}:${iv.toString("base64")}:${tag.toString("base64")}:${ct.toString("base64")}`;
}

/** Reverse of sealSecret. Throws on missing/invalid key, malformed input, or tampering. */
export function openSecret(ciphertext: string): string {
  const parts = ciphertext.split(":");
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new Error("Malformed or unsupported ciphertext");
  }
  const iv = Buffer.from(parts[1], "base64");
  const tag = Buffer.from(parts[2], "base64");
  const ct = Buffer.from(parts[3], "base64");
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
    throw new Error("Malformed ciphertext components");
  }
  const key = getKey();
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  // final() throws if the auth tag does not verify (tampering or wrong key).
  const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
  return pt.toString("utf8");
}
