export type ProvisioningErrorCode =
  | "INFRA_UNAVAILABLE"
  | "ERP_COMMAND_FAILED"
  | "ERP_VALIDATION_FAILED"
  | "ERP_TIMEOUT"
  | "ERP_PARTIAL_SUCCESS"
  | "SITE_ALREADY_EXISTS";

type ProvisioningErrorOptions = {
  details?: string;
  retryable?: boolean;
  cause?: unknown;
  /** Original agent/API payload or structured failure for persistence (see provisioning job `result`). */
  raw?: unknown;
  stdout?: string;
  stderr?: string;
  exitCode?: number;
};

export class ProvisioningError extends Error {
  public readonly code: ProvisioningErrorCode;
  public readonly details?: string;
  public readonly retryable: boolean;
  public readonly raw?: unknown;
  public readonly stdout?: string;
  public readonly stderr?: string;
  public readonly exitCode?: number;

  constructor(code: ProvisioningErrorCode, message: string, options: ProvisioningErrorOptions = {}) {
    super(message);
    this.name = "ProvisioningError";
    this.code = code;
    this.details = options.details;
    this.retryable = options.retryable ?? (code === "INFRA_UNAVAILABLE" || code === "ERP_TIMEOUT");
    this.raw = options.raw;
    this.stdout = options.stdout;
    this.stderr = options.stderr;
    this.exitCode = options.exitCode;
    if (options.cause !== undefined) {
      (this as Error & { cause?: unknown }).cause = options.cause;
    }
  }
}

export function isProvisioningError(error: unknown): error is ProvisioningError {
  return error instanceof ProvisioningError;
}

function trimMeaningful(s: string | undefined): string | undefined {
  const t = s?.trim();
  return t ? t : undefined;
}

function stderrFromRawPayload(raw: unknown): string | undefined {
  if (!raw || typeof raw !== "object" || raw === null) return undefined;
  const r = raw as { stderr?: unknown; details?: unknown };
  const nested = r.details;
  if (nested && typeof nested === "object" && nested !== null && "stderr" in nested) {
    const s = (nested as { stderr?: unknown }).stderr;
    if (typeof s === "string") return trimMeaningful(s);
  }
  if (typeof r.stderr === "string") return trimMeaningful(r.stderr);
  return undefined;
}

/**
 * Human-readable failure text for persistence (DB, APIs). Prefers command stderr and
 * structured agent payloads over generic wrapper messages.
 */
export function getProvisioningFailureReason(error: ProvisioningError): string {
  return (
    stderrFromRawPayload(error.raw) ||
    trimMeaningful(error.stderr) ||
    trimMeaningful(error.details) ||
    trimMeaningful(error.message) ||
    "Unknown failure"
  );
}
