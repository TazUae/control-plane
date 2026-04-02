import { AgentError } from "../../lib/errors.js";
import type {
  AddDomainInput,
  CreateApiUserInput,
  CreateSiteInput,
  EnableSchedulerInput,
  ErpBackendExecSuccess,
  ErpExecutionBackend,
  HealthCheckInput,
  InstallErpInput,
} from "./erp-execution-backend.js";

/**
 * Scaffold only.
 * Remote ERP-side execution backend is intentionally not implemented yet.
 * Selecting this backend must fail clearly and safely without partial behavior.
 */
export class RemoteErpBackend implements ErpExecutionBackend {
  async createSite(_input: CreateSiteInput): Promise<ErpBackendExecSuccess> {
    throw this.notImplemented();
  }

  async installErp(_input: InstallErpInput): Promise<ErpBackendExecSuccess> {
    throw this.notImplemented();
  }

  async enableScheduler(_input: EnableSchedulerInput): Promise<ErpBackendExecSuccess> {
    throw this.notImplemented();
  }

  async addDomain(_input: AddDomainInput): Promise<ErpBackendExecSuccess> {
    throw this.notImplemented();
  }

  async createApiUser(_input: CreateApiUserInput): Promise<ErpBackendExecSuccess> {
    throw this.notImplemented();
  }

  async healthCheck(_input: HealthCheckInput): Promise<ErpBackendExecSuccess> {
    throw this.notImplemented();
  }

  private notImplemented(): AgentError {
    return new AgentError("INFRA_UNAVAILABLE", "Remote ERP execution backend is not implemented", {
      retryable: false,
      statusCode: 501,
    });
  }
}
