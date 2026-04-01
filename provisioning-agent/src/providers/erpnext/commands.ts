/**
 * Docker-only argv construction for `DockerExecBackend` (`docker exec … bench …`).
 * Not exposed to HTTP; callers use the typed `ErpExecutionBackend` interface instead.
 */
import { env } from "../../config/env.js";
import { validateDomain, validateSite, validateUsername } from "./validation.js";

export type AllowedProvisioningAction =
  | "createSite"
  | "installErp"
  | "enableScheduler"
  | "addDomain"
  | "createApiUser";

type BuildActionInput = {
  site: string;
  domain?: string;
  apiUsername?: string;
};

function buildDockerExecPrefix(): string[] {
  return ["exec", "-w", env.ERP_BENCH_PATH, env.ERP_CONTAINER_NAME, "bench"];
}

export function buildBenchArgs(action: AllowedProvisioningAction, input: BuildActionInput): string[] {
  const site = validateSite(input.site);

  switch (action) {
    case "createSite":
      return [
        ...buildDockerExecPrefix(),
        "new-site",
        site,
        "--admin-password",
        env.ERP_ADMIN_PASSWORD,
        "--db-type",
        "mariadb",
      ];
    case "installErp":
      return [
        ...buildDockerExecPrefix(),
        "--site",
        site,
        "install-app",
        "erpnext",
      ];
    case "enableScheduler":
      return [
        ...buildDockerExecPrefix(),
        "--site",
        site,
        "enable-scheduler",
      ];
    case "addDomain":
      if (!input.domain) {
        throw new Error("domain is required for addDomain");
      }
      const domain = validateDomain(input.domain);
      return [
        ...buildDockerExecPrefix(),
        "--site",
        site,
        "execute",
        "frappe.api.provisioning.add_domain",
        "--args",
        `["${site}","${domain}"]`,
      ];
    case "createApiUser":
      if (!input.apiUsername) {
        throw new Error("apiUsername is required for createApiUser");
      }
      const apiUsername = validateUsername(input.apiUsername);
      return [
        ...buildDockerExecPrefix(),
        "--site",
        site,
        "execute",
        "frappe.api.provisioning.create_api_user",
        "--args",
        `["${site}","${apiUsername}"]`,
      ];
  }
}
