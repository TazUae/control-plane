/**
 * Allowlisted argv for Frappe bench operations.
 * - `buildBenchOperationArgs`: argv after `bench` (shared by Docker and host backends).
 * - `buildDockerExecBenchArgv`: full `docker exec … bench …` argv for `DockerExecBackend` only.
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

/** `docker exec -w <bench> <container> bench` — not used by host bench backend. */
function buildDockerExecBenchPrefix(): string[] {
  return ["exec", "-w", env.ERP_BENCH_PATH, env.ERP_CONTAINER_NAME, "bench"];
}

/**
 * Arguments passed to `bench` for each allowlisted action (no docker, no shell).
 * Used by `HostBenchExecBackend` and composed into full docker argv for `DockerExecBackend`.
 */
export function buildBenchOperationArgs(action: AllowedProvisioningAction, input: BuildActionInput): string[] {
  const site = validateSite(input.site);

  switch (action) {
    case "createSite":
      return [
        "new-site",
        site,
        "--admin-password",
        env.ERP_ADMIN_PASSWORD,
        "--db-type",
        "mariadb",
      ];
    case "installErp":
      return [
        "--site",
        site,
        "install-app",
        "erpnext",
      ];
    case "enableScheduler":
      return [
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
        "--site",
        site,
        "execute",
        "frappe.api.provisioning.create_api_user",
        "--args",
        `["${site}","${apiUsername}"]`,
      ];
  }
}

/** Full argv for `spawn("docker", argv, …)` — Docker backend only. */
export function buildDockerExecBenchArgv(action: AllowedProvisioningAction, input: BuildActionInput): string[] {
  return [...buildDockerExecBenchPrefix(), ...buildBenchOperationArgs(action, input)];
}

/** Alias for `buildDockerExecBenchArgv` (tests and Docker backend). */
export function buildBenchArgs(action: AllowedProvisioningAction, input: BuildActionInput): string[] {
  return buildDockerExecBenchArgv(action, input);
}
