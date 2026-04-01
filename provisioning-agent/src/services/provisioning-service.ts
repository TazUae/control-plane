import { ProvisioningOperationResult } from "../contracts/provisioning.js";
import { AllowedProvisioningAction } from "../providers/erpnext/commands.js";
import { ErpnextExecutor } from "../providers/erpnext/executor.js";
import type { ErpExecutionBackend } from "../providers/erpnext/erp-execution-backend.js";

export class ProvisioningService {
  private readonly executor: ErpnextExecutor;

  constructor(backend: ErpExecutionBackend) {
    this.executor = new ErpnextExecutor(backend);
  }

  async run(action: AllowedProvisioningAction, site: string): Promise<ProvisioningOperationResult> {
    return await this.executor.run(action, site);
  }
}
