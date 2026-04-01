import { pino } from "pino";
import { env } from "../config/env.js";

export const loggerConfig = {
  level: env.NODE_ENV === "production" ? "info" : "debug",
  redact: {
    paths: ["req.headers.authorization", "authorization", "token", "password", "secret"],
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
};

export const logger = pino(loggerConfig);
