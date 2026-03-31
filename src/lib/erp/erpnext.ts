import { env } from "../../config/env.js";
import { logger } from "../logger.js";
import { safeExec } from "../safe-exec.js";
import { assertValidSlugOrSite } from "../validation.js";

export async function createSite(siteName: string) {
  assertValidSlugOrSite(siteName, "siteName");
  logger.info({ siteName }, "Creating ERP site");

  try {
    const result = await safeExec(
      "docker",
      [
        "exec",
        "-w",
        "/home/frappe/frappe-bench",
        env.ERP_CONTAINER_NAME,
        "bench",
        "new-site",
        siteName,
        "--admin-password",
        env.ERP_ADMIN_PASSWORD,
        "--db-type",
        "mariadb",
      ],
      { timeoutMs: 120_000 }
    );

    if (result.stderr && !result.stderr.includes("already exists")) {
      logger.warn({ siteName, stderr: result.stderr }, "ERP site creation stderr output");
    }

    if (result.exitCode !== 0) {
      throw new Error(`ERP site creation failed with code ${result.exitCode}`);
    }

    return result.stdout;
  } catch (err) {
    const output = err instanceof Error ? err.message : String(err);

    if (output.includes("already exists")) {
      logger.info({ siteName }, "ERP site already exists, skipping");
      return "exists";
    }

    throw err;
  }
}
