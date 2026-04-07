import { app } from "../../app.js";
import { GetJobParamsSchema } from "./job.schemas.js";
import { getProvisioningJobById, retryEnqueueProvisioningJob } from "./job.service.js";
import { requireInternalApiKey } from "../../middleware/require-internal-api-key.js";

app.get(
  "/jobs/:id",
  { preHandler: [requireInternalApiKey] },
  async (req, reply) => {
    const parsed = GetJobParamsSchema.safeParse(req.params ?? {});
    if (!parsed.success) {
      return reply.code(422).send({
        error: "Invalid request parameters",
        details: parsed.error.flatten(),
      });
    }

    const job = await getProvisioningJobById(parsed.data.id);
    if (!job) {
      return reply.code(404).send({ error: "Provisioning job not found" });
    }

    return job;
  }
);

app.post(
  "/jobs/:id/retry-enqueue",
  { preHandler: [requireInternalApiKey] },
  async (req, reply) => {
    const parsed = GetJobParamsSchema.safeParse(req.params ?? {});
    if (!parsed.success) {
      return reply.code(422).send({
        error: "Invalid request parameters",
        details: parsed.error.flatten(),
      });
    }

    const result = await retryEnqueueProvisioningJob(parsed.data.id, String(req.id));

    switch (result.kind) {
      case "not_found":
        return reply.code(404).send({ error: "Provisioning job not found" });
      case "conflict":
        return reply.code(409).send({
          error: "Job cannot be re-enqueued in its current state",
          status: result.jobStatus,
        });
      case "enqueue_failed":
        return reply.code(503).send({
          error: "Could not enqueue provisioning job",
          details: result.message,
        });
      case "ok":
        return {
          jobId: result.jobId,
          tenantId: result.tenantId,
          queueJobId: result.queueJobId,
          status: result.status,
          attemptCount: result.attemptCount,
        };
      default: {
        const _exhaustive: never = result;
        return _exhaustive;
      }
    }
  }
);
