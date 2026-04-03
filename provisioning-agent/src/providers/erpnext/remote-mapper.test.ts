import test from "node:test";
import assert from "node:assert/strict";
import { AgentError } from "../../lib/errors.js";
import { mapRemoteHttpResult, mapRemoteTransportFailure } from "./remote-mapper.js";

test("mapRemoteHttpResult maps remote failure envelope to AgentError", () => {
  assert.throws(
    () =>
      mapRemoteHttpResult(400, {
        ok: false,
        error: {
          code: "ERP_COMMAND_FAILED",
          message: "bench failed",
          retryable: false,
          details: "trace id=abc",
        },
      }),
    (error: unknown) => {
      assert.ok(error instanceof AgentError);
      assert.equal(error.code, "ERP_COMMAND_FAILED");
      assert.equal(error.statusCode, 400);
      assert.equal(error.details, "trace id=abc");
      return true;
    }
  );
});

test("mapRemoteTransportFailure maps unavailable transport to INFRA_UNAVAILABLE", () => {
  const error = mapRemoteTransportFailure(new TypeError("fetch failed"));
  assert.equal(error.code, "INFRA_UNAVAILABLE");
  assert.equal(error.statusCode, 503);
  assert.equal(error.retryable, true);
});
