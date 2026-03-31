import { app } from "../../app.js";
import { prisma } from "../../lib/prisma.js";
import { provisioningQueue } from "../../lib/queue.js";
import {
  idempotencyMiddleware,
  IdempotencyContext,
} from "../../middleware/idempotency.js";
import { acquireLock, releaseLock } from "../../jobs/lock.js";
import crypto from "crypto";
import { CreateTenantSchema } from "./tenant.schemas.js";
import { requireInternalApiKey } from "../../middleware/require-internal-api-key.js";

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
    const parsed = CreateTenantSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.code(422).send({
        error: "Invalid request body",
        details: parsed.error.flatten(),
      });
    }

    const { slug, plan, region } = parsed.data;
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
            status: "provisioning",
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
            status: "queued",
            currentStep: "queued",
          },
        });

        return {
          tenantId: tenant.id,
          jobId: job.id,
          status: "queued" as const,
        };
      });

      await provisioningQueue.add("provision-tenant", { jobId: result.jobId });

      if (idem) {
        await prisma.idempotencyKey.update({
          where: { key: idem.key },
          data: { response: result },
        });
      }

      return result;
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
