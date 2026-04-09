import crypto from "node:crypto";
import { Prisma, ProvisioningStatus, TenantStatus } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { StepRunStatus } from "../../lib/step-run-status.js";
import { writeAuditEvent } from "../../lib/audit.js";
import { steps } from "./steps.js";
import { logger } from "../../lib/logger.js";
import { getProvisioningAdapter } from "../../lib/provisioning/index.js";
import { isProvisioningError, ProvisioningError } from "../../lib/provisioning/errors.js";
import { assertValidSlugOrSite } from "../../lib/validation.js";
import { shouldRetryProvisioningError } from "./retry-policy.js";
import { env } from "../../config/env.js";
import type { ProvisioningCallContext } from "../../lib/provisioning/interface.js";

const MAX_RETRIES = 3;

type RunProvisioningOptions = {
  queueJobId?: string;
  /** Correlation id from API (propagated to provisioning-agent and logs). */
  requestId?: string;
};

function mapUnexpectedError(error: unknown): ProvisioningError {
  if (isProvisioningError(error)) {
    return error;
  }
  return new ProvisioningError("ERP_PARTIAL_SUCCESS", "Unexpected provisioning failure", {
    details: error instanceof Error ? error.message : String(error),
    cause: error,
    raw: error,
    retryable: false,
  });
}

/** Serializable JSON for `ProvisioningJob.result` (agent envelope or structured error). */
function toProvisioningJobResultJson(error: unknown): Prisma.InputJsonValue {
  if (isProvisioningError(error)) {
    const base =
      error.raw !== undefined
        ? error.raw
        : {
            name: error.name,
            code: error.code,
            message: error.message,
            details: error.details,
            stdout: error.stdout,
            stderr: error.stderr,
            exitCode: error.exitCode,
            retryable: error.retryable,
          };
    try {
      return JSON.parse(JSON.stringify(base)) as Prisma.InputJsonValue;
    } catch {
      return { message: String(base) };
    }
  }
  if (error instanceof Error) {
    try {
      return JSON.parse(
        JSON.stringify({
          name: error.name,
          message: error.message,
          stack: error.stack,
        })
      ) as Prisma.InputJsonValue;
    } catch {
      return { message: error.message };
    }
  }
  try {
    return JSON.parse(JSON.stringify({ value: error })) as Prisma.InputJsonValue;
  } catch {
    return { value: String(error) };
  }
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
  let tenant = job.tenant;
  const ctx: ProvisioningCallContext = {
    requestId: options.requestId,
    tenantId: tenant.id,
  };
  const baseLog = {
    provisioningJobId: jobId,
    tenantId: tenant.id,
    queueJobId: options.queueJobId,
    requestId: options.requestId,
    adapter: adapter.kind,
  };

  try {
    logger.info({ ...baseLog, slug: tenant.slug }, "Provisioning job started");

    if (!tenant.erpDbName && adapter.resolveSiteDbName) {
      const siteForResolve = tenant.erpSite ?? tenant.slug;
      try {
        const resolved = await adapter.resolveSiteDbName(siteForResolve, ctx);
        const db = resolved.dbName?.trim();
        if (db) {
          await prisma.tenant.update({
            where: { id: tenant.id },
            data: { erpDbName: db },
          });
          logger.info({ ...baseLog, slug: tenant.slug, erpDbName: db }, "dbName persisted (lazy backfill)");
          tenant = { ...tenant, erpDbName: db };
        }
      } catch (error) {
        logger.warn(
          { ...baseLog, err: error instanceof Error ? error.message : String(error) },
          "lazy dbName backfill failed"
        );
      }
    }

    await prisma.provisioningJob.update({
      where: { id: jobId },
      data: { status: ProvisioningStatus.running },
    });

    const completedSteps = await prisma.provisioningStepRun.findMany({
      where: { jobId, status: StepRunStatus.Completed },
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

          await prisma.provisioningStepRun.upsert({
            where: { jobId_step: { jobId, step } },
            create: {
              id: crypto.randomUUID(),
              jobId,
              step,
              status: StepRunStatus.Running,
              startedAt: new Date(),
            },
            update: {
              status: StepRunStatus.Running,
              startedAt: new Date(),
              finishedAt: null,
              error: null,
            },
          });

          await prisma.provisioningJob.update({
            where: { id: jobId },
            data: { currentStep: step },
          });

          if (step === "site_created") {
            const result = await adapter.createSite(siteName, ctx);
            let dbName = result.dbName?.trim();

            if (!dbName && adapter.resolveSiteDbName) {
              try {
                const res = await adapter.resolveSiteDbName(siteName, ctx);
                dbName = res.dbName?.trim();
              } catch (error) {
                logger.warn(
                  { ...stepLog, err: error instanceof Error ? error.message : String(error) },
                  "resolveSiteDbName failed after createSite"
                );
              }
            }

            const existingRow = await prisma.tenant.findUnique({ where: { id: tenant.id } });
            const existingDb = existingRow?.erpDbName ?? null;

            const tenantUpdate: { erpSite: string; erpDbName?: string } = { erpSite: siteName };
            if (dbName) {
              if (!existingDb || existingDb === dbName) {
                tenantUpdate.erpDbName = dbName;
              } else {
                logger.warn(
                  {
                    ...stepLog,
                    existingDb,
                    incomingDb: dbName,
                    metric: "provisioning_dbname_conflict",
                    value: 1,
                  },
                  "dbName conflict; refusing overwrite"
                );
              }
            }

            await prisma.tenant.update({
              where: { id: tenant.id },
              data: tenantUpdate,
            });

            if (dbName && (!existingDb || existingDb === dbName)) {
              logger.info(
                { ...stepLog, dbName, metric: "dbName_persisted" },
                "dbName persisted"
              );
            } else if (!dbName) {
              logger.warn(
                { ...stepLog, metric: "provisioning_dbname_missing", value: 1 },
                "site created but ERP dbName not resolved; check provisioning-agent / ERP"
              );
            }

            tenant = {
              ...tenant,
              erpSite: siteName,
              ...(tenantUpdate.erpDbName ? { erpDbName: tenantUpdate.erpDbName } : {}),
            };

            logger.info({ ...stepLog, adapterAction: result.action }, "Provisioning adapter action completed");
          } else if (step === "erp_installed") {
            await adapter.installErp(siteName, ctx);
          } else if (step === "scheduler_enabled") {
            await adapter.enableScheduler(siteName, ctx);
          } else if (step === "domain_registered") {
            await adapter.addDomain(siteName, ctx);
          } else if (step === "api_keys_generated") {
            await adapter.createApiUser(siteName, ctx);
          } else if (step === "warmup_completed") {
            await adapter.healthCheck(siteName, ctx);
          } else {
            throw new ProvisioningError("ERP_VALIDATION_FAILED", `Unknown provisioning step: ${step}`, {
              retryable: false,
            });
          }

          await prisma.provisioningStepRun.update({
            where: { jobId_step: { jobId, step } },
            data: {
              status: StepRunStatus.Completed,
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
              status: StepRunStatus.Failed,
              finishedAt: new Date(),
              error: typedError.message || "Unknown error",
            },
          });

          if (!shouldRetryProvisioningError(typedError) || attempt >= MAX_RETRIES) {
            throw typedError;
          }

          await new Promise((r) => setTimeout(r, 1000 * attempt));
        }
      }
    }

    const finalTenant = await prisma.tenant.findUnique({ where: { id: tenant.id } });
    if (!finalTenant?.erpDbName?.trim()) {
      logger.error(
        { ...baseLog, slug: finalTenant?.slug, metric: "provisioning_dbname_missing", value: 1 },
        "Final validation failed: tenant erpDbName missing after provisioning"
      );
      throw new ProvisioningError("ERP_PARTIAL_SUCCESS", "ERP database name was not persisted for tenant", {
        retryable: true,
      });
    }

    if (env.PROVISIONING_VALIDATE_ERP_DB_ON_COMPLETE && adapter.resolveSiteDbName) {
      const siteForResolve = finalTenant.erpSite ?? finalTenant.slug;
      const resolved = await adapter.resolveSiteDbName(siteForResolve, ctx);
      const remoteDb = resolved.dbName?.trim();
      if (!remoteDb || remoteDb !== finalTenant.erpDbName) {
        logger.error(
          {
            ...baseLog,
            slug: finalTenant.slug,
            stored: finalTenant.erpDbName,
            remote: remoteDb,
            metric: "provisioning_dbname_conflict",
            value: 1,
          },
          "Final validation failed: remote db_name mismatch"
        );
        throw new ProvisioningError("ERP_PARTIAL_SUCCESS", "ERP database name mismatch on final validation", {
          retryable: true,
        });
      }
    }

    logger.info(
      { ...baseLog, slug: finalTenant.slug, erpDbName: finalTenant.erpDbName },
      "tenant fully provisioned with db"
    );

    await prisma.provisioningJob.update({
      where: { id: jobId },
      data: {
        status: ProvisioningStatus.completed,
        finishedAt: new Date(),
        failureReason: null,
        result: Prisma.DbNull,
      },
    });

    await prisma.tenant.update({
      where: { id: tenant.id },
      data: {
        status: TenantStatus.active,
        lastError: null,
      },
    });

  } catch (error) {
    const typedError = mapUnexpectedError(error);
    console.error("❌ PROVISIONING FAILED:", error);
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
        status: ProvisioningStatus.failed,
        failureReason: typedError.message || "Unknown error",
        result: toProvisioningJobResultJson(typedError),
      },
    });

    await prisma.tenant.update({
      where: { id: tenant.id },
      data: {
        status: TenantStatus.failed,
        lastError: error instanceof Error ? error.message : typedError.message,
      },
    });

    await writeAuditEvent({
      type: "provisioning_job.completed",
      tenantId: tenant.id,
      payload: {
        entityId: jobId,
        action: "provisioning_job.completed",
        metadata: { success: false, errorCode: typedError.code },
      },
    });

    throw typedError;

  }
}
