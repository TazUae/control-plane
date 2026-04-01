import { execCommand } from "../../lib/exec.js";
import { env } from "../../config/env.js";
import { buildBenchArgs } from "./commands.js";
import type {
  AddDomainInput,
  CreateApiUserInput,
  CreateSiteInput,
  EnableSchedulerInput,
  ErpBackendExecSuccess,
  ErpExecutionBackend,
  InstallErpInput,
} from "./erp-execution-backend.js";

/**
 * Temporary backend: runs allowlisted bench operations via `docker exec` on the ERP container.
 *
 * Replace with a non-Docker implementation (e.g. host bench, remote API) when infrastructure
 * allows — keep this class Docker-specific; do not add generic exec passthrough here.
 */
export class DockerExecBackend implements ErpExecutionBackend {
  async createSite(input: CreateSiteInput): Promise<ErpBackendExecSuccess> {
    return await this.runBench("createSite", { site: input.site });
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

  private async runBench(
    action: Parameters<typeof buildBenchArgs>[0],
    buildInput: Parameters<typeof buildBenchArgs>[1]
  ): Promise<ErpBackendExecSuccess> {
    const args = buildBenchArgs(action, buildInput);
    const result = await execCommand("docker", args, { timeoutMs: env.ERP_COMMAND_TIMEOUT_MS });
    return {
      stdout: result.stdout,
      stderr: result.stderr,
      durationMs: result.durationMs,
    };
  }
}
