import { prisma } from "../lib/prisma.js";
import crypto from "node:crypto";

export type IdempotencyContext = {
  key: string;
  payloadHash: string;
};

export function stableStringify(input: unknown): string {
  if (input === null || typeof input !== "object") {
    return JSON.stringify(input);
  }

  if (Array.isArray(input)) {
    return `[${input.map((item) => stableStringify(item)).join(",")}]`;
  }

  const entries = Object.entries(input as Record<string, unknown>)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${JSON.stringify(key)}:${stableStringify(value)}`);
  return `{${entries.join(",")}}`;
}

export function hashPayload(payload: unknown): string {
  return crypto.createHash("sha256").update(stableStringify(payload)).digest("hex");
}

export async function idempotencyMiddleware(
  req: any,
  reply: any
) {
  const key = req.headers["idempotency-key"] as string;

  if (!key) {
    return;
  }

  const payloadHash = hashPayload(req.body ?? {});

  const existing = await prisma.idempotencyKey.findUnique({
    where: { key },
  });

  if (existing) {
    const existingPayloadHash = (existing as { payloadHash?: string }).payloadHash;
    if (existingPayloadHash && existingPayloadHash !== payloadHash) {
      return reply.code(409).send({
        error: "Idempotency key already used with a different payload",
      });
    }
    const existingResponse = (existing as { response?: unknown }).response;
    if (existingResponse !== undefined && existingResponse !== null) {
      return reply.send(existingResponse);
    }
    return reply.code(409).send({ error: "Request with this idempotency key is in progress" });
  }

  (req as { idempotency?: IdempotencyContext }).idempotency = {
    key,
    payloadHash,
  };
}
