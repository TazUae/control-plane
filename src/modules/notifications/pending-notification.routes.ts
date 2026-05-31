import { app } from "../../app.js";
import { prisma } from "../../lib/prisma.js";
import { requireInternalApiKey } from "../../middleware/require-internal-api-key.js";

/**
 * Trainer-facing pending payment-notification workflow API (internal; control-plane
 * API key required). FitDesk reads its tenant's pending list and later marks items
 * sent/dismissed after a real trainer-approved send. No sending happens here.
 *
 * Every route is tenant-scoped: it resolves the tenant by slug and filters by tenantId,
 * so one tenant can never see another tenant's rows.
 */

async function resolveTenantId(slug: string): Promise<string | null> {
  const tenant = await prisma.tenant.findUnique({ where: { slug }, select: { id: true } });
  return tenant?.id ?? null;
}

type Row = {
  invoiceName: string;
  customer: string;
  customerName: string | null;
  grandTotal: { toString(): string } | null;
  currency: string | null;
  sessionDate: string | null;
  status: string;
  createdAt: Date;
  sentAt: Date | null;
};

function serialize(n: Row) {
  return {
    invoiceName: n.invoiceName,
    customer: n.customer,
    customerName: n.customerName,
    grandTotal: n.grandTotal != null ? n.grandTotal.toString() : null,
    currency: n.currency,
    sessionDate: n.sessionDate,
    status: n.status,
    createdAt: n.createdAt.toISOString(),
    sentAt: n.sentAt ? n.sentAt.toISOString() : null,
  };
}

// List a tenant's pending payment notifications (default status=pending).
app.get(
  "/tenants/:slug/pending-payment-notifications",
  { preHandler: [requireInternalApiKey] },
  async (req, reply) => {
    const { slug } = req.params as { slug: string };
    const { status } = req.query as { status?: string };
    const tenantId = await resolveTenantId(slug);
    if (!tenantId) return reply.code(404).send({ error: "tenant not found" });

    const rows = await prisma.pendingPaymentNotification.findMany({
      where: { tenantId, status: status ?? "pending" },
      orderBy: { createdAt: "desc" },
    });
    return reply.send({ notifications: rows.map(serialize) });
  },
);

// Mark a notification sent (idempotent — safe to call when already sent).
app.post(
  "/tenants/:slug/pending-payment-notifications/:invoiceName/sent",
  { preHandler: [requireInternalApiKey] },
  async (req, reply) => {
    const { slug, invoiceName } = req.params as { slug: string; invoiceName: string };
    const tenantId = await resolveTenantId(slug);
    if (!tenantId) return reply.code(404).send({ error: "tenant not found" });

    try {
      const updated = await prisma.pendingPaymentNotification.update({
        where: { tenantId_invoiceName: { tenantId, invoiceName } },
        data: { status: "sent", sentAt: new Date(), lastError: null },
      });
      return reply.send({ ok: true, status: updated.status });
    } catch (err) {
      if ((err as { code?: string }).code === "P2025") {
        return reply.code(404).send({ error: "notification not found" });
      }
      throw err;
    }
  },
);

// Mark a notification dismissed (idempotent).
app.post(
  "/tenants/:slug/pending-payment-notifications/:invoiceName/dismissed",
  { preHandler: [requireInternalApiKey] },
  async (req, reply) => {
    const { slug, invoiceName } = req.params as { slug: string; invoiceName: string };
    const tenantId = await resolveTenantId(slug);
    if (!tenantId) return reply.code(404).send({ error: "tenant not found" });

    try {
      const updated = await prisma.pendingPaymentNotification.update({
        where: { tenantId_invoiceName: { tenantId, invoiceName } },
        data: { status: "dismissed", dismissedAt: new Date() },
      });
      return reply.send({ ok: true, status: updated.status });
    } catch (err) {
      if ((err as { code?: string }).code === "P2025") {
        return reply.code(404).send({ error: "notification not found" });
      }
      throw err;
    }
  },
);
