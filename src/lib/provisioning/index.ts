import { DockerBenchProvisioningAdapter } from "./docker-bench-adapter.js";
import { ProvisioningAdapter } from "./interface.js";

let adapter: ProvisioningAdapter | null = null;

export function getProvisioningAdapter(): ProvisioningAdapter {
  if (!adapter) {
    adapter = new DockerBenchProvisioningAdapter();
  }
  return adapter;
}
