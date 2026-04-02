import { z } from "zod";

export const ProvisioningErrorCodeSchema = z.enum([
  "INFRA_UNAVAILABLE",
  "ERP_COMMAND_FAILED",
  "ERP_VALIDATION_FAILED",
  "ERP_TIMEOUT",
  "ERP_PARTIAL_SUCCESS",
  "SITE_ALREADY_EXISTS",
]);

export type ProvisioningErrorCode = z.infer<typeof ProvisioningErrorCodeSchema>;

export const SiteOperationRequestSchema = z.object({
  site: z
    .string()
    .trim()
    .min(3)
    .max(50)
    .regex(/^[a-z0-9-]+$/, "site must match ^[a-z0-9-]+$"),
  context: z
    .object({
      requestId: z.string().min(1).optional(),
      tenantId: z.string().min(1).optional(),
    })
    .optional(),
});

export type SiteOperationRequest = z.infer<typeof SiteOperationRequestSchema>;

export const ProvisioningOperationResultSchema = z.object({
  action: z.string().min(1),
  site: z.string().trim().min(1),
  message: z.string().min(1).optional(),
  outcome: z.enum(["applied", "already_done"]).default("applied"),
  alreadyExists: z.boolean().optional(),
  alreadyInstalled: z.boolean().optional(),
  alreadyConfigured: z.boolean().optional(),
  durationMs: z.number().int().nonnegative().optional(),
});

export type ProvisioningOperationResult = z.infer<typeof ProvisioningOperationResultSchema>;

export const ProvisioningFailureSchema = z.object({
  code: ProvisioningErrorCodeSchema,
  message: z.string().min(1),
  retryable: z.boolean(),
  details: z.string().optional(),
});

export type ProvisioningFailure = z.infer<typeof ProvisioningFailureSchema>;

export const SuccessEnvelopeSchema = <TPayload extends z.ZodTypeAny>(payloadSchema: TPayload) =>
  z.object({
    ok: z.literal(true),
    data: payloadSchema,
    timestamp: z.string().datetime(),
  });

export const FailureEnvelopeSchema = z.object({
  ok: z.literal(false),
  error: ProvisioningFailureSchema,
  timestamp: z.string().datetime(),
});

export const HealthResponseDataSchema = z.object({
  status: z.enum(["ok", "degraded", "down"]),
  service: z.string().min(1),
  version: z.string().min(1).optional(),
});

export type SuccessEnvelope<TPayload> = {
  ok: true;
  data: TPayload;
  timestamp: string;
};

export type FailureEnvelope = z.infer<typeof FailureEnvelopeSchema>;
