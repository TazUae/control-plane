import { HttpProvisioningAdapter } from "./http-adapter.js";
import { ProvisioningAdapter } from "./interface.js";
import { logger } from "../logger.js";

let adapter: ProvisioningAdapter | null = null;

export function getProvisioningAdapter(): ProvisioningAdapter {
  if (!adapter) {
    adapter = new HttpProvisioningAdapter();
    logger.info({ adapter: adapter.kind }, "Provisioning adapter selected");
  }
  return adapter;
}
