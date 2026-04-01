import { spawn } from "node:child_process";
import { env } from "../../config/env.js";
import { logger } from "../logger.js";
import { assertValidSlugOrSite } from "../validation.js";
import { ProvisioningAdapter, ProvisioningOperationResult } from "./interface.js";
import { ProvisioningError } from "./errors.js";

type Action = "createSite" | "installErp" | "enableScheduler" | "addDomain" | "createApiUser" | "healthCheck";

type CommandResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
};

const BENCH_CWD = "/home/frappe/frappe-bench";
const DEFAULT_TIMEOUT_MS = 120_000;

export class DockerBenchProvisioningAdapter implements ProvisioningAdapter {
  public readonly kind = "docker-bench" as const;

  async createSite(site: string): Promise<ProvisioningOperationResult> {
    assertValidSlugOrSite(site, "site");
    const result = await this.executeProvisioningAction({
      action: "createSite",
      site,
      args: [
        "exec",
        "-w",
        BENCH_CWD,
        env.ERP_CONTAINER_NAME,
        "bench",
        "new-site",
        site,
        "--admin-password",
        env.ERP_ADMIN_PASSWORD,
        "--db-type",
        "mariadb",
      ],
    });
    return { action: "createSite", stdout: result.stdout, stderr: result.stderr };
  }

  async installErp(site: string): Promise<ProvisioningOperationResult> {
    assertValidSlugOrSite(site, "site");
    return this.stubbedAction("installErp", site);
  }

  async enableScheduler(site: string): Promise<ProvisioningOperationResult> {
    assertValidSlugOrSite(site, "site");
    return this.stubbedAction("enableScheduler", site);
  }

  async addDomain(site: string): Promise<ProvisioningOperationResult> {
    assertValidSlugOrSite(site, "site");
    return this.stubbedAction("addDomain", site);
  }

  async createApiUser(site: string): Promise<ProvisioningOperationResult> {
    assertValidSlugOrSite(site, "site");
    return this.stubbedAction("createApiUser", site);
  }

  async healthCheck(site: string): Promise<ProvisioningOperationResult> {
    assertValidSlugOrSite(site, "site");
    return this.stubbedAction("healthCheck", site);
  }

  private async stubbedAction(action: Action, site: string): Promise<ProvisioningOperationResult> {
    logger.info(
      { temporaryBridge: true, adapter: "docker-bench", action, site },
      "Temporary bridge action simulated for internal validation"
    );
    return { action, stdout: "simulated" };
  }

  private async executeProvisioningAction(input: {
    action: Action;
    site: string;
    args: string[];
    timeoutMs?: number;
  }): Promise<CommandResult> {
    const { action, site, args, timeoutMs = DEFAULT_TIMEOUT_MS } = input;
    logger.info(
      {
        temporaryBridge: true,
        adapter: "docker-bench",
        action,
        site,
        timeoutMs,
      },
      "Provisioning host action started"
    );

    return await new Promise<CommandResult>((resolve, reject) => {
      const child = spawn("docker", args, {
        stdio: ["ignore", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGTERM");
      }, timeoutMs);

      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString();
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });

      child.on("error", (error: NodeJS.ErrnoException) => {
        clearTimeout(timer);
        reject(
          new ProvisioningError("INFRA_UNAVAILABLE", "Provisioning infrastructure command unavailable", {
            details: error.message,
            cause: error,
            stdout: stdout.trim(),
            stderr: stderr.trim(),
          })
        );
      });

      child.on("close", (code) => {
        clearTimeout(timer);
        const trimmedStdout = stdout.trim();
        const trimmedStderr = stderr.trim();

        if (timedOut) {
          reject(
            new ProvisioningError("ERP_TIMEOUT", "Provisioning action timed out", {
              details: `Action ${action} exceeded ${timeoutMs}ms`,
              stdout: trimmedStdout,
              stderr: trimmedStderr,
            })
          );
          return;
        }

        if ((code ?? 1) !== 0) {
          const combined = `${trimmedStdout}\n${trimmedStderr}`.toLowerCase();
          if (combined.includes("already exists")) {
            reject(
              new ProvisioningError("SITE_ALREADY_EXISTS", "ERP site already exists", {
                details: `Action ${action} reported already-existing site`,
                stdout: trimmedStdout,
                stderr: trimmedStderr,
                exitCode: code ?? 1,
                retryable: false,
              })
            );
            return;
          }

          reject(
            new ProvisioningError("ERP_COMMAND_FAILED", "ERP command failed", {
              details: `Action ${action} failed with exit code ${code ?? 1}`,
              stdout: trimmedStdout,
              stderr: trimmedStderr,
              exitCode: code ?? 1,
              retryable: false,
            })
          );
          return;
        }

        logger.info(
          {
            temporaryBridge: true,
            adapter: "docker-bench",
            action,
            site,
          },
          "Provisioning host action succeeded"
        );
        resolve({ stdout: trimmedStdout, stderr: trimmedStderr, exitCode: code ?? 0 });
      });
    });
  }
}
