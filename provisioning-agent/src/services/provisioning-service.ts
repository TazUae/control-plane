import { ProvisioningOperationResult } from "../contracts/provisioning.js";
import { AgentError } from "../lib/errors.js";
import { AllowedProvisioningAction } from "../providers/erpnext/commands.js";
import { ErpnextExecutor } from "../providers/erpnext/executor.js";

export class ProvisioningService {
  constructor(private readonly executor: ErpnextExecutor) {}

  async run(action: AllowedProvisioningAction, site: string): Promise<ProvisioningOperationResult> {
    try {
      return await this.executor.run(action, site);
    } catch (error) {
      if (error instanceof AgentError && error.code === "SITE_ALREADY_EXISTS") {
        return {
          action,
          site,
          message: error.message,
          outcome: "already_done",
          alreadyExists: true,
          stdout: error.stdout,
          stderr: error.stderr,
        };
      }
      throw error;
    }
  }
}
