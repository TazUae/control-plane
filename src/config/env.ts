import "dotenv/config";
import { z } from "zod";

/**
 * Application env keys (see root `.env.example`).
 * Postgres-only keys (`POSTGRES_*`) live in the same file for Docker Compose but are not read here.
 */
const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().url(),
  CONTROL_PLANE_API_KEY: z.string().min(16),
  PROVISIONING_API_URL: z.string().url().optional(),
  PROVISIONING_API_TOKEN: z.string().min(16).optional(),
  PROVISIONING_API_TIMEOUT_MS: z.coerce.number().int().min(1).max(300_000).default(120_000),
  /**
   * When true, worker re-reads `db_name` via provisioning-agent after all steps and fails if it
   * disagrees with the persisted tenant `erpDbName` (extra guard against drift).
   */
  PROVISIONING_VALIDATE_ERP_DB_ON_COMPLETE: z
    .union([z.literal("true"), z.literal("false")])
    .default("false")
    .transform((v) => v === "true"),
  ERP_CONTAINER_NAME: z.string().min(1).default("axiserp-erpnext-pnzjyk-backend-1"),
  ERP_ADMIN_PASSWORD: z.string().min(8),
}).superRefine((data, ctx) => {
  if (data.NODE_ENV === "production" && !data.PROVISIONING_API_URL) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["PROVISIONING_API_URL"],
      message: "PROVISIONING_API_URL is required in production",
    });
  }

  if (data.PROVISIONING_API_URL && !data.PROVISIONING_API_TOKEN) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["PROVISIONING_API_TOKEN"],
      message: "PROVISIONING_API_TOKEN is required when PROVISIONING_API_URL is set",
    });
  }
});

const parsed = EnvSchema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
  throw new Error(`Invalid environment configuration: ${issues.join(", ")}`);
}

export const env = parsed.data;
