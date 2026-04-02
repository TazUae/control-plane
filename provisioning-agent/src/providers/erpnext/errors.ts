import { AgentError } from "../../lib/errors.js";
import type { ProvisioningErrorCode } from "../../contracts/provisioning.js";

export type SafeBackendError = {
  code: ProvisioningErrorCode;
  message: string;
  retryable: boolean;
};

const ALREADY_EXISTS_PATTERNS = [
  "already exists",
  "domain already exists",
  "duplicate entry",
];

export function mapBackendFailure(error: unknown, fallbackMessage: string): AgentError {
  if (error instanceof AgentError) {
    const combined = `${error.stdout ?? ""}\n${error.stderr ?? ""}\n${error.details ?? ""}`.toLowerCase();
    if (error.code === "INFRA_UNAVAILABLE" || error.code === "ERP_TIMEOUT") {
      return error;
    }
    if (ALREADY_EXISTS_PATTERNS.some((pattern) => combined.includes(pattern))) {
      return new AgentError("SITE_ALREADY_EXISTS", "Site already exists", {
        details: error.details,
        retryable: false,
        statusCode: 409,
      });
    }
    if (error.code === "ERP_COMMAND_FAILED") {
      return new AgentError("ERP_COMMAND_FAILED", fallbackMessage, {
        details: error.details,
        retryable: false,
        statusCode: error.statusCode,
      });
    }
    return error;
  }

  const maybe = error as NodeJS.ErrnoException | undefined;
  const details = maybe?.message ?? String(error);
  const combined = details.toLowerCase();

  if (maybe?.code === "ENOENT") {
    return new AgentError("INFRA_UNAVAILABLE", "ERP execution infrastructure unavailable", {
      details,
      retryable: true,
      statusCode: 503,
    });
  }

  if (combined.includes("timed out") || combined.includes("timeout")) {
    return new AgentError("ERP_TIMEOUT", "ERP command timed out", {
      details,
      retryable: true,
      statusCode: 504,
    });
  }

  if (ALREADY_EXISTS_PATTERNS.some((pattern) => combined.includes(pattern))) {
    return new AgentError("SITE_ALREADY_EXISTS", "Site already exists", {
      details,
      retryable: false,
      statusCode: 409,
    });
  }

  return new AgentError("ERP_COMMAND_FAILED", fallbackMessage, {
    details,
    retryable: false,
    statusCode: 400,
  });
}
