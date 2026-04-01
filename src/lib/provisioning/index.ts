import { DockerBenchProvisioningAdapter } from "./docker-bench-adapter.js";
import { HttpProvisioningAdapter } from "./http-adapter.js";
import { env } from "../../config/env.js";
import { ProvisioningAdapter } from "./interface.js";

let adapter: ProvisioningAdapter | null = null;

export function getProvisioningAdapter(): ProvisioningAdapter {
  if (!adapter) {
    adapter = env.PROVISIONING_API_URL
      ? new HttpProvisioningAdapter()
      : new DockerBenchProvisioningAdapter();
  }
  return adapter;
}
