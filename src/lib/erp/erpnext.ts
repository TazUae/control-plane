import { getProvisioningAdapter } from "../provisioning/index.js";

export async function createSite(siteName: string) {
  const adapter = getProvisioningAdapter();
  const result = await adapter.createSite(siteName);
  return result.stdout ?? "";
}
