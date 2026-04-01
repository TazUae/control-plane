import { isProvisioningError } from "../../lib/provisioning/errors.js";

export function shouldRetryProvisioningError(error: unknown): boolean {
  if (isProvisioningError(error)) {
    return error.retryable;
  }
  return true;
}
