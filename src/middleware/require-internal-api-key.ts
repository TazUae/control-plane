import crypto from "node:crypto";
import { env } from "../config/env.js";

/**
 * Constant-time string comparison. Hashing both inputs to a fixed-length SHA-256
 * digest before `crypto.timingSafeEqual` avoids both the early-exit timing oracle
 * of `===`/`!==` and the length leak of comparing the raw buffers directly.
 */
function safeEqual(a: string, b: string): boolean {
  const ah = crypto.createHash("sha256").update(a, "utf8").digest();
  const bh = crypto.createHash("sha256").update(b, "utf8").digest();
  return crypto.timingSafeEqual(ah, bh);
}

export async function requireInternalApiKey(
  req: any,
  reply: any
): Promise<void> {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) {
    void reply.code(401).send({ error: "Missing Bearer token" });
    return;
  }

  const token = auth.slice("Bearer ".length).trim();
  if (!token) {
    void reply.code(401).send({ error: "Missing Bearer token" });
    return;
  }

  if (!safeEqual(token, env.CONTROL_PLANE_API_KEY)) {
    void reply.code(403).send({ error: "Invalid API key" });
    return;
  }
}
