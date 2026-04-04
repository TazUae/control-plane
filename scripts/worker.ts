import { Worker } from "bullmq";
import { redis } from "../src/lib/redis.js";
import { runProvisioning } from "../src/jobs/state/runner.js";
import { logger } from "../src/lib/logger.js";
import { TENANT_PROVISIONING_QUEUE } from "../src/lib/constants.js";
import { prisma } from "../src/lib/prisma.js";

const worker = new Worker(
  TENANT_PROVISIONING_QUEUE,
  async (job) => {
    logger.info(
      {
        queue: TENANT_PROVISIONING_QUEUE,
        queueJobId: job.id,
        provisioningJobId: job.data?.jobId,
        tenantId: job.data?.tenantId,
        requestId: job.data?.requestId,
      },
      "Worker received job"
    );
    await runProvisioning(job.data.jobId, {
      queueJobId: job.id?.toString(),
      requestId: typeof job.data?.requestId === "string" ? job.data.requestId : undefined,
    });
  },
  { connection: redis }
);

worker.on("ready", () => {
  logger.info({ queue: TENANT_PROVISIONING_QUEUE }, "Worker started");
});

worker.on("failed", (job, err) => {
  logger.error({ jobId: job?.id, err }, "Worker job failed");
});

let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  logger.info({ signal }, "Worker shutdown started");
  try {
    await worker.close();
    await prisma.$disconnect();
    await redis.quit();
    logger.info("Worker shutdown complete");
    process.exit(0);
  } catch (error) {
    logger.error({ error }, "Worker shutdown failed");
    process.exit(1);
  }
}

process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});
process.on("SIGINT", () => {
  void shutdown("SIGINT");
});
