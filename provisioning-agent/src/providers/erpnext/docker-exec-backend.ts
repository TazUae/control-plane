import { execCommand } from "../../lib/exec.js";
import { env } from "../../config/env.js";
import { buildDockerExecBenchArgv } from "./commands.js";
import { mapBackendFailure } from "./errors.js";
import { AgentError } from "../../lib/errors.js";
import { parseSiteConfigDbNameJson } from "./site-config.js";
import type {
  AddDomainInput,
  CreateApiUserInput,
  CreateSiteInput,
  EnableSchedulerInput,
  HealthCheckInput,
  ErpBackendExecSuccess,
  ErpExecutionBackend,
  InstallErpInput,
  ReadSiteDbNameInput,
} from "./erp-execution-backend.js";

/**
 * Temporary bridge backend when `ERP_EXECUTION_BACKEND=docker` (default): allowlisted bench operations
 * via `docker exec` into `ERP_CONTAINER_NAME`.
 * This is not the final production architecture and must be replaced by ERP-side execution.
 * Do not add generic exec passthrough here.
 */
export class DockerExecBackend implements ErpExecutionBackend {
  async createSite(input: CreateSiteInput): Promise<ErpBackendExecSuccess> {
    return await this.runBench("createSite", { site: input.site });
  }

  async readSiteDbName(input: ReadSiteDbNameInput): Promise<ErpBackendExecSuccess> {
    const started = Date.now();
    const rel = `sites/${input.site}/site_config.json`;
    try {
      const result = await execCommand(
        "docker",
        ["exec", "-w", env.ERP_BENCH_PATH, env.ERP_CONTAINER_NAME, "cat", rel],
        { timeoutMs: env.ERP_COMMAND_TIMEOUT_MS }
      );
      const parsed = parseSiteConfigDbNameJson(result.stdout);
      if (!parsed.ok) {
        throw new AgentError("ERP_PARTIAL_SUCCESS", "Invalid site_config in ERP container", {
          details: parsed.code,
          retryable: false,
          statusCode: 500,
        });
      }
      return {
        durationMs: Date.now() - started,
        metadata: { dbName: parsed.dbName, site: input.site },
      };
    } catch (error) {
      throw mapBackendFailure(error, "Could not read site_config from ERP container");
    }
  }

  async installErp(input: InstallErpInput): Promise<ErpBackendExecSuccess> {
    return await this.runBench("installErp", { site: input.site });
  }

  async enableScheduler(input: EnableSchedulerInput): Promise<ErpBackendExecSuccess> {
    return await this.runBench("enableScheduler", { site: input.site });
  }

  async addDomain(input: AddDomainInput): Promise<ErpBackendExecSuccess> {
    return await this.runBench("addDomain", {
      site: input.site,
      domain: input.domain,
    });
  }

  async createApiUser(input: CreateApiUserInput): Promise<ErpBackendExecSuccess> {
    return await this.runBench("createApiUser", {
      site: input.site,
      apiUsername: input.apiUsername,
    });
  }

  async healthCheck(_input: HealthCheckInput): Promise<ErpBackendExecSuccess> {
    const startedAt = Date.now();
    try {
      await execCommand("docker", ["version", "--format", "{{.Server.Version}}"], {
        timeoutMs: env.ERP_COMMAND_TIMEOUT_MS,
      });
      return { durationMs: Date.now() - startedAt };
    } catch (error) {
      throw mapBackendFailure(error, "ERP execution backend health check failed");
    }
  }

  private async runBench(
    action: Parameters<typeof buildDockerExecBenchArgv>[0],
    buildInput: Parameters<typeof buildDockerExecBenchArgv>[1]
  ): Promise<ErpBackendExecSuccess> {
    try {
      const args = buildDockerExecBenchArgv(action, buildInput);
      const result = await execCommand("docker", args, { timeoutMs: env.ERP_COMMAND_TIMEOUT_MS });
      return { durationMs: result.durationMs };
    } catch (error) {
      throw mapBackendFailure(error, "Provisioning command failed");
    }
  }
}
