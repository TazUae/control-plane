import { ProvisioningOperationResult } from "../contracts/provisioning.js";
import { AgentError } from "../lib/errors.js";
import { AllowedProvisioningAction } from "../providers/erpnext/commands.js";
import { ErpnextExecutor } from "../providers/erpnext/executor.js";
import { validateSite } from "../providers/erpnext/validation.js";
import type { ErpExecutionBackend } from "../providers/erpnext/erp-execution-backend.js";
import { logger } from "../lib/logger.js";

export class ProvisioningService {
  private readonly executor: ErpnextExecutor;
  private readonly backend: ErpExecutionBackend;

  constructor(backend: ErpExecutionBackend) {
    this.backend = backend;
    this.executor = new ErpnextExecutor(backend);
  }

  /**
   * Read-only: returns Frappe `db_name` from `sites/<site>/site_config.json` (lazy backfill for legacy tenants).
   */
  async readSiteDbName(site: string, opts?: { requestId?: string }): Promise<ProvisioningOperationResult> {
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
    const requestId = opts?.requestId;
    logger.info(
      requestId ? { provider: "erpnext", site: safeSite, requestId } : { provider: "erpnext", site: safeSite },
      "readSiteDbName started"
    );
    const result = await this.backend.readSiteDbName({ site: safeSite, requestId });
    const dbName = typeof result.metadata?.dbName === "string" ? result.metadata.dbName : undefined;
    if (!dbName) {
      throw new AgentError("ERP_PARTIAL_SUCCESS", "Remote ERP did not return dbName metadata", {
        retryable: false,
        statusCode: 502,
      });
    }
    logger.info(
      requestId ? { provider: "erpnext", site: safeSite, dbName, requestId } : { provider: "erpnext", site: safeSite, dbName },
      "dbName extracted"
    );
    return {
      action: "readSiteDbName",
      site: safeSite,
      outcome: "applied",
      durationMs: result.durationMs,
      dbName,
    };
  }

  async run(action: AllowedProvisioningAction, site: string, opts?: { requestId?: string }): Promise<ProvisioningOperationResult> {
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
    return await this.executor.run(action, safeSite, opts);
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
