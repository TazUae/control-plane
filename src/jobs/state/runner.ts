import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { Prisma, ProvisioningStatus, TenantStatus } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { StepRunStatus } from "../../lib/step-run-status.js";
import { writeAuditEvent } from "../../lib/audit.js";
import { steps } from "./steps.js";
import { logger } from "../../lib/logger.js";
import { getProvisioningAdapter } from "../../lib/provisioning/index.js";
import {
  getProvisioningFailureReason,
  isProvisioningError,
  ProvisioningError,
} from "../../lib/provisioning/errors.js";
import type { FitdeskPayload, SmokeTestPayload } from "../../lib/provisioning/interface.js";
import { assertValidSlugOrSite } from "../../lib/validation.js";
import { shouldRetryProvisioningError } from "./retry-policy.js";
import { env } from "../../config/env.js";
import type { ProvisioningCallContext } from "../../lib/provisioning/interface.js";
import { deriveFiscalYearName } from "../../lib/country-defaults.js";

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
            const adminPassword = crypto.randomBytes(32).toString("hex");
            const adminPasswordHash = await bcrypt.hash(adminPassword, 12);
            const result = await adapter.createSite(siteName, adminPassword, ctx);
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

            const tenantUpdate: { erpSite: string; erpDbName?: string; adminPasswordHash?: string } = {
              erpSite: siteName,
              adminPasswordHash,
            };
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
          } else if (step === "locale_configured") {
            if (tenant.country && tenant.defaultCurrency && tenant.timezone) {
              await adapter.setupLocale(
                siteName,
                {
                  country: tenant.country,
                  defaultCurrency: tenant.defaultCurrency,
                  timezone: tenant.timezone,
                  language: tenant.language,
                  dateFormat: tenant.dateFormat,
                  currencyPrecision: tenant.currencyPrecision,
                },
                ctx
              );
            } else {
              logger.warn(
                {
                  ...stepLog,
                  metric: "locale_configured_skipped",
                  value: 1,
                  country: tenant.country ?? null,
                  defaultCurrency: tenant.defaultCurrency ?? null,
                  timezone: tenant.timezone ?? null,
                },
                "locale_configured: tenant missing country/currency/timezone; step skipped (no locale data at creation time)"
              );
            }
          } else if (step === "company_created") {
            if (tenant.companyName && tenant.companyAbbr && tenant.country && tenant.defaultCurrency) {
              await adapter.setupCompany(
                siteName,
                {
                  companyName: tenant.companyName,
                  companyAbbr: tenant.companyAbbr,
                  country: tenant.country,
                  defaultCurrency: tenant.defaultCurrency,
                },
                ctx
              );
            } else {
              logger.warn(
                {
                  ...stepLog,
                  metric: "company_created_skipped",
                  value: 1,
                  companyName: tenant.companyName ?? null,
                  companyAbbr: tenant.companyAbbr ?? null,
                },
                "company_created: tenant missing companyName/companyAbbr; step skipped"
              );
            }
          } else if (step === "fiscal_year_created") {
            if (tenant.companyName) {
              await adapter.setupFiscalYear(
                siteName,
                {
                  companyName: tenant.companyName,
                  fiscalYearStartMonth: tenant.fiscalYearStartMonth,
                  companyAbbr: tenant.companyAbbr ?? "",
                },
                ctx
              );
            } else {
              logger.warn(
                { ...stepLog, metric: "fiscal_year_created_skipped", value: 1 },
                "fiscal_year_created: tenant missing companyName; step skipped"
              );
            }
          } else if (step === "global_defaults_set") {
            if (tenant.companyName && tenant.defaultCurrency && tenant.country) {
              // Prefer the fiscalYearName stored at tenant creation time; fall back to
              // deriving it from fiscalYearStartMonth for older tenants that predate this field.
              const fyName = tenant.fiscalYearName ?? deriveFiscalYearName(tenant.fiscalYearStartMonth);
              await adapter.setupGlobalDefaults(
                siteName,
                {
                  companyName: tenant.companyName,
                  defaultCurrency: tenant.defaultCurrency,
                  fiscalYearName: fyName,
                  country: tenant.country,
                },
                ctx
              );
            } else {
              logger.warn(
                {
                  ...stepLog,
                  metric: "global_defaults_set_skipped",
                  value: 1,
                  companyName: tenant.companyName ?? null,
                  defaultCurrency: tenant.defaultCurrency ?? null,
                  country: tenant.country ?? null,
                },
                "global_defaults_set: tenant missing companyName/defaultCurrency/country; step skipped"
              );
            }
          } else if (step === "setup_completed") {
            if (tenant.companyName) {
              await adapter.setupComplete(
                siteName,
                { companyName: tenant.companyName },
                ctx
              );
            } else {
              logger.warn(
                { ...stepLog, metric: "setup_completed_skipped", value: 1 },
                "setup_completed: tenant missing companyName; step skipped"
              );
            }
          } else if (step === "regional_setup") {
            // Non-fatal: regional module may not exist for all countries.
            // Errors are swallowed here; the Python function itself never raises,
            // but transport errors (network, timeout) could still throw.
            if (tenant.country && tenant.companyName) {
              try {
                const regionalResult = await adapter.setupRegional(
                  siteName,
                  {
                    country: tenant.country,
                    companyName: tenant.companyName,
                    companyAbbr: tenant.companyAbbr ?? "",
                  },
                  ctx
                );
                logger.info(
                  { ...stepLog, stdout: regionalResult.stdout },
                  "regional_setup completed (non-fatal)"
                );
              } catch (regionalError) {
                logger.warn(
                  {
                    ...stepLog,
                    err: regionalError instanceof Error ? regionalError.message : String(regionalError),
                    metric: "regional_setup_failed",
                    value: 1,
                  },
                  "regional_setup failed (non-fatal, continuing)"
                );
              }
            } else {
              logger.warn(
                { ...stepLog, metric: "regional_setup_skipped", value: 1 },
                "regional_setup: tenant missing country/companyName; step skipped"
              );
            }
          } else if (step === "domains_activated") {
            // Non-fatal: domain/module activation failures must not block provisioning.
            if (tenant.companyName) {
              try {
                const domainsResult = await adapter.setupDomains(
                  siteName,
                  { companyName: tenant.companyName },
                  ctx
                );
                logger.info(
                  { ...stepLog, stdout: domainsResult.stdout },
                  "domains_activated completed (non-fatal)"
                );
              } catch (domainsError) {
                logger.warn(
                  {
                    ...stepLog,
                    err: domainsError instanceof Error ? domainsError.message : String(domainsError),
                    metric: "domains_activated_failed",
                    value: 1,
                  },
                  "domains_activated failed (non-fatal, continuing)"
                );
              }
            } else {
              logger.warn(
                { ...stepLog, metric: "domains_activated_skipped", value: 1 },
                "domains_activated: tenant missing companyName; step skipped"
              );
            }
          } else if (step === "fitdesk_configured") {
            // Non-fatal: FitDesk schema setup failure must not block tenant activation.
            if (tenant.companyName) {
              try {
                // Lazily generate a per-tenant webhook secret on first provisioning.
                let webhookSecret = tenant.webhookSecret;
                if (!webhookSecret) {
                  webhookSecret = crypto.randomBytes(32).toString("hex");
                  await prisma.tenant.update({
                    where: { id: tenant.id },
                    data: { webhookSecret },
                  });
                  tenant = { ...tenant, webhookSecret };
                  logger.info({ ...stepLog }, "Generated and stored webhook secret for tenant");
                }

                const fitdeskPayload: FitdeskPayload = {
                  companyName: tenant.companyName,
                  companyAbbr: tenant.companyAbbr ?? "",
                  ...(env.CONTROL_PLANE_PUBLIC_URL
                    ? {
                        controlPlaneWebhookUrl: `${env.CONTROL_PLANE_PUBLIC_URL}/webhooks/invoice-submitted`,
                        controlPlaneWebhookSecret: webhookSecret,
                      }
                    : {}),
                };
                const fitdeskResult = await adapter.setupFitdesk(siteName, fitdeskPayload, ctx);
                logger.info(
                  { ...stepLog, stdout: fitdeskResult.stdout },
                  "fitdesk_configured completed (non-fatal)"
                );
              } catch (fitdeskError) {
                logger.warn(
                  {
                    ...stepLog,
                    err: fitdeskError instanceof Error ? fitdeskError.message : String(fitdeskError),
                    metric: "fitdesk_configured_failed",
                    value: 1,
                  },
                  "fitdesk_configured failed (non-fatal, continuing)"
                );
              }
            } else {
              logger.warn(
                { ...stepLog, metric: "fitdesk_configured_skipped", value: 1 },
                "fitdesk_configured: tenant missing companyName; step skipped"
              );
            }
          } else if (step === "app_installed_fitdesk") {
            await adapter.installFitdesk(siteName, ctx);
          } else if (step === "api_keys_generated") {
            const apiResult = await adapter.createApiUser(siteName, ctx);
            // Sync the full role set — non-fatal so credential storage always proceeds.
            try {
              const rolesResult = await adapter.setupRoles(siteName, ctx);
              logger.info(
                { ...stepLog, stdout: rolesResult.stdout },
                "setupRoles completed (non-fatal)"
              );
            } catch (rolesError) {
              logger.warn(
                {
                  ...stepLog,
                  err: rolesError instanceof Error ? rolesError.message : String(rolesError),
                  metric: "setup_roles_failed",
                  value: 1,
                },
                "setupRoles failed (non-fatal, continuing)"
              );
            }
            if (apiResult.apiKey && apiResult.apiSecret) {
              await prisma.tenant.update({
                where: { id: tenant.id },
                data: { erpApiKey: apiResult.apiKey, erpApiSecret: apiResult.apiSecret },
              });
              logger.info({ ...stepLog }, "ERP API credentials persisted");
              tenant = { ...tenant, erpApiKey: apiResult.apiKey, erpApiSecret: apiResult.apiSecret };
            } else {
              logger.warn({ ...stepLog }, "createApiUser completed but no API credentials returned; ERP proxy will not work until re-provisioned");
            }
          } else if (step === "warmup_completed") {
            await adapter.healthCheck(siteName, ctx);
          } else if (step === "smoke_test_passed") {
            // Non-fatal: smoke test failure must not block the tenant from being marked active.
            if (tenant.erpApiKey && tenant.erpApiSecret && tenant.companyName) {
              try {
                const smokePayload: SmokeTestPayload = {
                  companyName: tenant.companyName,
                  apiKey: tenant.erpApiKey,
                  apiSecret: tenant.erpApiSecret,
                };
                const smokeResult = await adapter.runSmokeTest(siteName, smokePayload, ctx);
                logger.info(
                  { ...stepLog, stdout: smokeResult.stdout },
                  "smoke_test_passed completed"
                );
              } catch (smokeError) {
                logger.warn(
                  {
                    ...stepLog,
                    err: smokeError instanceof Error ? smokeError.message : String(smokeError),
                    metric: "smoke_test_failed",
                    value: 1,
                  },
                  "smoke_test_passed failed (non-fatal, continuing)"
                );
              }
            } else {
              logger.warn(
                { ...stepLog, metric: "smoke_test_skipped", value: 1 },
                "smoke_test_passed: tenant missing API credentials or companyName; step skipped"
              );
            }
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
              error: getProvisioningFailureReason(typedError),
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

    const failureReason = getProvisioningFailureReason(typedError);

    await prisma.provisioningJob.update({
      where: { id: jobId },
      data: {
        status: ProvisioningStatus.failed,
        failureReason,
        result: toProvisioningJobResultJson(typedError),
      },
    });

    await prisma.tenant.update({
      where: { id: tenant.id },
      data: {
        status: TenantStatus.failed,
        lastError: failureReason,
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
