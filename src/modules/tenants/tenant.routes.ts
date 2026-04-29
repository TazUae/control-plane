import { ProvisioningStatus, TenantStatus } from "@prisma/client";
import { app } from "../../app.js";
import { prisma } from "../../lib/prisma.js";
import {
  idempotencyMiddleware,
  IdempotencyContext,
} from "../../middleware/idempotency.js";
import { acquireLock, releaseLock } from "../../jobs/lock.js";
import crypto from "crypto";
import { CreateTenantSchema, GetTenantParamsSchema } from "./tenant.schemas.js";
import { getTenantById } from "./tenant.service.js";
import { requireInternalApiKey } from "../../middleware/require-internal-api-key.js";
import { provisioningQueue } from "../../lib/queue.js";
import { logger } from "../../lib/logger.js";
import { writeAuditEvent } from "../../lib/audit.js";
import { getCountryDefaults, deriveFiscalYearName } from "../../lib/country-defaults.js";
import { getProvisioningAdapter } from "../../lib/provisioning/index.js";

app.get(
  "/tenants",
  { preHandler: [requireInternalApiKey] },
  async (_req, reply) => {
    const tenants = await prisma.tenant.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        slug: true,
        status: true,
        country: true,
        companyName: true,
        createdAt: true,
      },
    });
    return reply.send(tenants);
  }
);

app.post(
  "/tenants/:id/validate",
  { preHandler: [requireInternalApiKey] },
  async (req, reply) => {
    const parsed = GetTenantParamsSchema.safeParse(req.params ?? {});
    if (!parsed.success) {
      return reply.code(422).send({
        error: "Invalid request parameters",
        details: parsed.error.flatten(),
      });
    }

    const tenant = await prisma.tenant.findUnique({ where: { id: parsed.data.id } });
    if (!tenant) {
      return reply.code(404).send({ error: "Tenant not found" });
    }

    if (!tenant.erpApiKey || !tenant.erpApiSecret || !tenant.companyName) {
      return reply.code(422).send({
        error: "Tenant not yet fully provisioned (missing API credentials or company name)",
      });
    }

    const adapter = getProvisioningAdapter();
    const siteName = tenant.erpSite ?? tenant.slug;

    try {
      const result = await adapter.runSmokeTest(
        siteName,
        {
          companyName: tenant.companyName,
          apiKey: tenant.erpApiKey,
          apiSecret: tenant.erpApiSecret,
        },
        { tenantId: tenant.id }
      );
      return reply.send({ ok: true, smoke_test: "passed", stdout: result.stdout ?? null });
    } catch (error) {
      return reply.code(422).send({
        ok: false,
        smoke_test: "failed",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
);

app.get(
  "/tenants/:id",
  { preHandler: [requireInternalApiKey] },
  async (req, reply) => {
    const parsed = GetTenantParamsSchema.safeParse(req.params ?? {});
    if (!parsed.success) {
      return reply.code(422).send({
        error: "Invalid request parameters",
        details: parsed.error.flatten(),
      });
    }

    const tenant = await getTenantById(parsed.data.id);
    if (!tenant) {
      return reply.code(404).send({ error: "Tenant not found" });
    }

    return tenant;
  }
);

// GET /tenants/:id/erp-credentials — internal endpoint; returns raw ERP auth
// details for tooling and integration tests. Never exposed to end users.
app.get(
  "/tenants/:id/erp-credentials",
  { preHandler: [requireInternalApiKey] },
  async (req, reply) => {
    const parsed = GetTenantParamsSchema.safeParse(req.params ?? {});
    if (!parsed.success) {
      return reply.code(422).send({
        error: "Invalid request parameters",
        details: parsed.error.flatten(),
      });
    }
    const tenant = await prisma.tenant.findUnique({
      where: { id: parsed.data.id },
      select: {
        id: true,
        slug: true,
        erpSite: true,
        erpApiKey: true,
        erpApiSecret: true,
        webhookSecret: true,
      },
    });
    if (!tenant) {
      return reply.code(404).send({ error: "Tenant not found" });
    }
    if (!tenant.erpApiKey || !tenant.erpApiSecret || !tenant.erpSite) {
      return reply.code(503).send({ error: "ERP credentials not yet provisioned" });
    }
    return reply.send({
      erpSite: tenant.erpSite,
      erpApiKey: tenant.erpApiKey,
      erpApiSecret: tenant.erpApiSecret,
      webhookSecret: tenant.webhookSecret ?? null,
    });
  }
);

// DELETE /tenants/:id — removes DB records for a tenant and all related data.
// Does NOT deprovision the Frappe site; use the bench agent for that separately.
app.delete(
  "/tenants/:id",
  { preHandler: [requireInternalApiKey] },
  async (req, reply) => {
    const parsed = GetTenantParamsSchema.safeParse(req.params ?? {});
    if (!parsed.success) {
      return reply.code(422).send({
        error: "Invalid request parameters",
        details: parsed.error.flatten(),
      });
    }
    const tenant = await prisma.tenant.findUnique({ where: { id: parsed.data.id } });
    if (!tenant) {
      return reply.code(404).send({ error: "Tenant not found" });
    }

    const jobs = await prisma.provisioningJob.findMany({
      where: { tenantId: parsed.data.id },
      select: { id: true },
    });
    const jobIds = jobs.map((j) => j.id);

    await prisma.$transaction([
      prisma.provisioningStepRun.deleteMany({ where: { jobId: { in: jobIds } } }),
      prisma.provisioningJob.deleteMany({ where: { tenantId: parsed.data.id } }),
      prisma.tenantDomain.deleteMany({ where: { tenantId: parsed.data.id } }),
      prisma.tenant.delete({ where: { id: parsed.data.id } }),
    ]);

    return reply.code(204).send();
  }
);

function isPrismaUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "P2002"
  );
}

app.post(
  "/tenants",
  { preHandler: [requireInternalApiKey, idempotencyMiddleware] },
  async (req, reply) => {
    const requestId = String(req.id);
    const parsed = CreateTenantSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.code(422).send({
        error: "Invalid request body",
        details: parsed.error.flatten(),
      });
    }

    const { slug, plan, region, language, dateFormat, currencyPrecision, companyName, companyAbbr, country } = parsed.data;
    let { defaultCurrency, timezone, fiscalYearStartMonth } = parsed.data;

    // Derive locale fields from country defaults; caller-supplied values take precedence.
    const countryDefaults = getCountryDefaults(country);
    if (!defaultCurrency)               defaultCurrency        = countryDefaults.currency;
    if (!timezone)                      timezone               = countryDefaults.timezone;
    if (fiscalYearStartMonth === undefined) fiscalYearStartMonth = countryDefaults.fiscalYearStartMonth;

    const fiscalYearName      = deriveFiscalYearName(fiscalYearStartMonth);
    const regionalSetupModule = countryDefaults.regionalSetupModule ?? null;
    const idem = (req as typeof req & { idempotency?: IdempotencyContext }).idempotency;
    const lockKey = `tenant:${slug}:lock`;

    if (idem) {
      try {
        await (prisma.idempotencyKey as unknown as {
          create: (args: unknown) => Promise<unknown>;
        }).create({
          data: {
            id: crypto.randomUUID(),
            key: idem.key,
            payloadHash: idem.payloadHash,
            response: null,
          },
        });
      } catch (error) {
        if (isPrismaUniqueConstraintError(error)) {
          const existing = await prisma.idempotencyKey.findUnique({ where: { key: idem.key } });
          if (!existing) {
            return reply.code(409).send({ error: "Unable to reserve idempotency key" });
          }
          if ((existing as { payloadHash?: string }).payloadHash !== idem.payloadHash) {
            return reply.code(409).send({
              error: "Idempotency key already used with a different payload",
            });
          }
          const existingResponse = (existing as { response?: unknown }).response;
          if (existingResponse !== undefined && existingResponse !== null) {
            return reply.send(existingResponse);
          }
          return reply.code(409).send({
            error: "Request with this idempotency key is already in progress",
          });
        }
        throw error;
      }
    }

    const lock = await acquireLock(lockKey);
    if (!lock.acquired || !lock.token) {
      return reply.code(409).send({
        error: "Tenant provisioning already in progress",
      });
    }

    try {
      const result = await prisma.$transaction(async (tx: any) => {
        const tenant = await tx.tenant.create({
          data: {
            slug,
            plan,
            region,
            status: TenantStatus.provisioning,
            country,
            defaultCurrency,
            timezone,
            language,
            dateFormat,
            currencyPrecision,
            companyName,
            companyAbbr,
            fiscalYearStartMonth,
            fiscalYearName,
            regionalSetupModule,
          },
        });

        await tx.tenantDomain.create({
          data: {
            domain: `${slug}.erp.zaidan-group.com`,
            tenantId: tenant.id,
            isPrimary: true,
          },
        });

        const job = await tx.provisioningJob.create({
          data: {
            tenantId: tenant.id,
            status: ProvisioningStatus.queued,
            currentStep: "queued",
          },
        });

        return {
          tenantId: tenant.id,
          jobId: job.id,
          status: ProvisioningStatus.queued,
        };
      });

      if (!result.jobId) {
        throw new Error("Provisioning jobId missing before enqueue");
      }

      await Promise.all([
        writeAuditEvent({
          type: "tenant.created",
          tenantId: result.tenantId,
          payload: {
            entityId: result.tenantId,
            action: "tenant.created",
            metadata: { slug },
          },
        }),
        writeAuditEvent({
          type: "provisioning_job.created",
          tenantId: result.tenantId,
          payload: {
            entityId: result.jobId,
            action: "provisioning_job.created",
            metadata: { slug, tenantId: result.tenantId },
          },
        }),
      ]);

      logger.info(
        { requestId, provisioningJobId: result.jobId, tenantId: result.tenantId },
        "Provisioning queue enqueue started"
      );

      let queueJob: Awaited<ReturnType<typeof provisioningQueue.add>>;
      try {
        queueJob = await provisioningQueue.add(
          "provision",
          {
            jobId: result.jobId,
            tenantId: result.tenantId,
            slug,
            plan,
            region,
            requestId,
          },
          { attempts: 1 }
        );
      } catch (enqueueError) {
        const message =
          enqueueError instanceof Error ? enqueueError.message : String(enqueueError);
        logger.error(
          {
            err: enqueueError,
            requestId,
            provisioningJobId: result.jobId,
            tenantId: result.tenantId,
            slug,
          },
          `Provisioning queue enqueue failed: ${message}`
        );
        await prisma.provisioningJob.update({
          where: { id: result.jobId },
          data: {
            status: ProvisioningStatus.enqueue_failed,
            failureReason: message,
            result: { kind: "enqueue_failed", message },
          },
        });
        return reply.code(503).send({
          error: "Provisioning job could not be queued; the tenant was created and can be recovered manually",
          tenantId: result.tenantId,
          jobId: result.jobId,
          status: ProvisioningStatus.enqueue_failed,
        });
      }

      logger.info(
        {
          requestId,
          provisioningJobId: result.jobId,
          tenantId: result.tenantId,
          queueJobId: queueJob.id,
        },
        "Provisioning queue enqueue succeeded"
      );

      if (idem) {
        await prisma.idempotencyKey.update({
          where: { key: idem.key },
          data: {
            response: {
              tenantId: result.tenantId,
              jobId: result.jobId,
              queueJobId: queueJob.id,
              status: ProvisioningStatus.queued,
            },
          },
        });
      }

      return {
        tenantId: result.tenantId,
        jobId: result.jobId,
        queueJobId: queueJob.id,
        status: ProvisioningStatus.queued,
        slug,
        country,
        defaultCurrency,
        timezone,
        fiscalYearStartMonth,
        fiscalYearName,
      };
    } catch (error) {
      if (idem) {
        await prisma.idempotencyKey.deleteMany({
          where: {
            key: idem.key,
          } as any,
        });
      }

      if (isPrismaUniqueConstraintError(error)) {
        return reply.code(409).send({ error: "Tenant with this slug already exists" });
      }

      throw error;
    } finally {
      await releaseLock(lockKey, lock.token);
    }
  }
);
