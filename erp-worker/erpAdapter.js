const { execa } = require("execa");
const SITE_REGEX = /^[a-z0-9-]+(\.[a-z0-9-]+)*$/;

class ERPAdapter {
  constructor(container = process.env.ERP_CONTAINER_NAME || "axiserp-erpnext-pnzjyk-backend-1") {
    this.container = container;
  }

  async exec(site, method) {
    if (!SITE_REGEX.test(site)) {
      throw new Error("Invalid site format");
    }

    const { stdout } = await execa("docker", [
      "exec",
      "-w",
      "/home/frappe/frappe-bench",
      this.container,
      "bench",
      "--site",
      site,
      "execute",
      method,
      "--args",
      `["${site}"]`,
    ]);

    try {
      return JSON.parse(stdout);
    } catch (e) {
      console.error("RAW OUTPUT:", stdout);
      throw new Error("Failed to parse ERP response");
    }
  }

  async createApiUser(site) {
    return this.exec(site, "frappe.api.provisioning.create_api_user");
  }

  async healthCheck(site) {
    return this.exec(site, "frappe.api.health.health_check");
  }
}

module.exports = ERPAdapter;
