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
  stdout?: string;
  stderr?: string;
  exitCode?: number;
};

export class ProvisioningError extends Error {
  public readonly code: ProvisioningErrorCode;
  public readonly details?: string;
  public readonly retryable: boolean;
  public readonly stdout?: string;
  public readonly stderr?: string;
  public readonly exitCode?: number;

  constructor(code: ProvisioningErrorCode, message: string, options: ProvisioningErrorOptions = {}) {
    super(message);
    this.name = "ProvisioningError";
    this.code = code;
    this.details = options.details;
    this.retryable = options.retryable ?? (code === "INFRA_UNAVAILABLE" || code === "ERP_TIMEOUT");
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
