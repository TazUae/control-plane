import test from "node:test";
import assert from "node:assert/strict";

async function loadBuildBenchArgs() {
  process.env.PROVISIONING_API_TOKEN ??= "test-provisioning-token";
  process.env.ERP_ADMIN_PASSWORD ??= "test-admin-password";
  const module = await import("./commands.js");
  return module.buildBenchArgs;
}

test("buildBenchArgs for createSite includes expected bench argv", async () => {
  const buildBenchArgs = await loadBuildBenchArgs();
  const args = buildBenchArgs("createSite", { site: "acme" });
  assert.ok(args.includes("new-site"));
  assert.ok(args.includes("acme"));
});

test("buildBenchArgs for addDomain requires validated domain", async () => {
  const buildBenchArgs = await loadBuildBenchArgs();
  const args = buildBenchArgs("addDomain", {
    site: "acme",
    domain: "acme.erp.local",
  });
  const joined = args.join(" ");
  assert.match(joined, /frappe\.api\.provisioning\.add_domain/);
  assert.match(joined, /\["acme","acme\.erp\.local"\]/);
});

test("buildBenchArgs for createApiUser requires username", async () => {
  const buildBenchArgs = await loadBuildBenchArgs();
  const args = buildBenchArgs("createApiUser", {
    site: "acme",
    apiUsername: "cp_acme",
  });
  const joined = args.join(" ");
  assert.match(joined, /frappe\.api\.provisioning\.create_api_user/);
  assert.match(joined, /\["acme","cp_acme"\]/);
});
