import crypto from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma.js";
import { logger } from "./logger.js";

export async function writeAuditEvent(input: {
  type: string;
  tenantId?: string | null;
  payload: Prisma.InputJsonValue;
}): Promise<void> {
  try {
    await prisma.auditEvent.create({
      data: {
        id: crypto.randomUUID(),
        type: input.type,
        tenantId: input.tenantId ?? undefined,
        payload: input.payload,
      },
    });
  } catch (err) {
    logger.error({ err, auditType: input.type }, "Audit event write failed");
  }
}
