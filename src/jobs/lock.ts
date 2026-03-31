import { redis } from "../lib/redis.js";
import crypto from "node:crypto";

export async function acquireLock(
  key: string,
  ttlMs = 60_000
): Promise<{ acquired: boolean; token?: string }> {
  const token = crypto.randomUUID();
  const result = await redis.set(key, token, "PX", ttlMs, "NX");
  return result === "OK" ? { acquired: true, token } : { acquired: false };
}

export async function releaseLock(key: string, token: string): Promise<boolean> {
  const result = await redis.eval(
    `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("DEL", KEYS[1])
else
  return 0
end
`,
    1,
    key,
    token
  );
  return result === 1;
}
