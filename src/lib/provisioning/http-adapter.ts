import { env } from "../../config/env.js";
import { logger } from "../logger.js";
import { assertValidSlugOrSite } from "../validation.js";
import {
  FailureEnvelopeSchema,
  HealthResponseDataSchema,
  ProvisioningFailure,
  SiteOperationResponseDataSchema,
  SuccessEnvelopeSchema,
} from "./contract.js";
import { ProvisioningError } from "./errors.js";
import { ProvisioningAdapter, ProvisioningCallContext, ProvisioningOperationResult } from "./interface.js";

type FetchLike = typeof fetch;

/** Test-only overrides; production uses `PROVISIONING_API_URL` and related env keys only. */
type HttpProvisioningAdapterOptions = {
  timeoutMs?: number;
  fetchFn?: FetchLike;
};

const SiteOperationSuccessEnvelopeSchema = SuccessEnvelopeSchema(SiteOperationResponseDataSchema);
const HealthSuccessEnvelopeSchema = SuccessEnvelopeSchema(HealthResponseDataSchema);

export class HttpProvisioningAdapter implements ProvisioningAdapter {
  public readonly kind = "http-provisioning" as const;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchFn: FetchLike;

  constructor(options: HttpProvisioningAdapterOptions = {}) {
    this.baseUrl = env.PROVISIONING_API_URL.replace(/\/+$/, "");
    this.timeoutMs = options.timeoutMs ?? env.PROVISIONING_API_TIMEOUT_MS;
    this.fetchFn = options.fetchFn ?? fetch;
  }

  async createSite(site: string, ctx?: ProvisioningCallContext): Promise<ProvisioningOperationResult> {
    assertValidSlugOrSite(site, "site");
    const siteName = site;
    const payload = {
      siteName,
      domain: `${siteName}.${env.ERP_BASE_DOMAIN}`,
      apiUsername: `cp_${siteName}`,
    };
    const url = `${this.baseUrl}/sites/create`;
    logger.info({ url, payload }, "Calling provisioning API");
    const json = await this.request("POST", "/sites/create", payload, ctx, { provisioningApiDetailedLogs: true });
    const success = SiteOperationSuccessEnvelopeSchema.safeParse(json);
    if (!success.success) {
      throw new ProvisioningError("ERP_PARTIAL_SUCCESS", "Invalid provisioning API success payload", {
        details: success.error.message,
        retryable: false,
      });
    }
    return {
      action: success.data.data.action || "createSite",
      dbName: success.data.data.dbName,
      outcome: success.data.data.outcome,
      alreadyExists: success.data.data.alreadyExists,
      alreadyInstalled: success.data.data.alreadyInstalled,
      alreadyConfigured: success.data.data.alreadyConfigured,
      stdout: success.data.data.stdout,
      stderr: success.data.data.stderr,
    };
  }

  async resolveSiteDbName(site: string, ctx?: ProvisioningCallContext): Promise<ProvisioningOperationResult> {
    return this.callSiteOperation("/sites/read-db-name", "readSiteDbName", site, ctx);
  }

  async installErp(site: string, ctx?: ProvisioningCallContext): Promise<ProvisioningOperationResult> {
    return this.callSiteOperation("/sites/install-erp", "installErp", site, ctx);
  }

  async installFitdesk(site: string, ctx?: ProvisioningCallContext): Promise<ProvisioningOperationResult> {
    return this.callSiteOperation("/sites/install-fitdesk", "installFitdesk", site, ctx);
  }

  async enableScheduler(site: string, ctx?: ProvisioningCallContext): Promise<ProvisioningOperationResult> {
    return this.callSiteOperation("/sites/enable-scheduler", "enableScheduler", site, ctx);
  }

  async addDomain(site: string, ctx?: ProvisioningCallContext): Promise<ProvisioningOperationResult> {
    return this.callSiteOperation("/sites/add-domain", "addDomain", site, ctx);
  }

  async createApiUser(site: string, ctx?: ProvisioningCallContext): Promise<ProvisioningOperationResult> {
    return this.callSiteOperation("/sites/create-api-user", "createApiUser", site, ctx);
  }

  async healthCheck(site: string, ctx?: ProvisioningCallContext): Promise<ProvisioningOperationResult> {
    assertValidSlugOrSite(site, "site");
    const endpoint = "/health";
    const json = await this.request("GET", endpoint, undefined, ctx);
    const success = HealthSuccessEnvelopeSchema.safeParse(json);
    if (!success.success) {
      throw new ProvisioningError("ERP_PARTIAL_SUCCESS", "Invalid provisioning health response payload", {
        details: success.error.message,
        retryable: false,
      });
    }
    return {
      action: "healthCheck",
      stdout: success.data.data.status,
      stderr: undefined,
    };
  }

  private async callSiteOperation(
    endpoint: string,
    action: string,
    site: string,
    ctx?: ProvisioningCallContext
  ): Promise<ProvisioningOperationResult> {
    assertValidSlugOrSite(site, "site");
    const payload: Record<string, unknown> = { site };
    if (ctx?.requestId || ctx?.tenantId) {
      payload.context = {
        ...(ctx.requestId ? { requestId: ctx.requestId } : {}),
        ...(ctx.tenantId ? { tenantId: ctx.tenantId } : {}),
      };
    }
    const json = await this.request("POST", endpoint, payload, ctx);
    const success = SiteOperationSuccessEnvelopeSchema.safeParse(json);
    if (!success.success) {
      throw new ProvisioningError("ERP_PARTIAL_SUCCESS", "Invalid provisioning API success payload", {
        details: success.error.message,
        retryable: false,
      });
    }
    return {
      action: success.data.data.action || action,
      dbName: success.data.data.dbName,
      outcome: success.data.data.outcome,
      alreadyExists: success.data.data.alreadyExists,
      alreadyInstalled: success.data.data.alreadyInstalled,
      alreadyConfigured: success.data.data.alreadyConfigured,
      stdout: success.data.data.stdout,
      stderr: success.data.data.stderr,
    };
  }

  private async request(
    method: "GET" | "POST",
    endpoint: string,
    body?: unknown,
    ctx?: ProvisioningCallContext,
    options?: { provisioningApiDetailedLogs?: boolean }
  ): Promise<unknown> {
    const url = new URL(endpoint, `${this.baseUrl}/`).href;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    logger.info(
      {
        adapter: "http-provisioning",
        method,
        endpoint,
        timeoutMs: this.timeoutMs,
        ...(ctx?.requestId ? { requestId: ctx.requestId } : {}),
        ...(ctx?.tenantId ? { tenantId: ctx.tenantId } : {}),
      },
      "Provisioning HTTP request started"
    );

    try {
      const headers: Record<string, string> = {
        Authorization: `Bearer ${env.PROVISIONING_API_TOKEN}`,
        ...(method === "POST" ? { "Content-Type": "application/json" } : {}),
        ...(ctx?.requestId ? { "x-request-id": ctx.requestId } : {}),
      };
      const response = await this.fetchFn(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      const rawText = await response.text();
      const parsedBody = this.tryParseJson(rawText);

      if (!response.ok) {
        if (options?.provisioningApiDetailedLogs) {
          logger.error(
            {
              error: `HTTP ${response.status}`,
              response: parsedBody ?? rawText,
            },
            "Provisioning API failed"
          );
        }
        const failedEnvelope = FailureEnvelopeSchema.safeParse(parsedBody);
        if (failedEnvelope.success) {
          throw this.mapFailureEnvelopeToProvisioningError(failedEnvelope.data.error);
        }
        throw this.mapHttpStatusToProvisioningError(response.status, rawText);
      }

      if (options?.provisioningApiDetailedLogs) {
        logger.info({ status: response.status, data: parsedBody }, "Provisioning API response");
      }

      logger.info(
        {
          adapter: "http-provisioning",
          method,
          endpoint,
          status: response.status,
          ...(ctx?.requestId ? { requestId: ctx.requestId } : {}),
        },
        "Provisioning HTTP request succeeded"
      );

      if (parsedBody === undefined) {
        throw new ProvisioningError("ERP_PARTIAL_SUCCESS", "Provisioning API returned non-JSON success body", {
          details: rawText.slice(0, 500),
          retryable: false,
          raw: { rawTextPreview: rawText.slice(0, 500) },
        });
      }

      return parsedBody;
    } catch (error) {
      if (error instanceof ProvisioningError) {
        throw error;
      }

      if (options?.provisioningApiDetailedLogs) {
        logger.error(
          {
            error: error instanceof Error ? error.message : String(error),
            response: undefined,
          },
          "Provisioning API failed"
        );
      }

      if (controller.signal.aborted || this.isAbortError(error)) {
        throw new ProvisioningError("ERP_TIMEOUT", "Provisioning API request timed out", {
          details: `Request to ${endpoint} exceeded ${this.timeoutMs}ms`,
          raw: { endpoint, timeoutMs: this.timeoutMs },
        });
      }

      throw new ProvisioningError("INFRA_UNAVAILABLE", "Provisioning API request failed", {
        details: error instanceof Error ? error.message : String(error),
        cause: error,
        raw: error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : error,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  private tryParseJson(rawText: string): unknown | undefined {
    if (!rawText) {
      return undefined;
    }
    try {
      return JSON.parse(rawText);
    } catch {
      return undefined;
    }
  }

  private mapFailureEnvelopeToProvisioningError(error: ProvisioningFailure): ProvisioningError {
    return new ProvisioningError(error.code, error.message, {
      retryable: error.retryable,
      details: error.details,
      stdout: error.stdout,
      stderr: error.stderr,
      exitCode: error.exitCode,
      raw: error,
    });
  }

  private mapHttpStatusToProvisioningError(status: number, rawText: string): ProvisioningError {
    const raw = { httpStatus: status, body: rawText.slice(0, 4000) };
    if (status >= 500) {
      return new ProvisioningError("INFRA_UNAVAILABLE", "Provisioning API unavailable", {
        details: `HTTP ${status}: ${rawText.slice(0, 500)}`,
        raw,
      });
    }

    return new ProvisioningError("ERP_COMMAND_FAILED", "Provisioning API returned an error response", {
      details: `HTTP ${status}: ${rawText.slice(0, 500)}`,
      retryable: false,
      raw,
    });
  }

  private isAbortError(error: unknown): boolean {
    return (
      typeof error === "object" &&
      error !== null &&
      "name" in error &&
      (error as { name?: string }).name === "AbortError"
    );
  }
}
