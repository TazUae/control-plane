import Fastify from "fastify";
import crypto from "node:crypto";
import { env } from "./config/env.js";
import { validateHostBenchPaths } from "./config/host-bench-runtime.js";
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

if (env.ERP_EXECUTION_MODE === "host_bench") {
  try {
    validateHostBenchPaths(env.ERP_BENCH_PATH, env.ERP_BENCH_EXECUTABLE);
  } catch (err) {
    logger.fatal({ err }, "host_bench runtime validation failed");
    process.exit(1);
  }
}

const erpBackend = createErpExecutionBackend();
logger.info(
  { erpExecutionMode: env.ERP_EXECUTION_MODE, backend: erpBackend.constructor.name },
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
