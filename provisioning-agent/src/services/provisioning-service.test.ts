import test from "node:test";
import assert from "node:assert/strict";
import { ProvisioningService } from "./provisioning-service.js";

test("passes executor success result through service layer", async () => {
  const service = new ProvisioningService({
    run: async () => ({ action: "createSite", site: "acme", outcome: "already_done", alreadyExists: true }),
  } as any);

  const result = await service.run("createSite", "acme");
  assert.equal(result.outcome, "already_done");
  assert.equal(result.alreadyExists, true);
});
