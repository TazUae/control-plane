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
  PROVISIONING_API_URL: z.string().url(),
  PROVISIONING_API_TOKEN: z.string().min(16),
  /** Base DNS name used to build site FQDNs for provisioning (e.g. `acme.<ERP_BASE_DOMAIN>`). */
  ERP_BASE_DOMAIN: z.string().min(1),
  PROVISIONING_API_TIMEOUT_MS: z.coerce.number().int().min(1).max(1_800_000).default(120_000),
  /**
   * When true, worker re-reads `db_name` via provisioning-agent after all steps and fails if it
   * disagrees with the persisted tenant `erpDbName` (extra guard against drift).
   */
  PROVISIONING_VALIDATE_ERP_DB_ON_COMPLETE: z
    .union([z.literal("true"), z.literal("false")])
    .default("false")
    .transform((v) => v === "true"),
  /**
   * BullMQ worker concurrency per process.
   *
   * KEEP AT 1 for single-bench deployments. bench holds file-system and MariaDB
   * locks during provisioning operations; concurrent jobs against the same bench
   * deadlock or corrupt site state. See scripts/worker.ts for the full constraint
   * explanation and the multi-bench scaling design.
   *
   * When running a second bench on a separate host, start a SECOND worker process
   * (also concurrency 1) rather than raising this value.
   */
  PROVISIONING_WORKER_CONCURRENCY: z.coerce.number().int().min(1).default(1),
  /**
   * Shared HMAC-SHA256 secret for FitDesk ↔ Control Plane ERP proxy JWT verification.
   * Must match FITDESK_JWT_SECRET in the FitDesk deployment.
   * Optional: if omitted the /api/erp/doctype/* proxy routes return 503.
   */
  FITDESK_JWT_SECRET: z.string().min(32).optional(),
  /**
   * Local dev / container-to-container Frappe base URL.
   * When set, the ERP proxy forwards here (HTTP) and sends Host: <erpSite>
   * instead of constructing https://<erpSite>.<ERP_BASE_DOMAIN>.
   * Example (local Docker): http://erp-frontend:8080
   */
  ERP_FRAPPE_BASE_URL: z.string().url().optional(),

  /**
   * Public URL of this control-plane instance (no trailing slash).
   * Used to construct the invoice-submitted webhook URL baked into Server Scripts.
   * Example: https://cp.example.com
   */
  CONTROL_PLANE_PUBLIC_URL: z.string().url().optional(),
  /**
   * Feature flag for the invoice-submitted webhook notification pipeline.
   * While false (default), POST /webhooks/invoice-submitted authenticates + audits but
   * returns 503 (not 200) — so the ERP server script does NOT mark custom_whatsapp_sent=1
   * before a real Whish/WhatsApp notification exists (prevents silently dropping customer
   * payment notifications). Flip to "true" only once the notification pipeline is built.
   */
  INVOICE_WEBHOOK_NOTIFY_ENABLED: z
    .union([z.literal("true"), z.literal("false")])
    .default("false")
    .transform((v) => v === "true"),

  // ── Evolution API (WhatsApp) ──────────────────────────────────────────────
  /** Base URL of the Evolution API instance. Example: http://evolution:8080 */
  EVOLUTION_API_URL: z.string().url().optional(),
  /** API key for Evolution API authentication. */
  EVOLUTION_API_KEY: z.string().min(1).optional(),
  /** Evolution instance name used as the sender. */
  EVOLUTION_INSTANCE: z.string().min(1).optional(),

  // ── Whish Money ───────────────────────────────────────────────────────────
  /** Base URL of the Whish Money API. Example: https://api.wishmoney.com */
  WHISH_MONEY_API_URL: z.string().url().optional(),
  /** API key / secret for authenticating Whish Money requests. */
  WHISH_MONEY_API_KEY: z.string().min(1).optional(),
  /** HMAC secret used to verify inbound payment-confirmed webhooks from Whish Money. */
  WHISH_MONEY_WEBHOOK_SECRET: z.string().min(1).optional(),

  // H1: tenant ERP credential encryption at rest (AES-256-GCM).
  // Optional; if provided it MUST base64-decode to exactly 32 bytes.
  ERP_CREDENTIAL_ENCRYPTION_KEY: z
    .string()
    .refine((v) => {
      try {
        return Buffer.from(v, "base64").length === 32;
      } catch {
        return false;
      }
    }, "ERP_CREDENTIAL_ENCRYPTION_KEY must be base64 of exactly 32 bytes")
    .optional(),
  // Feature flag for credential encryption dual-write (Phase B). Default off.
  ERP_CREDENTIAL_ENCRYPTION_ENABLED: z
    .union([z.literal("true"), z.literal("false")])
    .default("false")
    .transform((v) => v === "true"),
}).superRefine((val, ctx) => {
  // Fail closed: encryption must not be enabled without a valid key present.
  if (val.ERP_CREDENTIAL_ENCRYPTION_ENABLED && !val.ERP_CREDENTIAL_ENCRYPTION_KEY) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["ERP_CREDENTIAL_ENCRYPTION_KEY"],
      message:
        "ERP_CREDENTIAL_ENCRYPTION_KEY is required when ERP_CREDENTIAL_ENCRYPTION_ENABLED=true",
    });
  }
});

// Strip empty strings so optional() fields behave as absent when set to "" via
// ${VAR:-} Docker Compose default syntax.
const rawEnv = Object.fromEntries(
  Object.entries(process.env).map(([k, v]) => [k, v === "" ? undefined : v]),
);

const parsed = EnvSchema.safeParse(rawEnv);

if (!parsed.success) {
  const issues = parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
  throw new Error(`Invalid environment configuration: ${issues.join(", ")}`);
}

export const env = parsed.data;
