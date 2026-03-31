import Fastify from "fastify";
import crypto from "node:crypto";
import { prisma } from "./lib/prisma.js";
import { redis } from "./lib/redis.js";

export const app = Fastify({
  logger: true,
  genReqId: (req) => (req.headers["x-request-id"] as string | undefined) ?? crypto.randomUUID(),
});

app.get("/health", async () => {
  const checks = {
    db: "ok" as "ok" | "down",
    redis: "ok" as "ok" | "down",
  };

  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    checks.db = "down";
  }

  try {
    await redis.ping();
  } catch {
    checks.redis = "down";
  }

  const ok = checks.db === "ok" && checks.redis === "ok";
  return {
    status: ok ? "ok" : "degraded",
    checks,
  };
});
