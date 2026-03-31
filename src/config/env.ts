import "dotenv/config";
import { z } from "zod";

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().url(),
  CONTROL_PLANE_API_KEY: z.string().min(16),
  ERP_CONTAINER_NAME: z.string().min(1).default("axiserp-erpnext-pnzjyk-backend-1"),
  ERP_ADMIN_PASSWORD: z.string().min(8).default("admin"),
});

const parsed = EnvSchema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
  throw new Error(`Invalid environment configuration: ${issues.join(", ")}`);
}

export const env = parsed.data;
