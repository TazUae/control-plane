import test from "node:test";
import assert from "node:assert/strict";
import { steps } from "./steps.js";

test("app_installed_fitdesk exists in the expected sequence order", () => {
  const fitdeskConfiguredIndex = steps.indexOf("fitdesk_configured");
  const appInstalledFitdeskIndex = steps.indexOf("app_installed_fitdesk");
  const apiKeysGeneratedIndex = steps.indexOf("api_keys_generated");

  assert.notEqual(appInstalledFitdeskIndex, -1, "app_installed_fitdesk must exist in steps");
  assert.equal(appInstalledFitdeskIndex, fitdeskConfiguredIndex + 1);
  assert.equal(apiKeysGeneratedIndex, appInstalledFitdeskIndex + 1);
});
