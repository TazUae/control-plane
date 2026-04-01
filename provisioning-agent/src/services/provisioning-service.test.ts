import test from "node:test";
import assert from "node:assert/strict";
import { ProvisioningService } from "./provisioning-service.js";
import { AgentError } from "../lib/errors.js";

test("maps SITE_ALREADY_EXISTS to idempotent success result", async () => {
  const service = new ProvisioningService({
    run: async () => {
      throw new AgentError("SITE_ALREADY_EXISTS", "Site already exists", {
        retryable: false,
      });
    },
  } as any);

  const result = await service.run("createSite", "acme");
  assert.equal(result.outcome, "already_done");
  assert.equal(result.alreadyExists, true);
});
