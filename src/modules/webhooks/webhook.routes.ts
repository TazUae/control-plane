import crypto from "node:crypto";
import { z } from "zod";
import { app } from "../../app.js";
import { prisma } from "../../lib/prisma.js";
import { logger } from "../../lib/logger.js";
import { writeAuditEvent } from "../../lib/audit.js";
import { hashPayload } from "../../middleware/idempotency.js";

/**
 * C1 — Signed invoice webhook receiver.
 *
 * Canonical contract (provisioning_api `fitdesk_setup.py` Server Script "FitDesk
 * Invoice Submit Webhook"): on Sales Invoice submit, ERP POSTs JSON to
 * `${CONTROL_PLANE_PUBLIC_URL}/webhooks/invoice-submitted` with the per-tenant secret
 * in the `X-Webhook-Secret` header (a shared secret — NOT an HMAC over the body).
 *
 * This handler is a SECURE INTAKE: authenticate (fail closed) → dedupe replays →
 * persist a safe audit event → ack. Downstream actions (Whish payment link, WhatsApp
 * send) are intentionally NOT performed here — those domain services do not exist on
 * `origin/main`; see docs/audit/C1-payment-webhook-receiver.md.
 *
 * Hardening note: upgrading to HMAC-over-raw-body would also require changing the ERP
 * server-script generator (provisioning_api) to sign the body; tracked as future work.
 */

const InvoiceSubmittedSchema = z.object({
  event: z.literal("invoice_submitted"),
  invoice_name: z.string().min(1),
  customer: z.string().optional(),
  customer_name: z.string().optional(),
  grand_total: z.number().optional(),
  custom_session_date: z.string().optional(),
  tenant_slug: z.string().min(1),
});

/** Constant-time secret comparison: hash to a fixed-length digest first so the compare
 * neither short-circuits (timing oracle) nor leaks via a length mismatch. */
function secretsMatch(provided: string, expected: string): boolean {
  const a = crypto.createHash("sha256").update(provided, "utf8").digest();
  const b = crypto.createHash("sha256").update(expected, "utf8").digest();
  return crypto.timingSafeEqual(a, b);
}

app.post("/webhooks/invoice-submitted", async (req, reply) => {
  // 1. Auth header must be present — fail closed.
  const provided = req.headers["x-webhook-secret"];
  if (typeof provided !== "string" || provided.length === 0) {
    return reply.code(401).send({ ok: false, error: "missing webhook secret" });
  }

  // 2. Validate payload shape.
  const parsed = InvoiceSubmittedSchema.safeParse(req.body);
  if (!parsed.success) {
    return reply.code(400).send({ ok: false, error: "invalid payload" });
  }
  const body = parsed.data;

  // 3. Resolve tenant by slug; fail closed (and do not reveal tenant existence).
  const tenant = await prisma.tenant.findUnique({
    where: { slug: body.tenant_slug },
    select: { id: true, webhookSecret: true },
  });
  if (!tenant || !tenant.webhookSecret || !secretsMatch(provided, tenant.webhookSecret)) {
    return reply.code(401).send({ ok: false, error: "unauthorized" });
  }

  // 4. Replay/idempotency dedupe per (tenant, invoice). The unique `key` constraint
  //    makes this durable + cross-instance.
  const dedupeKey = `webhook:invoice-submitted:${body.tenant_slug}:${body.invoice_name}`;
  try {
    await prisma.idempotencyKey.create({
      data: { id: crypto.randomUUID(), key: dedupeKey, payloadHash: hashPayload(body) },
    });
  } catch (err) {
    if ((err as { code?: string }).code === "P2002") {
      logger.info({ tenantId: tenant.id, invoice: body.invoice_name }, "invoice-submitted webhook deduped (replay)");
      return reply.send({ ok: true, deduped: true });
    }
    throw err;
  }

  // 5. Persist a safe audit event (NEVER the secret / no raw header).
  await writeAuditEvent({
    type: "webhook.invoice_submitted",
    tenantId: tenant.id,
    payload: {
      invoice_name: body.invoice_name,
      customer_name: body.customer_name ?? null,
      grand_total: body.grand_total ?? null,
      custom_session_date: body.custom_session_date ?? null,
      tenant_slug: body.tenant_slug,
    },
  });

  logger.info(
    { tenantId: tenant.id, invoice: body.invoice_name, grandTotal: body.grand_total },
    "invoice-submitted webhook accepted",
  );

  return reply.send({ ok: true });
});
