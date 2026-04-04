/**
 * Narrow typed contract for ERP provisioning operations.
 *
 * Security: implementations must not expose arbitrary command execution, raw bench
 * passthrough, generic shell runners, or any API that accepts user-controlled argv.
 */

import type { SafeBackendError } from "./errors.js";

export type ExecutionFailureCode =
  | "INFRA_UNAVAILABLE"
  | "ERP_COMMAND_FAILED"
  | "ERP_TIMEOUT"
  | "ERP_VALIDATION_FAILED"
  | "ERP_PARTIAL_SUCCESS"
  | "SITE_ALREADY_EXISTS";

export type ExecutionResult = {
  ok: boolean;
  code?: ExecutionFailureCode;
  message?: string;
  retryable?: boolean;
};

export type ErpBackendExecSuccess = {
  durationMs: number;
  metadata?: Record<string, string | number | boolean>;
};

export type CreateSiteInput = { site: string; requestId?: string };

export type ReadSiteDbNameInput = { site: string; requestId?: string };

export type InstallErpInput = { site: string; requestId?: string };

export type EnableSchedulerInput = { site: string; requestId?: string };

export type AddDomainInput = { site: string; domain: string; requestId?: string };

export type CreateApiUserInput = { site: string; apiUsername: string; requestId?: string };
export type HealthCheckInput = { deep?: boolean; requestId?: string };

/**
 * Pluggable ERP execution layer. Each method maps to one allowlisted provisioning
 * operation; future non-Docker backends implement the same surface without docker/bench.
 */
export interface ErpExecutionBackend {
  createSite(input: CreateSiteInput): Promise<ErpBackendExecSuccess>;
  /** Read-only: loads `db_name` from `sites/<site>/site_config.json` (no bench mutation). */
  readSiteDbName(input: ReadSiteDbNameInput): Promise<ErpBackendExecSuccess>;
  installErp(input: InstallErpInput): Promise<ErpBackendExecSuccess>;
  enableScheduler(input: EnableSchedulerInput): Promise<ErpBackendExecSuccess>;
  addDomain(input: AddDomainInput): Promise<ErpBackendExecSuccess>;
  createApiUser(input: CreateApiUserInput): Promise<ErpBackendExecSuccess>;
  healthCheck(input: HealthCheckInput): Promise<ErpBackendExecSuccess>;
}

export type BackendResult<T = ErpBackendExecSuccess> =
  | { ok: true; value: T }
  | { ok: false; error: SafeBackendError };
