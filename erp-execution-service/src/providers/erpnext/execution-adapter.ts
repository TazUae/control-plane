import { readFile } from "node:fs/promises";
import path from "node:path";
import { ZodError } from "zod";
import { isUnexpectedDbNameFormat, parseSiteConfig } from "erp-utils";
import type { Env } from "../../config/env.js";
import { callErp, ErpCallError } from "../../lib/call-erp.js";
import type { RemoteExecuteRequest } from "../../contracts/lifecycle.js";
import type { RemoteExecutionFailure } from "../../contracts/lifecycle.js";
import { validateDomain, validateSite, validateUsername } from "./validation.js";
import { mapErpCallErrorToFailure } from "./result-mapper.js";
import type { Logger } from "pino";
import type { ReadSiteDbNameResult } from "./site-config.js";
import { verifyMariaDbSchemaExists } from "./mariadb-schema-validator.js";

export type CreateSiteResult = {
  success: true;
  site: string;
  dbName: string;
};

export type LifecycleActionOutcome =
  | { ok: true; durationMs: number; metadata?: Record<string, string | number | boolean> }
  | { ok: false; failure: RemoteExecutionFailure };

export type LifecycleAdapter = {
  run(request: RemoteExecuteRequest): Promise<LifecycleActionOutcome>;
};

const SITE_CONFIG_POLL_MAX_ATTEMPTS = 5;
const SITE_CONFIG_POLL_INTERVAL_MS = 1000;

const ERP_METHOD = {
  createSite: "/api/method/frappe.api.provisioning.create_site",
  installErp: "/api/method/frappe.api.provisioning.install_erp",
  enableScheduler: "/api/method/frappe.api.provisioning.enable_scheduler",
  addDomain: "/api/method/frappe.api.provisioning.add_domain",
  createApiUser: "/api/method/frappe.api.provisioning.create_api_user",
  healthPing: "/api/method/frappe.ping",
} as const;

/**
 * Polls until `site_config.json` exists and contains `db_name` (no fixed delay).
 * Raw paths only; no shell.
 */
async function waitForSiteConfig(
  benchPath: string,
  site: string,
  log: Logger
): Promise<{ dbName: string; attempts: number; waitMs: number }> {
  const filePath = path.join(benchPath, "sites", site, "site_config.json");
  const started = Date.now();
  for (let i = 0; i < SITE_CONFIG_POLL_MAX_ATTEMPTS; i++) {
    try {
      const data = await readFile(filePath, "utf-8");
      const { dbName } = parseSiteConfig(data);
      const waitMs = Date.now() - started;
      if (i > 0) {
        log.info(
          {
            metric: "site_config_retry_count",
            value: i + 1,
            site,
            attempts: i + 1,
          },
          "site_config became ready after retries"
        );
      }
      return { dbName, attempts: i + 1, waitMs };
    } catch {
      // retry
    }
    log.debug(
      {
        metric: "site_config_retry_count",
        attempt: i + 1,
        site,
      },
      "site_config not ready yet"
    );
    await new Promise((r) => setTimeout(r, SITE_CONFIG_POLL_INTERVAL_MS));
  }
  throw new Error("SITE_CONFIG_NOT_READY");
}

/**
 * HTTP-only ERP lifecycle: allowlisted POSTs to Frappe methods; no bench or subprocesses.
 */
export class ErpExecutionAdapter implements LifecycleAdapter {
  constructor(
    private readonly env: Env,
    private readonly logger: Logger
  ) {}

  async run(request: RemoteExecuteRequest): Promise<LifecycleActionOutcome> {
    const log = this.childLog(request.requestId);
    try {
      switch (request.action) {
        case "createSite":
          return await this.runCreateSite(validateSite(request.payload.site), log);
        case "readSiteDbName":
          return await this.runReadSiteDbName(validateSite(request.payload.site), log);
        case "installErp":
          return await this.runSimpleErpCall(
            "installErp",
            ERP_METHOD.installErp,
            { site_name: validateSite(request.payload.site) },
            log
          );
        case "enableScheduler":
          return await this.runSimpleErpCall(
            "enableScheduler",
            ERP_METHOD.enableScheduler,
            { site_name: validateSite(request.payload.site) },
            log
          );
        case "addDomain":
          return await this.runSimpleErpCall(
            "addDomain",
            ERP_METHOD.addDomain,
            {
              site_name: validateSite(request.payload.site),
              domain: validateDomain(request.payload.domain),
            },
            log
          );
        case "createApiUser":
          return await this.runSimpleErpCall(
            "createApiUser",
            ERP_METHOD.createApiUser,
            {
              site_name: validateSite(request.payload.site),
              api_username: validateUsername(request.payload.apiUsername),
            },
            log
          );
        case "healthCheck":
          return await this.runHealthCheck(request.payload.deep === true, log);
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

  private childLog(requestId?: string): Logger {
    return requestId ? this.logger.child({ requestId }) : this.logger;
  }

  private async runReadSiteDbName(site: string, log: Logger): Promise<LifecycleActionOutcome> {
    const started = Date.now();
    const extracted = await this.extractDbNameFromSiteConfig(site, started, log);
    if (!extracted.ok) {
      return { ok: false, failure: extracted.failure };
    }
    const durationMs = Date.now() - started;
    log.info({ site, dbName: extracted.dbName, durationMs, metric: "dbName_extracted" }, "dbName extracted (readSiteDbName)");
    return {
      ok: true,
      durationMs,
      metadata: {
        site,
        dbName: extracted.dbName,
      },
    };
  }

  /**
   * Reads `sites/<slug>/site_config.json` and returns `db_name` (filesystem + JSON parse only; no shell).
   */
  private async extractDbNameFromSiteConfig(
    site: string,
    startedAt: number,
    log: Logger
  ): Promise<{ ok: true; dbName: string } | { ok: false; failure: RemoteExecutionFailure }> {
    let read: ReadSiteDbNameResult;
    let siteConfigWaitMs = 0;

    try {
      const polled = await waitForSiteConfig(this.env.ERP_BENCH_PATH, site, log);
      const unexpectedDbNameFormat = isUnexpectedDbNameFormat(polled.dbName);
      read = { ok: true, dbName: polled.dbName, unexpectedDbNameFormat };
      siteConfigWaitMs = polled.waitMs;
      if (polled.attempts > 1) {
        log.info(
          { site, metric: "site_config_retry_count", value: polled.attempts },
          "site_config polling completed"
        );
      }
    } catch (e) {
      if (e instanceof Error && e.message === "SITE_CONFIG_NOT_READY") {
        log.error(
          { site, metric: "provisioning_dbname_missing", value: 1 },
          "site_config.json not ready after retries"
        );
        return {
          ok: false,
          failure: {
            code: "ERP_PARTIAL_SUCCESS",
            message: "site_config.json not ready after site operation",
            retryable: true,
            details: "SITE_CONFIG_NOT_READY",
          },
        };
      }
      throw e;
    }

    const durationMs = Date.now() - startedAt;

    if (read.unexpectedDbNameFormat) {
      log.warn(
        { site, dbName: read.dbName, durationMs },
        "db_name has unexpected shape (accepted; verify Frappe version compatibility)"
      );
    }

    if (this.env.ERP_VALIDATE_DB_SCHEMA) {
      const exists = await verifyMariaDbSchemaExists(
        {
          host: this.env.ERP_DB_HOST,
          port: this.env.ERP_DB_PORT,
          user: this.env.ERP_DB_READONLY_USER!,
          password: this.env.ERP_DB_READONLY_PASSWORD!,
        },
        read.dbName,
        log
      );
      if (!exists) {
        log.error(
          { site, dbName: read.dbName, durationMs, metric: "provisioning_dbname_missing", value: 1 },
          "MariaDB schema missing for db_name"
        );
        return {
          ok: false,
          failure: {
            code: "ERP_PARTIAL_SUCCESS",
            message: "ERP database schema not found for site_config db_name",
            retryable: true,
            details: `information_schema.SCHEMATA has no SCHEMA_NAME=${read.dbName}`,
          },
        };
      }
    }

    log.info(
      { site, dbName: read.dbName, durationMs, siteConfigWaitMs, metric: "dbName_extracted" },
      "dbName extracted and validated"
    );
    return { ok: true, dbName: read.dbName };
  }

  private async runSimpleErpCall(
    action: string,
    endpoint: string,
    payload: Record<string, string>,
    log: Logger
  ): Promise<LifecycleActionOutcome> {
    const started = Date.now();
    try {
      await callErp(this.env, log, endpoint, payload);
      const durationMs = Date.now() - started;
      log.debug({ action, durationMs }, "ERP lifecycle action completed");
      return { ok: true, durationMs };
    } catch (e) {
      if (!(e instanceof ErpCallError)) {
        throw e;
      }
      log.warn(
        {
          action,
          kind: e.kind,
          status: e.options.status,
          message: e.message,
        },
        "ERP HTTP action failed"
      );
      return { ok: false, failure: mapErpCallErrorToFailure(e) };
    }
  }

  private async runCreateSite(site: string, log: Logger): Promise<LifecycleActionOutcome> {
    const started = Date.now();
    try {
      const data = await callErp(this.env, log, ERP_METHOD.createSite, {
        site_name: site,
        admin_password: this.env.ERP_ADMIN_PASSWORD,
      });

      const ok = data.ok === true || data.ok === undefined;
      const siteOut = typeof data.site === "string" ? data.site : site;
      if (!ok) {
        return {
          ok: false,
          failure: {
            code: "ERP_COMMAND_FAILED",
            message: String(data.error ?? "ERP create_site failed"),
            retryable: false,
          },
        };
      }

      log.debug({ action: "createSite", site: siteOut }, "create_site ERP payload accepted");

      const extractStarted = Date.now();
      const extracted = await this.extractDbNameFromSiteConfig(siteOut, extractStarted, log);
      if (!extracted.ok) {
        return { ok: false, failure: extracted.failure };
      }

      const durationMs = Date.now() - started;
      const createSiteResult: CreateSiteResult = { success: true, site: siteOut, dbName: extracted.dbName };

      log.info(
        {
          site: createSiteResult.site,
          dbName: createSiteResult.dbName,
          metric: "dbName_persisted",
          durationMs,
        },
        "createSite succeeded with db_name validation"
      );

      return {
        ok: true,
        durationMs,
        metadata: {
          site: createSiteResult.site,
          dbName: createSiteResult.dbName,
        },
      };
    } catch (e) {
      if (!(e instanceof ErpCallError)) {
        throw e;
      }
      log.warn(
        {
          action: "createSite",
          kind: e.kind,
          status: e.options.status,
          message: e.message,
        },
        "ERP HTTP action failed"
      );

      const failure = mapErpCallErrorToFailure(e);
      if (failure.code === "SITE_ALREADY_EXISTS") {
        const extractStarted = Date.now();
        const extracted = await this.extractDbNameFromSiteConfig(site, extractStarted, log);
        if (extracted.ok === true) {
          const durationMs = Date.now() - started;
          log.info(
            {
              site,
              dbName: extracted.dbName,
              idempotentCreateSite: true,
              durationMs,
              metric: "dbName_persisted",
            },
            "createSite idempotent: dbName extracted from existing site"
          );
          return {
            ok: true,
            durationMs,
            metadata: {
              site,
              dbName: extracted.dbName,
              idempotentCreateSite: true,
            },
          };
        }
      }

      return { ok: false, failure };
    }
  }

  private async runHealthCheck(deep: boolean, log: Logger): Promise<LifecycleActionOutcome> {
    const startedAt = Date.now();
    try {
      await callErp(this.env, log, ERP_METHOD.healthPing, {});
      const durationMs = Date.now() - startedAt;
      const metadata: Record<string, string | number | boolean> = { status: "ok" };
      if (deep) {
        metadata.deep = true;
      }
      return { ok: true, durationMs, metadata };
    } catch (e) {
      if (!(e instanceof ErpCallError)) {
        throw e;
      }
      log.warn({ kind: e.kind, message: e.message }, "health check failed");
      return { ok: false, failure: mapErpCallErrorToFailure(e) };
    }
  }
}
