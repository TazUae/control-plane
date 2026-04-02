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
  HealthCheckInput,
  InstallErpInput,
} from "./erp-execution-backend.js";

/**
 * Non-Docker backend: same allowlisted `bench` subcommands as `DockerExecBackend`, `cwd` = bench dir.
 * The **process** must run in an ERP-side runtime with a real bench tree (docs/erp-side-runtime.md);
 * the stock slim Docker image alone is insufficient unless bench is mounted. No `docker exec`;
 * no arbitrary argv — only `buildBenchOperationArgs`.
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

  async healthCheck(_input: HealthCheckInput): Promise<ErpBackendExecSuccess> {
    const startedAt = Date.now();
    await execCommand(env.ERP_BENCH_EXECUTABLE, ["--version"], {
      cwd: env.ERP_BENCH_PATH,
      timeoutMs: env.ERP_COMMAND_TIMEOUT_MS,
    });
    return { durationMs: Date.now() - startedAt };
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
    return { durationMs: result.durationMs };
  }
}
