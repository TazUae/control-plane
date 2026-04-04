import { AgentError } from "../../lib/errors.js";
import { env } from "../../config/env.js";
import type {
  AddDomainInput,
  CreateApiUserInput,
  CreateSiteInput,
  EnableSchedulerInput,
  ErpBackendExecSuccess,
  ErpExecutionBackend,
  HealthCheckInput,
  InstallErpInput,
  ReadSiteDbNameInput,
} from "./erp-execution-backend.js";
import { mapRemoteHttpResult, mapRemoteTransportFailure } from "./remote-mapper.js";
import type { RemoteErpAction, RemoteExecutionEndpointConfig, RemoteRequestByAction } from "./remote-contract.js";

/**
 * Remote ERP-side execution backend.
 * This backend intentionally exposes only allowlisted ERP lifecycle actions.
 */
export class RemoteErpBackend implements ErpExecutionBackend {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(config: RemoteExecutionEndpointConfig = {}, fetchImpl: typeof fetch = fetch) {
    this.baseUrl = (config.baseUrl ?? env.ERP_REMOTE_BASE_URL ?? "").trim();
    this.token = (config.token ?? env.ERP_REMOTE_TOKEN ?? "").trim();
    this.timeoutMs = config.timeoutMs ?? env.ERP_REMOTE_TIMEOUT_MS;
    this.fetchImpl = fetchImpl;
    this.assertReady();
  }

  async createSite(input: CreateSiteInput): Promise<ErpBackendExecSuccess> {
    return await this.execute("createSite", { site: input.site }, input.requestId);
  }

  async readSiteDbName(input: ReadSiteDbNameInput): Promise<ErpBackendExecSuccess> {
    return await this.execute("readSiteDbName", { site: input.site }, input.requestId);
  }

  async installErp(input: InstallErpInput): Promise<ErpBackendExecSuccess> {
    return await this.execute("installErp", { site: input.site }, input.requestId);
  }

  async enableScheduler(input: EnableSchedulerInput): Promise<ErpBackendExecSuccess> {
    return await this.execute("enableScheduler", { site: input.site }, input.requestId);
  }

  async addDomain(input: AddDomainInput): Promise<ErpBackendExecSuccess> {
    return await this.execute(
      "addDomain",
      { site: input.site, domain: input.domain },
      input.requestId
    );
  }

  async createApiUser(input: CreateApiUserInput): Promise<ErpBackendExecSuccess> {
    return await this.execute(
      "createApiUser",
      { site: input.site, apiUsername: input.apiUsername },
      input.requestId
    );
  }

  async healthCheck(input: HealthCheckInput): Promise<ErpBackendExecSuccess> {
    return await this.execute("healthCheck", { deep: input.deep }, input.requestId);
  }

  private assertReady(): void {
    const missing: string[] = [];
    if (!this.baseUrl) {
      missing.push("ERP_REMOTE_BASE_URL");
    }
    if (!this.token) {
      missing.push("ERP_REMOTE_TOKEN");
    }

    if (missing.length > 0) {
      throw new AgentError("INFRA_UNAVAILABLE", "Remote ERP backend is not configured", {
        details: `Missing required env vars: ${missing.join(", ")}`,
        retryable: false,
        statusCode: 503,
      });
    }
  }

  private async execute<TAction extends RemoteErpAction>(
    action: TAction,
    payload: RemoteRequestByAction[TAction],
    requestId?: string
  ): Promise<ErpBackendExecSuccess> {
    const url = new URL("/v1/erp/lifecycle", this.baseUrl).toString();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const body: Record<string, unknown> = { action, payload };
      if (requestId) {
        body.requestId = requestId;
      }
      const response = await this.fetchImpl(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.token}`,
          ...(requestId ? { "x-request-id": requestId } : {}),
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const text = await response.text();
      const responseBody = text.length > 0 ? JSON.parse(text) : {};
      return mapRemoteHttpResult(response.status, responseBody);
    } catch (error) {
      if (error instanceof AgentError) {
        throw error;
      }
      throw mapRemoteTransportFailure(error);
    } finally {
      clearTimeout(timeout);
    }
  }
}
