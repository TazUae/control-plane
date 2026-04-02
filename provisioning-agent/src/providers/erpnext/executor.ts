import { logger } from "../../lib/logger.js";
import { AgentError } from "../../lib/errors.js";
import { ProvisioningOperationResult } from "../../contracts/provisioning.js";
import { AllowedProvisioningAction } from "./commands.js";
import { env } from "../../config/env.js";
import { validateDomain, validateSite, validateUsername } from "./validation.js";
import type { ErpExecutionBackend } from "./erp-execution-backend.js";

function redactSensitiveText(value: string): string {
  return value
    .replace(/(password\s*[:=]\s*)([^\s]+)/gi, "$1[REDACTED]")
    .replace(/(token\s*[:=]\s*)([^\s]+)/gi, "$1[REDACTED]")
    .replace(/(secret\s*[:=]\s*)([^\s]+)/gi, "$1[REDACTED]");
}

type IdempotentOutcome = {
  outcome: "already_done";
  message: string;
  alreadyExists?: boolean;
  alreadyInstalled?: boolean;
  alreadyConfigured?: boolean;
};

export function detectIdempotentOutcome(
  action: AllowedProvisioningAction,
  stdout: string,
  stderr: string
): IdempotentOutcome | null {
  const combined = `${stdout}\n${stderr}`.toLowerCase();

  if (action === "createSite" && combined.includes("already exists")) {
    return {
      outcome: "already_done",
      message: "Site already exists",
      alreadyExists: true,
    };
  }

  if (action === "installErp" && (combined.includes("already installed") || combined.includes("is installed"))) {
    return {
      outcome: "already_done",
      message: "ERPNext app already installed",
      alreadyInstalled: true,
    };
  }

  if (action === "enableScheduler" && combined.includes("scheduler is already enabled")) {
    return {
      outcome: "already_done",
      message: "Scheduler already enabled",
      alreadyConfigured: true,
    };
  }

  if (action === "addDomain" && (combined.includes("domain already exists") || combined.includes("duplicate entry"))) {
    return {
      outcome: "already_done",
      message: "Domain already configured",
      alreadyConfigured: true,
    };
  }

  return null;
}

export class ErpnextExecutor {
  constructor(private readonly backend: ErpExecutionBackend) {}

  async run(action: AllowedProvisioningAction, site: string): Promise<ProvisioningOperationResult> {
    let safeSite: string;
    let derivedDomain: string;
    let derivedApiUsername: string;
    try {
      safeSite = validateSite(site);
      derivedDomain = validateDomain(`${safeSite}.${env.ERP_BASE_DOMAIN}`);
      derivedApiUsername = validateUsername(`${env.ERP_API_USERNAME_PREFIX}_${safeSite}`);
    } catch (error) {
      throw new AgentError("ERP_VALIDATION_FAILED", "Invalid provisioning input", {
        details: error instanceof Error ? error.message : String(error),
        retryable: false,
        statusCode: 422,
      });
    }
    logger.info({ provider: "erpnext", action, site }, "ERP action started");

    try {
      const result = await this.dispatchBackend(action, safeSite, derivedDomain, derivedApiUsername);
      logger.info({ provider: "erpnext", action, site, durationMs: result.durationMs }, "ERP action succeeded");
      return {
        action,
        site: safeSite,
        outcome: "applied",
        durationMs: result.durationMs,
      };
    } catch (error) {
      const typed = error instanceof AgentError
        ? error
        : new AgentError("ERP_PARTIAL_SUCCESS", "Unexpected ERP executor failure", {
            details: error instanceof Error ? error.message : String(error),
            retryable: false,
            statusCode: 500,
          });

      const idempotent = detectIdempotentOutcome(action, typed.stdout ?? "", typed.stderr ?? "");
      if (idempotent) {
        logger.info(
          {
            provider: "erpnext",
            action,
            site: safeSite,
            idempotent: true,
          },
          "ERP action already satisfied"
        );
        return {
          action,
          site: safeSite,
          outcome: idempotent.outcome,
          message: idempotent.message,
          alreadyExists: idempotent.alreadyExists,
          alreadyInstalled: idempotent.alreadyInstalled,
          alreadyConfigured: idempotent.alreadyConfigured,
        };
      }

      logger.error(
        {
          provider: "erpnext",
          action,
          site: safeSite,
          code: typed.code,
          retryable: typed.retryable,
          stderr: redactSensitiveText(typed.stderr ?? ""),
          stdout: redactSensitiveText(typed.stdout ?? ""),
        },
        "ERP action failed"
      );
      throw typed;
    }
  }

  private async dispatchBackend(
    action: AllowedProvisioningAction,
    safeSite: string,
    derivedDomain: string,
    derivedApiUsername: string
  ) {
    switch (action) {
      case "createSite":
        return await this.backend.createSite({ site: safeSite });
      case "installErp":
        return await this.backend.installErp({ site: safeSite });
      case "enableScheduler":
        return await this.backend.enableScheduler({ site: safeSite });
      case "addDomain":
        return await this.backend.addDomain({ site: safeSite, domain: derivedDomain });
      case "createApiUser":
        return await this.backend.createApiUser({ site: safeSite, apiUsername: derivedApiUsername });
    }
  }
}
