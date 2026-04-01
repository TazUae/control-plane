import { logger } from "../../lib/logger.js";
import { AgentError } from "../../lib/errors.js";
import { execCommand } from "../../lib/exec.js";
import { ProvisioningOperationResult } from "../../contracts/provisioning.js";
import { AllowedProvisioningAction, buildBenchArgs } from "./commands.js";

const DEFAULT_TIMEOUT_MS = 120_000;

export class ErpnextExecutor {
  async run(action: AllowedProvisioningAction, site: string): Promise<ProvisioningOperationResult> {
    const args = buildBenchArgs(action, site);
    logger.info({ provider: "erpnext", action, site }, "ERP action started");

    try {
      const result = await execCommand("docker", args, { timeoutMs: DEFAULT_TIMEOUT_MS });
      logger.info({ provider: "erpnext", action, site, durationMs: result.durationMs }, "ERP action succeeded");
      return {
        action,
        site,
        outcome: "applied",
        stdout: result.stdout,
        stderr: result.stderr,
        durationMs: result.durationMs,
      };
    } catch (error) {
      const mapped = this.mapDomainError(error);
      logger.error(
        {
          provider: "erpnext",
          action,
          site,
          code: mapped.code,
          retryable: mapped.retryable,
          stderr: mapped.stderr,
          stdout: mapped.stdout,
        },
        "ERP action failed"
      );
      throw mapped;
    }
  }

  private mapDomainError(error: unknown): AgentError {
    if (!(error instanceof AgentError)) {
      return new AgentError("ERP_PARTIAL_SUCCESS", "Unexpected ERP executor failure", {
        details: error instanceof Error ? error.message : String(error),
        retryable: false,
        statusCode: 500,
      });
    }

    const combined = `${error.stdout ?? ""}\n${error.stderr ?? ""}`.toLowerCase();
    if (combined.includes("already exists") || combined.includes("duplicate")) {
      return new AgentError("SITE_ALREADY_EXISTS", "Site already exists", {
        retryable: false,
        details: error.details,
        stdout: error.stdout,
        stderr: error.stderr,
        exitCode: error.exitCode,
        statusCode: 200,
      });
    }
    return error;
  }
}
