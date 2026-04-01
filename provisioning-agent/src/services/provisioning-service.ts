import { ProvisioningOperationResult } from "../contracts/provisioning.js";
import { AllowedProvisioningAction } from "../providers/erpnext/commands.js";
import { ErpnextExecutor } from "../providers/erpnext/executor.js";

export class ProvisioningService {
  constructor(private readonly executor: ErpnextExecutor) {}

  async run(action: AllowedProvisioningAction, site: string): Promise<ProvisioningOperationResult> {
    return await this.executor.run(action, site);
  }
}
