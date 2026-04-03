import { AgentError } from "../../lib/errors.js";
import type { ErpBackendExecSuccess, ExecutionFailureCode } from "./erp-execution-backend.js";
import {
  RemoteExecutionEnvelopeSchema,
  type RemoteExecutionEnvelope,
} from "./remote-contract.js";

const STATUS_BY_CODE: Record<ExecutionFailureCode, number> = {
  INFRA_UNAVAILABLE: 503,
  ERP_COMMAND_FAILED: 400,
  ERP_TIMEOUT: 504,
  ERP_VALIDATION_FAILED: 422,
  ERP_PARTIAL_SUCCESS: 500,
  SITE_ALREADY_EXISTS: 409,
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function mapRemoteFailureEnvelope(envelope: RemoteExecutionEnvelope): AgentError {
  if (envelope.ok) {
    throw new AgentError("ERP_PARTIAL_SUCCESS", "Invalid remote failure envelope", {
      retryable: false,
      statusCode: 502,
    });
  }

  const { code, message, retryable, details } = envelope.error;
  return new AgentError(code, message, {
    retryable,
    details,
    statusCode: STATUS_BY_CODE[code],
  });
}

export function mapRemoteTransportFailure(error: unknown): AgentError {
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();

  if (
    lower.includes("aborted") ||
    lower.includes("timeout") ||
    lower.includes("timed out") ||
    (asRecord(error)?.["name"] === "AbortError")
  ) {
    return new AgentError("ERP_TIMEOUT", "Remote ERP execution timed out", {
      details: message,
      retryable: true,
      statusCode: 504,
    });
  }

  return new AgentError("INFRA_UNAVAILABLE", "Remote ERP execution unavailable", {
    details: message,
    retryable: true,
    statusCode: 503,
  });
}

export function mapRemoteHttpResult(status: number, body: unknown): ErpBackendExecSuccess {
  const parsed = RemoteExecutionEnvelopeSchema.safeParse(body);

  if (!parsed.success) {
    throw new AgentError("ERP_PARTIAL_SUCCESS", "Invalid response from remote ERP backend", {
      details: parsed.error.message,
      retryable: false,
      statusCode: 502,
    });
  }

  const envelope = parsed.data;
  if (!envelope.ok) {
    throw mapRemoteFailureEnvelope(envelope);
  }

  if (status >= 400) {
    throw new AgentError("ERP_PARTIAL_SUCCESS", "Unexpected remote ERP success envelope", {
      retryable: false,
      statusCode: 502,
    });
  }

  return {
    durationMs: envelope.data.durationMs,
    metadata: envelope.data.metadata,
  };
}
