import { app } from "../../app.js";
import { GetJobParamsSchema } from "./job.schemas.js";
import { getProvisioningJobById } from "./job.service.js";
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
