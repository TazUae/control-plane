/**
 * Narrow typed contract for ERP provisioning operations.
 *
 * Security: implementations must not expose arbitrary command execution, raw bench
 * passthrough, generic shell runners, or any API that accepts user-controlled argv.
 */

export type ErpBackendExecSuccess = {
  stdout: string;
  stderr: string;
  durationMs: number;
};

export type CreateSiteInput = { site: string };

export type InstallErpInput = { site: string };

export type EnableSchedulerInput = { site: string };

export type AddDomainInput = { site: string; domain: string };

export type CreateApiUserInput = { site: string; apiUsername: string };

/**
 * Pluggable ERP execution layer. Each method maps to one allowlisted provisioning
 * operation; future non-Docker backends implement the same surface without docker/bench.
 */
export interface ErpExecutionBackend {
  createSite(input: CreateSiteInput): Promise<ErpBackendExecSuccess>;
  installErp(input: InstallErpInput): Promise<ErpBackendExecSuccess>;
  enableScheduler(input: EnableSchedulerInput): Promise<ErpBackendExecSuccess>;
  addDomain(input: AddDomainInput): Promise<ErpBackendExecSuccess>;
  createApiUser(input: CreateApiUserInput): Promise<ErpBackendExecSuccess>;
  /** Optional deep check of execution infrastructure (not wired to HTTP /health by default). */
  healthCheck?(): Promise<ErpBackendExecSuccess>;
}
