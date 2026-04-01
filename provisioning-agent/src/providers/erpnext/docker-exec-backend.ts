import { execCommand } from "../../lib/exec.js";
import { env } from "../../config/env.js";
import { buildDockerExecBenchArgv } from "./commands.js";
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
 * Temporary compatibility when `ERP_EXECUTION_MODE=docker` (default): allowlisted bench operations
 * via `docker exec` into `ERP_CONTAINER_NAME`. For generic agent containers without bench; long-term
 * Option 2 is `host_bench` on an ERP-side runtime (docs/erp-side-runbook.md, docs/erp-side-runtime.md).
 * Do not add generic exec passthrough here.
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
    action: Parameters<typeof buildDockerExecBenchArgv>[0],
    buildInput: Parameters<typeof buildDockerExecBenchArgv>[1]
  ): Promise<ErpBackendExecSuccess> {
    const args = buildDockerExecBenchArgv(action, buildInput);
    const result = await execCommand("docker", args, { timeoutMs: env.ERP_COMMAND_TIMEOUT_MS });
    return {
      stdout: result.stdout,
      stderr: result.stderr,
      durationMs: result.durationMs,
    };
  }
}
