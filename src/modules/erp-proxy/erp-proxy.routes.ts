import http from "node:http";
import https from "node:https";
import { jwtVerify } from "jose";
import { app } from "../../app.js";
import { prisma } from "../../lib/prisma.js";
import { env } from "../../config/env.js";
import { logger } from "../../lib/logger.js";

// ---------------------------------------------------------------------------
// ERP DocType Proxy
//
// Validates a short-lived HMAC-HS256 JWT from FitDesk (carrying tenantId),
// resolves the tenant's stored ERP credentials, and forwards the request to
// the tenant's Frappe site at https://{erpSite}.{ERP_BASE_DOMAIN}.
//
// FitDesk never holds ERPNext credentials — it only holds a JWT secret shared
// with this service. The control plane is the only keeper of per-tenant
// api_key / api_secret pairs.
//
// Routes:
//   GET  /api/erp/doctype/:type          — list (Frappe GET /api/resource/:type)
//   POST /api/erp/doctype/:type          — create
//   GET  /api/erp/doctype/:type/:name    — read single doc
//   PUT  /api/erp/doctype/:type/:name    — update
// ---------------------------------------------------------------------------

class ProxyError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string
  ) {
    super(message);
  }
}

type FrappeTenant = {
  erpSite: string;
  erpApiKey: string;
  erpApiSecret: string;
};

/** Superset returned by resolveTenantFromAuth — carries extra fields for reports. */
type ResolvedTenant = FrappeTenant & {
  tenantId: string;
  companyName: string;
  currency: string;
};

async function resolveTenantFromAuth(
  authHeader: string | undefined
): Promise<ResolvedTenant> {
  if (!env.FITDESK_JWT_SECRET) {
    throw new ProxyError(503, "ERP proxy not configured on this instance");
  }
  if (!authHeader?.startsWith("Bearer ")) {
    throw new ProxyError(401, "Authorization header with Bearer token required");
  }
  const token = authHeader.slice(7);

  let tenantId: string;
  try {
    const secret = new TextEncoder().encode(env.FITDESK_JWT_SECRET);
    const { payload } = await jwtVerify(token, secret, {
      algorithms: ["HS256"],
    });
    if (typeof payload.tenantId !== "string" || !payload.tenantId) {
      throw new Error("tenantId claim missing");
    }
    tenantId = payload.tenantId;
  } catch {
    throw new ProxyError(401, "Invalid or expired ERP proxy token");
  }

  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant) throw new ProxyError(404, "Tenant not found");
  if (tenant.status !== "active") throw new ProxyError(403, "Tenant ERP is not active");
  if (!tenant.erpApiKey || !tenant.erpApiSecret || !tenant.erpSite) {
    throw new ProxyError(503, "Tenant ERP credentials not yet provisioned");
  }

  return {
    erpSite: tenant.erpSite,
    erpApiKey: tenant.erpApiKey,
    erpApiSecret: tenant.erpApiSecret,
    tenantId: tenant.id,
    companyName: tenant.companyName ?? "",
    currency: tenant.defaultCurrency ?? "USD",
  };
}

// ---------------------------------------------------------------------------
// Dashboard cache (60-second per-tenant in-memory cache)
// ---------------------------------------------------------------------------

const dashboardCache = new Map<string, { data: object; expires: number }>();
const DASHBOARD_CACHE_TTL_MS = 60_000;

/**
 * Invalidate a tenant's dashboard cache entry.
 * Called by webhook.routes.ts after a Payment Entry is confirmed.
 */
export function invalidateDashboardCache(tenantId: string): void {
  dashboardCache.delete(tenantId);
}

// ---------------------------------------------------------------------------
// Report helpers
// ---------------------------------------------------------------------------

function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function parseAmount(value: unknown): number {
  const n = parseFloat(String(value ?? 0));
  return isFinite(n) ? n : 0;
}

async function forwardToFrappe(
  tenant: FrappeTenant,
  method: string,
  frappePath: string,
  queryParams: Record<string, string>,
  body?: unknown
): Promise<{ status: number; body: unknown }> {
  // ERP_FRAPPE_BASE_URL: local dev / container-to-container mode.
  // Forward to the internal Docker service URL and pass the site name as the
  // Host header so Frappe's nginx can route to the correct site directory.
  // Production (ERP_FRAPPE_BASE_URL not set): construct the public FQDN.
  let base: string;
  const extraHeaders: Record<string, string> = {};
  if (env.ERP_FRAPPE_BASE_URL) {
    base = env.ERP_FRAPPE_BASE_URL.replace(/\/+$/, "");
    extraHeaders["Host"] = tenant.erpSite;
  } else {
    base = `https://${tenant.erpSite}.${env.ERP_BASE_DOMAIN}`;
  }

  const url = new URL(`${base}${frappePath}`);
  for (const [k, v] of Object.entries(queryParams)) {
    url.searchParams.set(k, v);
  }

  const headers: Record<string, string> = {
    Authorization: `token ${tenant.erpApiKey}:${tenant.erpApiSecret}`,
    Accept: "application/json",
    ...extraHeaders,
  };
  const bodyStr = body !== undefined ? JSON.stringify(body) : undefined;
  if (bodyStr !== undefined) {
    headers["Content-Type"] = "application/json";
    headers["Content-Length"] = String(Buffer.byteLength(bodyStr));
  }

  // Use Node.js http/https directly so we can set the Host header.
  // The Fetch API (undici) treats Host as a forbidden header and ignores
  // any custom value, which breaks Frappe's nginx multi-site routing.
  const TIMEOUT_MS = 15_000;
  const MAX_RESPONSE_BYTES = 5_000_000;
  return new Promise((resolve, reject) => {
    const lib = url.protocol === "https:" ? https : http;
    const port = url.port ? Number(url.port) : url.protocol === "https:" ? 443 : 80;
    const req = lib.request(
      {
        hostname: url.hostname,
        port,
        path: `${url.pathname}${url.search}`,
        method,
        headers,
        timeout: TIMEOUT_MS,
      },
      (res) => {
        let buf = "";
        let bytes = 0;
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => {
          bytes += Buffer.byteLength(chunk);
          if (bytes > MAX_RESPONSE_BYTES) {
            req.destroy(new Error("ERP proxy upstream response exceeded size limit"));
            return;
          }
          buf += chunk;
        });
        res.on("end", () => {
          let parsed: unknown;
          try { parsed = JSON.parse(buf); } catch { parsed = null; }
          resolve({ status: res.statusCode ?? 0, body: parsed });
        });
      }
    );
    req.on("timeout", () => {
      req.destroy(new Error(`ERP proxy upstream request timed out after ${TIMEOUT_MS}ms`));
    });
    req.on("error", reject);
    if (bodyStr !== undefined) req.write(bodyStr);
    req.end();
  });
}

// Shared error handling wrapper applied around every proxy handler.
async function withProxyError(
  reply: { code: (n: number) => { send: (b: unknown) => void } },
  fn: () => Promise<void>
): Promise<void> {
  try {
    await fn();
  } catch (error) {
    if (error instanceof ProxyError) {
      reply.code(error.statusCode).send({ error: error.message });
      return;
    }
    logger.error({ err: error }, "ERP proxy upstream request failed");
    reply.code(502).send({ error: "ERP proxy upstream request failed" });
  }
}

// GET /api/erp/doctype/:type — list
app.get<{ Params: { type: string }; Querystring: Record<string, string> }>(
  "/api/erp/doctype/:type",
  async (req, reply) => {
    await withProxyError(reply, async () => {
      const tenant = await resolveTenantFromAuth(req.headers.authorization);
      const { status, body } = await forwardToFrappe(
        tenant,
        "GET",
        `/api/resource/${encodeURIComponent(req.params.type)}`,
        req.query
      );
      reply.code(status).send(body);
    });
  }
);

// POST /api/erp/doctype/:type — create
app.post<{ Params: { type: string }; Body: unknown }>(
  "/api/erp/doctype/:type",
  async (req, reply) => {
    await withProxyError(reply, async () => {
      const tenant = await resolveTenantFromAuth(req.headers.authorization);
      const { status, body } = await forwardToFrappe(
        tenant,
        "POST",
        `/api/resource/${encodeURIComponent(req.params.type)}`,
        {},
        req.body
      );
      reply.code(status).send(body);
    });
  }
);

// GET /api/erp/doctype/:type/:name — read single doc
app.get<{ Params: { type: string; name: string }; Querystring: Record<string, string> }>(
  "/api/erp/doctype/:type/:name",
  async (req, reply) => {
    await withProxyError(reply, async () => {
      const tenant = await resolveTenantFromAuth(req.headers.authorization);
      const { status, body } = await forwardToFrappe(
        tenant,
        "GET",
        `/api/resource/${encodeURIComponent(req.params.type)}/${encodeURIComponent(req.params.name)}`,
        req.query
      );
      reply.code(status).send(body);
    });
  }
);

// PUT /api/erp/doctype/:type/:name — update / submit (docstatus=1)
app.put<{ Params: { type: string; name: string }; Body: unknown }>(
  "/api/erp/doctype/:type/:name",
  async (req, reply) => {
    await withProxyError(reply, async () => {
      const tenant = await resolveTenantFromAuth(req.headers.authorization);
      const { status, body } = await forwardToFrappe(
        tenant,
        "PUT",
        `/api/resource/${encodeURIComponent(req.params.type)}/${encodeURIComponent(req.params.name)}`,
        {},
        req.body
      );
      reply.code(status).send(body);
    });
  }
);

// DELETE /api/erp/doctype/:type/:name — cancel draft document
app.delete<{ Params: { type: string; name: string } }>(
  "/api/erp/doctype/:type/:name",
  async (req, reply) => {
    await withProxyError(reply, async () => {
      const tenant = await resolveTenantFromAuth(req.headers.authorization);
      const { status, body } = await forwardToFrappe(
        tenant,
        "DELETE",
        `/api/resource/${encodeURIComponent(req.params.type)}/${encodeURIComponent(req.params.name)}`,
        {}
      );
      reply.code(status).send(body);
    });
  }
);

// ---------------------------------------------------------------------------
// POST /api/erp/method/* — forward to Frappe /api/method/:method
//
// Enables FitDesk to call @frappe.whitelist() methods on the tenant's site
// using the same JWT-authenticated proxy that backs /api/erp/doctype/*.
// The full method name is captured by the wildcard, e.g.:
//   POST /api/erp/method/provisioning_api.api.scheduling.bulk_create_sessions
// ---------------------------------------------------------------------------

app.post<{ Params: { '*': string }; Body: unknown }>(
  "/api/erp/method/*",
  async (req, reply) => {
    await withProxyError(reply, async () => {
      const method = req.params["*"];
      if (!method) {
        return reply.code(400).send({ error: "Method name required after /api/erp/method/" });
      }
      const tenant = await resolveTenantFromAuth(req.headers.authorization);
      const { status, body } = await forwardToFrappe(
        tenant,
        "POST",
        `/api/method/${method}`,
        {},
        req.body,
      );
      reply.code(status).send(body);
    });
  }
);

// ---------------------------------------------------------------------------
// GET /api/erp/reports/dashboard
//
// Returns revenue this month, outstanding payments, and today's sessions.
// Aggregates three ERPNext queries using node:http via forwardToFrappe.
// Cached per-tenant for 60 seconds; cache is invalidated by payment webhooks.
// ---------------------------------------------------------------------------

app.get(
  "/api/erp/reports/dashboard",
  async (req, reply) => {
    await withProxyError(reply, async () => {
      const tenant = await resolveTenantFromAuth(req.headers.authorization);

      // Serve from cache if fresh
      const cached = dashboardCache.get(tenant.tenantId);
      if (cached && cached.expires > Date.now()) {
        return reply.send(cached.data);
      }

      const now = new Date();
      const today = toISODate(now);
      const firstOfMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
      const company = tenant.companyName;

      // ── Query 1: Revenue this month (GL Entry credits on income accounts) ──
      let revenueThisMonth = 0;
      try {
        const { body: glBody } = await forwardToFrappe(
          tenant,
          "GET",
          "/api/method/frappe.client.get_list",
          {
            doctype: "GL Entry",
            filters: JSON.stringify([
              ["account", "like", "%Income%"],
              ["posting_date", ">=", firstOfMonth],
              ["posting_date", "<=", today],
              ["company", "=", company],
            ]),
            fields: JSON.stringify(["credit"]),
            limit_page_length: "500",
          }
        );
        const rows = ((glBody as { message?: unknown[] })?.message ?? []) as Array<{ credit?: unknown }>;
        revenueThisMonth = rows.reduce((sum, r) => sum + parseAmount(r.credit), 0);
      } catch (err) {
        logger.warn({ tenantId: tenant.tenantId, err: err instanceof Error ? err.message : String(err) }, "dashboard: GL Entry query failed");
      }

      // ── Query 2: Outstanding payments ──────────────────────────────────────
      let outstandingTotal = 0;
      let outstandingCount = 0;
      try {
        const { body: outBody } = await forwardToFrappe(
          tenant,
          "GET",
          "/api/resource/Sales Invoice",
          {
            filters: JSON.stringify([
              ["docstatus", "=", 1],
              ["outstanding_amount", ">", 0],
              ["company", "=", company],
            ]),
            fields: JSON.stringify(["outstanding_amount", "customer", "name"]),
            limit_page_length: "500",
          }
        );
        const rows = ((outBody as { data?: unknown[] })?.data ?? []) as Array<{ outstanding_amount?: unknown }>;
        outstandingTotal = rows.reduce((sum, r) => sum + parseAmount(r.outstanding_amount), 0);
        outstandingCount = rows.length;
      } catch (err) {
        logger.warn({ tenantId: tenant.tenantId, err: err instanceof Error ? err.message : String(err) }, "dashboard: outstanding query failed");
      }

      // ── Query 3: Today's sessions ──────────────────────────────────────────
      type SessionRow = { name?: string; customer_name?: string; grand_total?: unknown };
      let sessionsTodayList: Array<{ invoice: string; client: string; amount: number }> = [];
      try {
        const { body: sessBody } = await forwardToFrappe(
          tenant,
          "GET",
          "/api/resource/Sales Invoice",
          {
            filters: JSON.stringify([
              ["custom_session_date", "=", today],
              ["docstatus", "!=", 2],
              ["company", "=", company],
            ]),
            fields: JSON.stringify(["name", "customer_name", "grand_total"]),
            limit_page_length: "100",
          }
        );
        const rows = ((sessBody as { data?: unknown[] })?.data ?? []) as SessionRow[];
        sessionsTodayList = rows.map(r => ({
          invoice: String(r.name ?? ""),
          client: String(r.customer_name ?? ""),
          amount: parseAmount(r.grand_total),
        }));
      } catch (err) {
        logger.warn({ tenantId: tenant.tenantId, err: err instanceof Error ? err.message : String(err) }, "dashboard: sessions query failed");
      }

      const result = {
        revenue_this_month: Math.round(revenueThisMonth * 100) / 100,
        outstanding_total: Math.round(outstandingTotal * 100) / 100,
        outstanding_count: outstandingCount,
        sessions_today: sessionsTodayList.length,
        sessions_today_list: sessionsTodayList,
        currency: tenant.currency,
        as_of: now.toISOString(),
      };

      // Store in cache for 60 s
      dashboardCache.set(tenant.tenantId, { data: result, expires: Date.now() + DASHBOARD_CACHE_TTL_MS });

      return reply.send(result);
    });
  }
);

// ---------------------------------------------------------------------------
// GET /api/erp/reports/outstanding-invoices
//
// Full list of unpaid submitted invoices with days overdue, sorted most
// overdue first. Always fresh — no caching.
// ---------------------------------------------------------------------------

app.get(
  "/api/erp/reports/outstanding-invoices",
  async (req, reply) => {
    await withProxyError(reply, async () => {
      const tenant = await resolveTenantFromAuth(req.headers.authorization);

      const todayMs = new Date(toISODate(new Date())).getTime();

      const { body } = await forwardToFrappe(
        tenant,
        "GET",
        "/api/resource/Sales Invoice",
        {
          filters: JSON.stringify([
            ["docstatus", "=", 1],
            ["outstanding_amount", ">", 0],
            ["company", "=", tenant.companyName],
          ]),
          fields: JSON.stringify([
            "name",
            "customer_name",
            "outstanding_amount",
            "due_date",
            "custom_payment_link",
          ]),
          limit_page_length: "500",
        }
      );

      type RawInvoice = {
        name?: string;
        customer_name?: string;
        outstanding_amount?: unknown;
        due_date?: string | null;
        custom_payment_link?: string | null;
      };

      const rows = ((body as { data?: unknown[] })?.data ?? []) as RawInvoice[];

      const invoices = rows.map(r => {
        const dueDateMs = r.due_date ? new Date(r.due_date).getTime() : null;
        const daysOverdue = dueDateMs !== null
          ? Math.max(0, Math.floor((todayMs - dueDateMs) / 86_400_000))
          : null;
        return {
          invoice: String(r.name ?? ""),
          customer_name: String(r.customer_name ?? ""),
          outstanding_amount: parseAmount(r.outstanding_amount),
          due_date: r.due_date ?? null,
          days_overdue: daysOverdue,
          payment_link: r.custom_payment_link ?? null,
        };
      });

      // Sort: most overdue first; nulls (no due date) last
      invoices.sort((a, b) => {
        if (a.days_overdue === null && b.days_overdue === null) return 0;
        if (a.days_overdue === null) return 1;
        if (b.days_overdue === null) return -1;
        return b.days_overdue - a.days_overdue;
      });

      return reply.send({
        invoices,
        total: invoices.length,
        currency: tenant.currency,
        as_of: new Date().toISOString(),
      });
    });
  }
);
