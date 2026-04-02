import Fastify from "fastify";
import crypto from "node:crypto";
import { env } from "./config/env.js";
import { logger, loggerConfig } from "./lib/logger.js";
import { registerHealthRoutes } from "./routes/health.js";
import { registerSiteRoutes } from "./routes/sites.js";
import { createErpExecutionBackend } from "./providers/erpnext/erp-backend-factory.js";
import { ProvisioningService } from "./services/provisioning-service.js";
import { mapUnknownToAgentError, sendFailure } from "./lib/errors.js";

const app = Fastify({
  logger: loggerConfig,
  disableRequestLogging: true,
  genReqId: (req) => (req.headers["x-request-id"] as string | undefined) ?? crypto.randomUUID(),
});

const erpBackend = createErpExecutionBackend();
logger.info(
  { erpExecutionBackend: env.ERP_EXECUTION_BACKEND, backend: erpBackend.constructor.name },
  "ERP execution backend selected"
);
const service = new ProvisioningService(erpBackend);

app.setErrorHandler((error, _req, reply) => {
  const typed = mapUnknownToAgentError(error);
  sendFailure(reply, typed);
});

await registerHealthRoutes(app);
await registerSiteRoutes(app, service);

app.listen({ port: env.PORT, host: "0.0.0.0" })
  .then(() => {
    logger.info({ port: env.PORT }, "Provisioning agent started");
  })
  .catch((error) => {
    logger.error({ error }, "Provisioning agent startup failed");
    process.exit(1);
  });
