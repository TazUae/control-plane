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
import { ProvisioningAdapter, ProvisioningOperationResult } from "./interface.js";

type FetchLike = typeof fetch;

type HttpProvisioningAdapterOptions = {
  baseUrl?: string;
  token?: string;
  timeoutMs?: number;
  fetchFn?: FetchLike;
};

const DEFAULT_TIMEOUT_MS = 120_000;

const SiteOperationSuccessEnvelopeSchema = SuccessEnvelopeSchema(SiteOperationResponseDataSchema);
const HealthSuccessEnvelopeSchema = SuccessEnvelopeSchema(HealthResponseDataSchema);

export class HttpProvisioningAdapter implements ProvisioningAdapter {
  public readonly kind = "http-provisioning" as const;
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly timeoutMs: number;
  private readonly fetchFn: FetchLike;

  constructor(options: HttpProvisioningAdapterOptions = {}) {
    this.baseUrl = (options.baseUrl ?? env.PROVISIONING_API_URL ?? "").replace(/\/+$/, "");
    this.token = options.token ?? env.PROVISIONING_API_TOKEN ?? "";
    this.timeoutMs = options.timeoutMs ?? env.PROVISIONING_API_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS;
    this.fetchFn = options.fetchFn ?? fetch;

    if (!this.baseUrl) {
      throw new ProvisioningError("INFRA_UNAVAILABLE", "Provisioning API URL is not configured", {
        retryable: false,
      });
    }
    if (!this.token) {
      throw new ProvisioningError("INFRA_UNAVAILABLE", "Provisioning API token is not configured", {
        retryable: false,
      });
    }
  }

  async createSite(site: string): Promise<ProvisioningOperationResult> {
    return this.callSiteOperation("/sites/create", "createSite", site);
  }

  async installErp(site: string): Promise<ProvisioningOperationResult> {
    return this.callSiteOperation("/sites/install-erp", "installErp", site);
  }

  async enableScheduler(site: string): Promise<ProvisioningOperationResult> {
    return this.callSiteOperation("/sites/enable-scheduler", "enableScheduler", site);
  }

  async addDomain(site: string): Promise<ProvisioningOperationResult> {
    return this.callSiteOperation("/sites/add-domain", "addDomain", site);
  }

  async createApiUser(site: string): Promise<ProvisioningOperationResult> {
    return this.callSiteOperation("/sites/create-api-user", "createApiUser", site);
  }

  async healthCheck(site: string): Promise<ProvisioningOperationResult> {
    assertValidSlugOrSite(site, "site");
    const endpoint = "/health";
    const json = await this.request("GET", endpoint);
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
    site: string
  ): Promise<ProvisioningOperationResult> {
    assertValidSlugOrSite(site, "site");
    const json = await this.request("POST", endpoint, { site });
    const success = SiteOperationSuccessEnvelopeSchema.safeParse(json);
    if (!success.success) {
      throw new ProvisioningError("ERP_PARTIAL_SUCCESS", "Invalid provisioning API success payload", {
        details: success.error.message,
        retryable: false,
      });
    }
    return {
      action: success.data.data.action || action,
      stdout: success.data.data.stdout,
      stderr: success.data.data.stderr,
    };
  }

  private async request(method: "GET" | "POST", endpoint: string, body?: unknown): Promise<unknown> {
    const url = `${this.baseUrl}${endpoint}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    logger.info(
      {
        adapter: "http-provisioning",
        method,
        endpoint,
        timeoutMs: this.timeoutMs,
      },
      "Provisioning HTTP request started"
    );

    try {
      const response = await this.fetchFn(url, {
        method,
        headers: {
          Authorization: `Bearer ${this.token}`,
          "Content-Type": "application/json",
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      const rawText = await response.text();
      const parsedBody = this.tryParseJson(rawText);

      if (!response.ok) {
        const failedEnvelope = FailureEnvelopeSchema.safeParse(parsedBody);
        if (failedEnvelope.success) {
          throw this.mapFailureEnvelopeToProvisioningError(failedEnvelope.data.error);
        }
        throw this.mapHttpStatusToProvisioningError(response.status, rawText);
      }

      logger.info(
        {
          adapter: "http-provisioning",
          method,
          endpoint,
          status: response.status,
        },
        "Provisioning HTTP request succeeded"
      );

      if (parsedBody === undefined) {
        throw new ProvisioningError("ERP_PARTIAL_SUCCESS", "Provisioning API returned non-JSON success body", {
          details: rawText.slice(0, 500),
          retryable: false,
        });
      }

      return parsedBody;
    } catch (error) {
      if (error instanceof ProvisioningError) {
        throw error;
      }

      if (controller.signal.aborted || this.isAbortError(error)) {
        throw new ProvisioningError("ERP_TIMEOUT", "Provisioning API request timed out", {
          details: `Request to ${endpoint} exceeded ${this.timeoutMs}ms`,
        });
      }

      throw new ProvisioningError("INFRA_UNAVAILABLE", "Provisioning API request failed", {
        details: error instanceof Error ? error.message : String(error),
        cause: error,
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
    });
  }

  private mapHttpStatusToProvisioningError(status: number, rawText: string): ProvisioningError {
    if (status >= 500) {
      return new ProvisioningError("INFRA_UNAVAILABLE", "Provisioning API unavailable", {
        details: `HTTP ${status}: ${rawText.slice(0, 500)}`,
      });
    }

    return new ProvisioningError("ERP_COMMAND_FAILED", "Provisioning API returned an error response", {
      details: `HTTP ${status}: ${rawText.slice(0, 500)}`,
      retryable: false,
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
