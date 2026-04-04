import { ZodError } from "zod";
import type { Env } from "../../config/env.js";
import { execArgv, type InternalExecError } from "../../lib/exec.js";
import type { RemoteExecuteRequest } from "../../contracts/lifecycle.js";
import type { RemoteExecutionFailure } from "../../contracts/lifecycle.js";
import { validateDomain, validateSite, validateUsername } from "./validation.js";
import { mapExecErrorToFailure } from "./result-mapper.js";
import type { Logger } from "pino";

export type LifecycleActionOutcome =
  | { ok: true; durationMs: number; metadata?: Record<string, string | number | boolean> }
  | { ok: false; failure: RemoteExecutionFailure };

export type LifecycleAdapter = {
  run(request: RemoteExecuteRequest): Promise<LifecycleActionOutcome>;
};

type AllowedProvisioningAction =
  | "createSite"
  | "installErp"
  | "enableScheduler"
  | "addDomain"
  | "createApiUser";

/** Delay before `bench new-site` so DB DNS/network is ready; avoids partial site dir without DB. */
const CREATE_SITE_DELAY_MS = 5000;

/**
 * Narrow bench execution: only allowlisted argv sequences; no shell, no passthrough.
 * Raw stdout/stderr are never returned to callers — use logger for diagnostics.
 */
export class ErpExecutionAdapter implements LifecycleAdapter {
  constructor(
    private readonly env: Env,
    private readonly logger: Logger
  ) {}

  async run(request: RemoteExecuteRequest): Promise<LifecycleActionOutcome> {
    try {
      switch (request.action) {
        case "createSite":
          return await this.runBenchAction("createSite", { site: validateSite(request.payload.site) });
        case "installErp":
          return await this.runBenchAction("installErp", { site: validateSite(request.payload.site) });
        case "enableScheduler":
          return await this.runBenchAction("enableScheduler", { site: validateSite(request.payload.site) });
        case "addDomain":
          return await this.runBenchAction("addDomain", {
            site: validateSite(request.payload.site),
            domain: validateDomain(request.payload.domain),
          });
        case "createApiUser":
          return await this.runBenchAction("createApiUser", {
            site: validateSite(request.payload.site),
            apiUsername: validateUsername(request.payload.apiUsername),
          });
        case "healthCheck":
          return await this.runHealthCheck(request.payload.deep === true);
        default: {
          const _never: never = request;
          return _never;
        }
      }
    } catch (error) {
      if (error instanceof ZodError) {
        return {
          ok: false,
          failure: {
            code: "ERP_VALIDATION_FAILED",
            message: "Invalid input for lifecycle action",
            retryable: false,
            details: error.message,
          },
        };
      }
      throw error;
    }
  }

  private buildBenchArgs(
    action: AllowedProvisioningAction,
    input: { site: string; domain?: string; apiUsername?: string }
  ): string[] {
    const site = input.site;

    switch (action) {
      case "createSite":
        return [
          "new-site",
          site,
          "--db-root-password",
          this.env.ERP_DB_ROOT_PASSWORD,
          "--admin-password",
          this.env.ERP_ADMIN_PASSWORD,
          "--db-host",
          "db",
          "--no-mariadb-socket",
        ];
      case "installErp":
        return ["--site", site, "install-app", "erpnext"];
      case "enableScheduler":
        return ["--site", site, "enable-scheduler"];
      case "addDomain": {
        const domain = input.domain;
        if (!domain) {
          throw new Error("domain is required for addDomain");
        }
        return [
          "--site",
          site,
          "execute",
          "frappe.api.provisioning.add_domain",
          "--args",
          `["${site}","${domain}"]`,
        ];
      }
      case "createApiUser": {
        const apiUsername = input.apiUsername;
        if (!apiUsername) {
          throw new Error("apiUsername is required for createApiUser");
        }
        return [
          "--site",
          site,
          "execute",
          "frappe.api.provisioning.create_api_user",
          "--args",
          `["${site}","${apiUsername}"]`,
        ];
      }
      default: {
        const _never: never = action;
        return _never;
      }
    }
  }

  private async runBenchAction(
    action: AllowedProvisioningAction,
    input: { site: string; domain?: string; apiUsername?: string }
  ): Promise<LifecycleActionOutcome> {
    const args = this.buildBenchArgs(action, input);
    try {
      if (action === "createSite") {
        await new Promise((r) => setTimeout(r, CREATE_SITE_DELAY_MS));
      }
      const result = await execArgv(this.env.ERP_BENCH_EXECUTABLE, args, {
        cwd: this.env.ERP_BENCH_PATH,
        timeoutMs: this.env.ERP_COMMAND_TIMEOUT_MS,
      });
      this.logger.debug(
        { action, durationMs: result.durationMs },
        "bench action completed"
      );
      const durationMs =
        action === "createSite"
          ? result.durationMs + CREATE_SITE_DELAY_MS
          : result.durationMs;
      return { ok: true, durationMs };
    } catch (error) {
      const execError = error as InternalExecError;
      this.logger.warn(
        {
          action,
          kind: execError.kind,
          durationMs: execError.durationMs,
          stderr: execError.stderr,
        },
        "bench action failed"
      );
      return { ok: false, failure: mapExecErrorToFailure(execError) };
    }
  }

  private async runHealthCheck(deep: boolean): Promise<LifecycleActionOutcome> {
    const startedAt = Date.now();
    try {
      await execArgv(this.env.ERP_BENCH_EXECUTABLE, ["--version"], {
        cwd: this.env.ERP_BENCH_PATH,
        timeoutMs: this.env.ERP_COMMAND_TIMEOUT_MS,
      });
      const durationMs = Date.now() - startedAt;
      const metadata: Record<string, string | number | boolean> = { status: "ok" };
      if (deep) {
        metadata.deep = true;
      }
      return { ok: true, durationMs, metadata };
    } catch (error) {
      const execError = error as InternalExecError;
      this.logger.warn(
        { kind: execError.kind, stderr: execError.stderr },
        "health check failed"
      );
      return { ok: false, failure: mapExecErrorToFailure(execError) };
    }
  }
}
