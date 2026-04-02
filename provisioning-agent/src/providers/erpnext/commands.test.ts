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

test("buildBenchOperationArgs matches docker argv after bench for all actions", async () => {
  process.env.PROVISIONING_API_TOKEN ??= "test-provisioning-token";
  process.env.ERP_ADMIN_PASSWORD ??= "test-admin-password";
  const { buildBenchOperationArgs, buildDockerExecBenchArgv } = await import("./commands.js");

  const cases: Array<{
    action: Parameters<typeof buildBenchOperationArgs>[0];
    input: Parameters<typeof buildBenchOperationArgs>[1];
  }> = [
    { action: "createSite", input: { site: "acme" } },
    { action: "installErp", input: { site: "acme" } },
    { action: "enableScheduler", input: { site: "acme" } },
    { action: "addDomain", input: { site: "acme", domain: "acme.erp.local" } },
    { action: "createApiUser", input: { site: "acme", apiUsername: "cp_acme" } },
  ];

  for (const { action, input } of cases) {
    const op = buildBenchOperationArgs(action, input);
    const full = buildDockerExecBenchArgv(action, input);
    const benchIdx = full.indexOf("bench");
    assert.ok(benchIdx >= 0);
    assert.deepEqual(full.slice(benchIdx + 1), op);
  }
});

test("docker argv remains strict argv-based without shell wrappers", async () => {
  process.env.PROVISIONING_API_TOKEN ??= "test-provisioning-token";
  process.env.ERP_ADMIN_PASSWORD ??= "test-admin-password";
  const { buildDockerExecBenchArgv } = await import("./commands.js");
  const args = buildDockerExecBenchArgv("createSite", { site: "acme" });
  assert.equal(args.includes("bash"), false);
  assert.equal(args.includes("-c"), false);
});
