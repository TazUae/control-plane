import {
  FailureEnvelope,
  ProvisioningErrorCode,
  ProvisioningFailure,
} from "../contracts/provisioning.js";

type AgentErrorOptions = {
  details?: string;
  retryable?: boolean;
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  statusCode?: number;
};

export class AgentError extends Error {
  public readonly code: ProvisioningErrorCode;
  public readonly details?: string;
  public readonly retryable: boolean;
  public readonly stdout?: string;
  public readonly stderr?: string;
  public readonly exitCode?: number;
  public readonly statusCode: number;

  constructor(code: ProvisioningErrorCode, message: string, options: AgentErrorOptions = {}) {
    super(message);
    this.name = "AgentError";
    this.code = code;
    this.details = options.details;
    this.retryable = options.retryable ?? (code === "INFRA_UNAVAILABLE" || code === "ERP_TIMEOUT");
    this.stdout = options.stdout;
    this.stderr = options.stderr;
    this.exitCode = options.exitCode;
    this.statusCode = options.statusCode ?? 500;
  }
}

export function mapUnknownToAgentError(error: unknown): AgentError {
  if (error instanceof AgentError) {
    return error;
  }
  return new AgentError("ERP_PARTIAL_SUCCESS", "Unexpected provisioning failure", {
    details: error instanceof Error ? error.message : String(error),
    retryable: false,
    statusCode: 500,
  });
}

export function sendFailure(reply: any, error: AgentError): void {
  const payload: ProvisioningFailure = {
    code: error.code,
    message: error.message,
    retryable: error.retryable,
    details: error.details,
  };
  const envelope: FailureEnvelope = {
    ok: false,
    error: payload,
    timestamp: new Date().toISOString(),
  };
  void reply.code(error.statusCode).send(envelope);
}
