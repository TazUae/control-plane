import { env } from "../../config/env.js";

export type AllowedProvisioningAction =
  | "createSite"
  | "installErp"
  | "enableScheduler"
  | "addDomain"
  | "createApiUser";

export function buildBenchArgs(action: AllowedProvisioningAction, site: string): string[] {
  switch (action) {
    case "createSite":
      return [
        "exec",
        "-w",
        env.ERP_BENCH_PATH,
        env.ERP_CONTAINER_NAME,
        "bench",
        "new-site",
        site,
        "--admin-password",
        env.ERP_ADMIN_PASSWORD,
        "--db-type",
        "mariadb",
      ];
    case "installErp":
      return [
        "exec",
        "-w",
        env.ERP_BENCH_PATH,
        env.ERP_CONTAINER_NAME,
        "bench",
        "--site",
        site,
        "install-app",
        "erpnext",
      ];
    case "enableScheduler":
      return [
        "exec",
        "-w",
        env.ERP_BENCH_PATH,
        env.ERP_CONTAINER_NAME,
        "bench",
        "--site",
        site,
        "enable-scheduler",
      ];
    case "addDomain":
      return [
        "exec",
        "-w",
        env.ERP_BENCH_PATH,
        env.ERP_CONTAINER_NAME,
        "bench",
        "--site",
        site,
        "execute",
        "frappe.api.provisioning.add_domain",
        "--args",
        `["${site}"]`,
      ];
    case "createApiUser":
      return [
        "exec",
        "-w",
        env.ERP_BENCH_PATH,
        env.ERP_CONTAINER_NAME,
        "bench",
        "--site",
        site,
        "execute",
        "frappe.api.provisioning.create_api_user",
        "--args",
        `["${site}"]`,
      ];
  }
}
