import { FastifyReply, FastifyRequest } from "fastify";
import crypto from "node:crypto";
import { env } from "../config/env.js";

export async function requireBearerToken(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) {
    void reply.code(401).send({
      ok: false,
      error: {
        code: "ERP_VALIDATION_FAILED",
        message: "Missing Bearer token",
        retryable: false,
      },
      timestamp: new Date().toISOString(),
    });
    return;
  }

  const token = auth.slice("Bearer ".length).trim();
  const tokenBuffer = Buffer.from(token);
  const expectedBuffer = Buffer.from(env.PROVISIONING_API_TOKEN);
  const valid =
    tokenBuffer.length === expectedBuffer.length &&
    crypto.timingSafeEqual(tokenBuffer, expectedBuffer);

  if (!token || !valid) {
    void reply.code(403).send({
      ok: false,
      error: {
        code: "ERP_VALIDATION_FAILED",
        message: "Invalid provisioning token",
        retryable: false,
      },
      timestamp: new Date().toISOString(),
    });
    return;
  }
}
