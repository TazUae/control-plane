import { DockerBenchProvisioningAdapter } from "./docker-bench-adapter.js";
import { HttpProvisioningAdapter } from "./http-adapter.js";
import { env } from "../../config/env.js";
import { ProvisioningAdapter } from "./interface.js";
import { logger } from "../logger.js";

let adapter: ProvisioningAdapter | null = null;

export function getProvisioningAdapter(): ProvisioningAdapter {
  if (!adapter) {
    if (env.NODE_ENV === "production" && !env.PROVISIONING_API_URL) {
      throw new Error("PROVISIONING_API_URL is required in production mode");
    }

    // Deployment mode: prefer provisioning-agent over direct host docker execution.
    adapter = env.PROVISIONING_API_URL
      ? new HttpProvisioningAdapter()
      : new DockerBenchProvisioningAdapter();
    logger.info(
      {
        adapter: adapter.kind,
        provisioningApiConfigured: Boolean(env.PROVISIONING_API_URL),
        fallbackToDocker: adapter.kind === "docker-bench",
      },
      "Provisioning adapter selected"
    );
  }
  return adapter;
}
