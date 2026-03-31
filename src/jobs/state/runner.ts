import { prisma } from "../../lib/prisma.js";
import { steps } from "./steps.js";
import { logger } from "../../lib/logger.js";
import { createSite } from "../../lib/erp/erpnext.js";

const MAX_RETRIES = 3;

export async function runProvisioning(jobId: string) {
  const job = await prisma.provisioningJob.findUnique({
    where: { id: jobId },
    include: { tenant: true },
  });

  if (!job) throw new Error("Job not found");

  try {
    logger.info({ jobId, tenantId: job.tenant.id, slug: job.tenant.slug }, "Job started");

    await prisma.provisioningJob.update({
      where: { id: jobId },
      data: { status: "running" },
    });

    const completedSteps = await prisma.provisioningStepRun.findMany({
      where: { jobId, status: "completed" },
    });

    const completedSet = new Set(completedSteps.map(s => s.step));

    for (const step of steps) {
      if (completedSet.has(step)) {
        logger.info({ jobId, step }, "Skipping completed step");
        continue;
      }

      let attempt = 0;
      let success = false;

      while (attempt < MAX_RETRIES && !success) {
        attempt++;

        const stepStart = Date.now();

        try {
          logger.info({ jobId, step, attempt }, "Running step");

          await prisma.provisioningStepRun.create({
            data: {
              jobId,
              step,
              status: "running",
            },
          });

          // 🔥 REAL ERP INTEGRATION (ONLY STEP 1)
          if (step === "site_created") {
            const siteName = `${job.tenant.slug}.local`;
            await createSite(siteName);

            await prisma.tenant.update({
              where: { id: job.tenant.id },
              data: {
                erpSite: siteName,
              },
            });
          } else {
            // keep other steps simulated for now
            await new Promise((r) => setTimeout(r, 500));
          }

          await prisma.provisioningStepRun.updateMany({
            where: { jobId, step },
            data: {
              status: "completed",
              finishedAt: new Date(),
            },
          });

          const duration = Date.now() - stepStart;

          logger.info({ jobId, step, duration }, "Step completed");

          success = true;

        } catch (err) {
          logger.error({ jobId, step, attempt, err }, "Step failed");

          if (attempt >= MAX_RETRIES) {
            throw new Error(`Step failed permanently: ${step}`);
          }

          await new Promise((r) => setTimeout(r, 1000 * attempt));
        }
      }

      await prisma.provisioningJob.update({
        where: { id: jobId },
        data: { currentStep: step },
      });
    }

    logger.info({ jobId, tenantId: job.tenant.id }, "Job completed");

    await prisma.provisioningJob.update({
      where: { id: jobId },
      data: {
        status: "completed",
        finishedAt: new Date(),
      },
    });

  } catch (error) {
    logger.error({ jobId, tenantId: job.tenant.id, error }, "Job failed");

    await prisma.provisioningJob.update({
      where: { id: jobId },
      data: {
        status: "failed",
        failureReason: String(error),
      },
    });

    throw error;

  }
}
