import Fastify from "fastify";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import crypto from "node:crypto";
import { prisma } from "./lib/prisma.js";
import { redis } from "./lib/redis.js";

// App-level request body size cap (bytes). Default 1 MiB; override via BODY_LIMIT_BYTES.
const BODY_LIMIT_BYTES = Number(process.env.BODY_LIMIT_BYTES) || 1_048_576;

export const app = Fastify({
  logger: true,
  bodyLimit: BODY_LIMIT_BYTES,
  genReqId: (req) => (req.headers["x-request-id"] as string | undefined) ?? crypto.randomUUID(),
});

// Security middleware. These MUST be awaited: @fastify/rate-limit installs an `onRoute`
// hook that only throttles routes registered AFTER it loads. Routes are registered via
// side-effect imports after this module evaluates, so a non-awaited register would leave
// them unthrottled. helmet sets standard security response headers.
await app.register(helmet);
await app.register(rateLimit, {
  max: Number(process.env.RATE_LIMIT_MAX) || 100,
  timeWindow: process.env.RATE_LIMIT_TIME_WINDOW || "1 minute",
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
