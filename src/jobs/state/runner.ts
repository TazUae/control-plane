import { prisma } from "../../lib/prisma.js";
import { steps } from "./steps.js";
import { logger } from "../../lib/logger.js";
import { getProvisioningAdapter } from "../../lib/provisioning/index.js";
import { isProvisioningError, ProvisioningError } from "../../lib/provisioning/errors.js";
import { assertValidSlugOrSite } from "../../lib/validation.js";
import { shouldRetryProvisioningError } from "./retry-policy.js";

const MAX_RETRIES = 3;

type RunProvisioningOptions = {
  queueJobId?: string;
};

function mapUnexpectedError(error: unknown): ProvisioningError {
  if (isProvisioningError(error)) {
    return error;
  }
  return new ProvisioningError("ERP_PARTIAL_SUCCESS", "Unexpected provisioning failure", {
    details: error instanceof Error ? error.message : String(error),
    cause: error,
    retryable: false,
  });
}

export async function runProvisioning(jobId: string, options: RunProvisioningOptions = {}) {
  const job = await prisma.provisioningJob.findUnique({
    where: { id: jobId },
    include: { tenant: true },
  });

  if (!job) throw new Error("Job not found");
  assertValidSlugOrSite(job.tenant.slug, "tenant.slug");
  const siteName = job.tenant.slug;
  const adapter = getProvisioningAdapter();
  const baseLog = {
    provisioningJobId: jobId,
    tenantId: job.tenant.id,
    queueJobId: options.queueJobId,
  };

  try {
    logger.info({ ...baseLog, slug: job.tenant.slug }, "Provisioning job started");

    await prisma.provisioningJob.update({
      where: { id: jobId },
      data: { status: "running" },
    });

    const completedSteps = await prisma.provisioningStepRun.findMany({
      where: { jobId, status: "completed" },
    });

    const completedSet = new Set(completedSteps.map((s: { step: string }) => s.step));

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
        const stepLog = { ...baseLog, step, attempt };

        try {
          logger.info(stepLog, "Provisioning step started");

          await prisma.provisioningStepRun.create({
            data: {
              jobId,
              step,
              status: "running",
            },
          });

          if (step === "site_created") {
            const result = await adapter.createSite(siteName);

            await prisma.tenant.update({
              where: { id: job.tenant.id },
              data: {
                erpSite: siteName,
              },
            });
            logger.info({ ...stepLog, adapterAction: result.action }, "Provisioning adapter action completed");
          } else if (step === "erp_installed") {
            await adapter.installErp(siteName);
          } else if (step === "scheduler_enabled") {
            await adapter.enableScheduler(siteName);
          } else if (step === "domain_registered") {
            await adapter.addDomain(siteName);
          } else if (step === "api_keys_generated") {
            await adapter.createApiUser(siteName);
          } else if (step === "warmup_completed") {
            await adapter.healthCheck(siteName);
          } else {
            throw new ProvisioningError("ERP_VALIDATION_FAILED", `Unknown provisioning step: ${step}`, {
              retryable: false,
            });
          }

          await prisma.provisioningStepRun.updateMany({
            where: { jobId, step },
            data: {
              status: "completed",
              finishedAt: new Date(),
            },
          });

          const duration = Date.now() - stepStart;

          logger.info({ ...stepLog, duration }, "Provisioning step succeeded");

          success = true;

        } catch (error) {
          const typedError = mapUnexpectedError(error);
          logger.error(
            {
              ...stepLog,
              errorCode: typedError.code,
              retryable: typedError.retryable,
              errorMessage: typedError.message,
              stderr: typedError.stderr,
              stdout: typedError.stdout,
            },
            "Provisioning step failed"
          );

          await prisma.provisioningStepRun.updateMany({
            where: { jobId, step, status: "running" },
            data: {
              status: "failed",
              finishedAt: new Date(),
              error: `${typedError.code}: ${typedError.message}`,
            },
          });

          if (!shouldRetryProvisioningError(typedError) || attempt >= MAX_RETRIES) {
            throw typedError;
          }

          await new Promise((r) => setTimeout(r, 1000 * attempt));
        }
      }

      await prisma.provisioningJob.update({
        where: { id: jobId },
        data: { currentStep: step },
      });
    }

    logger.info(baseLog, "Provisioning job completed");

    await prisma.provisioningJob.update({
      where: { id: jobId },
      data: {
        status: "completed",
        finishedAt: new Date(),
      },
    });

  } catch (error) {
    const typedError = mapUnexpectedError(error);
    logger.error(
      {
        ...baseLog,
        errorCode: typedError.code,
        retryable: typedError.retryable,
        errorMessage: typedError.message,
        stderr: typedError.stderr,
        stdout: typedError.stdout,
      },
      "Provisioning job failed"
    );

    await prisma.provisioningJob.update({
      where: { id: jobId },
      data: {
        status: "failed",
        failureReason: `${typedError.code}: ${typedError.message}`,
      },
    });

    throw typedError;

  }
}
