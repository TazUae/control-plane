import { z } from "zod";

/**
 * Shared provisioning error codes used by both adapter clients and
 * provisioning service implementations.
 */
export const ProvisioningErrorCodeSchema = z.enum([
  "INFRA_UNAVAILABLE",
  "ERP_COMMAND_FAILED",
  "ERP_VALIDATION_FAILED",
  "ERP_TIMEOUT",
  "ERP_PARTIAL_SUCCESS",
  "SITE_ALREADY_EXISTS",
]);

export type ProvisioningErrorCode = z.infer<typeof ProvisioningErrorCodeSchema>;

/**
 * Request context that can be attached to any endpoint payload for tracing.
 */
export const ProvisioningRequestContextSchema = z.object({
  requestId: z.string().min(1).optional(),
  tenantId: z.string().min(1).optional(),
});

export type ProvisioningRequestContext = z.infer<typeof ProvisioningRequestContextSchema>;

/**
 * Common request payload used by all site operation endpoints.
 */
export const SiteOperationRequestSchema = z.object({
  site: z.string().trim().min(1),
  context: ProvisioningRequestContextSchema.optional(),
});

export type SiteOperationRequest = z.infer<typeof SiteOperationRequestSchema>;

/**
 * Operation result details returned for successful provisioning actions.
 */
export const ProvisioningOperationResultSchema = z.object({
  action: z.string().min(1),
  site: z.string().trim().min(1),
  message: z.string().min(1).optional(),
  stdout: z.string().optional(),
  stderr: z.string().optional(),
  durationMs: z.number().int().nonnegative().optional(),
});

export type ProvisioningOperationResult = z.infer<typeof ProvisioningOperationResultSchema>;

/**
 * Failure payload shape shared by all provisioning endpoints.
 */
export const ProvisioningFailureSchema = z.object({
  code: ProvisioningErrorCodeSchema,
  message: z.string().min(1),
  retryable: z.boolean(),
  details: z.string().optional(),
  stdout: z.string().optional(),
  stderr: z.string().optional(),
  exitCode: z.number().int().optional(),
});

export type ProvisioningFailure = z.infer<typeof ProvisioningFailureSchema>;

/**
 * Framework-neutral success envelope for HTTP responses.
 */
export const SuccessEnvelopeSchema = <TPayload extends z.ZodTypeAny>(payloadSchema: TPayload) =>
  z.object({
    ok: z.literal(true),
    data: payloadSchema,
    timestamp: z.string().datetime(),
  });

/**
 * Framework-neutral failure envelope for HTTP responses.
 */
export const FailureEnvelopeSchema = z.object({
  ok: z.literal(false),
  error: ProvisioningFailureSchema,
  timestamp: z.string().datetime(),
});

export type SuccessEnvelope<TPayload> = {
  ok: true;
  data: TPayload;
  timestamp: string;
};

export type FailureEnvelope = z.infer<typeof FailureEnvelopeSchema>;
export type ProvisioningApiResponse<TPayload> = SuccessEnvelope<TPayload> | FailureEnvelope;

/**
 * GET /health contract.
 */
export const HealthResponseDataSchema = z.object({
  status: z.enum(["ok", "degraded", "down"]),
  service: z.string().min(1),
  version: z.string().min(1).optional(),
});

export type HealthResponseData = z.infer<typeof HealthResponseDataSchema>;
export type HealthResponse = ProvisioningApiResponse<HealthResponseData>;

/**
 * POST /sites/* response contract reused by each provisioning action endpoint.
 */
export const SiteOperationResponseDataSchema = ProvisioningOperationResultSchema;

export type SiteOperationResponseData = z.infer<typeof SiteOperationResponseDataSchema>;
export type SiteOperationResponse = ProvisioningApiResponse<SiteOperationResponseData>;

/**
 * Endpoint-specific request/response aliases for clarity at call sites.
 */
export type CreateSiteRequest = SiteOperationRequest;
export type CreateSiteResponse = SiteOperationResponse;

export type InstallErpRequest = SiteOperationRequest;
export type InstallErpResponse = SiteOperationResponse;

export type EnableSchedulerRequest = SiteOperationRequest;
export type EnableSchedulerResponse = SiteOperationResponse;

export type AddDomainRequest = SiteOperationRequest;
export type AddDomainResponse = SiteOperationResponse;

export type CreateApiUserRequest = SiteOperationRequest;
export type CreateApiUserResponse = SiteOperationResponse;
