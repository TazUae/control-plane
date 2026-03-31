import { pino } from "pino";
import { env } from "../config/env.js";

export const logger = pino({
  level: env.NODE_ENV === "production" ? "info" : "debug",
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers['x-api-key']",
      "req.headers['control-plane-api-key']",
      "databaseUrl",
      "redisUrl",
      "apiKey",
      "token",
      "password",
      "secret",
      "DATABASE_URL",
      "REDIS_URL",
      "CONTROL_PLANE_API_KEY",
    ],
    censor: "[REDACTED]",
  },
  ...(env.NODE_ENV === "development"
    ? {
        transport: {
          target: "pino-pretty",
          options: { colorize: true },
        },
      }
    : {}),
});
