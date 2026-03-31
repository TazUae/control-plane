import { app } from "./app.js";
import "./modules/tenants/tenant.routes.js";
import { env } from "./config/env.js";
import { logger } from "./lib/logger.js";
import { prisma } from "./lib/prisma.js";
import { redis } from "./lib/redis.js";

const port = env.PORT;

let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  logger.info({ signal }, "Shutdown started");
  try {
    await app.close();
    await prisma.$disconnect();
    await redis.quit();
    logger.info("Shutdown complete");
    process.exit(0);
  } catch (error) {
    logger.error({ error }, "Shutdown failed");
    process.exit(1);
  }
}

process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});
process.on("SIGINT", () => {
  void shutdown("SIGINT");
});

app.listen({ port, host: "0.0.0.0" })
  .then(() => {
    logger.info({ port }, "Control Plane API started");
  })
  .catch((err) => {
    logger.error({ err }, "API startup failed");
    process.exit(1);
  });
