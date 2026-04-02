import test from "node:test";
import assert from "node:assert/strict";
import { AgentError, sendFailure } from "./errors.js";

test("sendFailure does not leak stdout/stderr/exitCode", () => {
  const reply = {
    statusCode: 200,
    body: undefined as unknown,
    code(value: number) {
      this.statusCode = value;
      return this;
    },
    send(payload: unknown) {
      this.body = payload;
    },
  };

  const err = new AgentError("ERP_COMMAND_FAILED", "failed", {
    stdout: "sensitive",
    stderr: "secret",
    exitCode: 12,
    statusCode: 400,
  });
  sendFailure(reply, err);

  assert.equal(reply.statusCode, 400);
  const envelope = reply.body as { error: Record<string, unknown> };
  assert.equal(envelope.error.stdout, undefined);
  assert.equal(envelope.error.stderr, undefined);
  assert.equal(envelope.error.exitCode, undefined);
});
