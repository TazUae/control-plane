import { execCommand } from "../../lib/exec.js";
import { env } from "../../config/env.js";
import { buildBenchOperationArgs } from "./commands.js";
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
 * Preferred non-Docker backend when the agent runs on the same host (or VM) as the Frappe bench:
 * runs the same allowlisted `bench` subcommands as `DockerExecBackend`, with `cwd` set to the bench
 * directory. No `docker exec`; still no arbitrary argv — only `buildBenchOperationArgs`.
 */
export class HostBenchExecBackend implements ErpExecutionBackend {
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
    action: Parameters<typeof buildBenchOperationArgs>[0],
    buildInput: Parameters<typeof buildBenchOperationArgs>[1]
  ): Promise<ErpBackendExecSuccess> {
    const args = buildBenchOperationArgs(action, buildInput);
    const result = await execCommand(env.ERP_BENCH_EXECUTABLE, args, {
      cwd: env.ERP_BENCH_PATH,
      timeoutMs: env.ERP_COMMAND_TIMEOUT_MS,
    });
    return {
      stdout: result.stdout,
      stderr: result.stderr,
      durationMs: result.durationMs,
    };
  }
}
