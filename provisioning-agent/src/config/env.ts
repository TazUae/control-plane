import "dotenv/config";
import { z } from "zod";

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(4100),
  PROVISIONING_API_TOKEN: z.string().min(16),
  ERP_CONTAINER_NAME: z.string().min(1).default("axiserp-erpnext-pnzjyk-backend-1"),
  ERP_ADMIN_PASSWORD: z.string().min(8),
  ERP_BENCH_PATH: z.string().min(1).default("/home/frappe/frappe-bench"),
  ERP_BASE_DOMAIN: z.string().min(1).default("erp.zaidan-group.com"),
  ERP_API_USERNAME_PREFIX: z.string().min(1).default("cp"),
  ERP_COMMAND_TIMEOUT_MS: z.coerce.number().int().min(1).max(300_000).default(120_000),
});

const parsed = EnvSchema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
  throw new Error(`Invalid environment configuration: ${issues.join(", ")}`);
}

export const env = parsed.data;
