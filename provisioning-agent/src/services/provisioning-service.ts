import { ProvisioningOperationResult } from "../contracts/provisioning.js";
import { AgentError } from "../lib/errors.js";
import { AllowedProvisioningAction } from "../providers/erpnext/commands.js";
import { ErpnextExecutor } from "../providers/erpnext/executor.js";
import { validateSite } from "../providers/erpnext/validation.js";
import type { ErpExecutionBackend } from "../providers/erpnext/erp-execution-backend.js";

export class ProvisioningService {
  private readonly executor: ErpnextExecutor;
  private readonly backend: ErpExecutionBackend;

  constructor(backend: ErpExecutionBackend) {
    this.backend = backend;
    this.executor = new ErpnextExecutor(backend);
  }

  async run(action: AllowedProvisioningAction, site: string): Promise<ProvisioningOperationResult> {
    let safeSite: string;
    try {
      safeSite = validateSite(site);
    } catch (error) {
      throw new AgentError("ERP_VALIDATION_FAILED", "Invalid site input", {
        details: error instanceof Error ? error.message : String(error),
        retryable: false,
        statusCode: 422,
      });
    }
    return await this.executor.run(action, safeSite);
  }

  async backendHealthCheck(): Promise<{ ok: boolean; durationMs?: number }> {
    try {
      const result = await this.backend.healthCheck({ deep: true });
      return { ok: true, durationMs: result.durationMs };
    } catch {
      return { ok: false };
    }
  }
}
