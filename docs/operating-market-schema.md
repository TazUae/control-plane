# Tenant Operating Market -- Schema and Read-Contract Note

Controlling document: FitDesk `docs/adr/ADR-MKT-001-workspace-operating-market-authority.md`
(Approved, binding). This note only records how that decision landed in this
service's schema; it is not itself a source of the decision.

## What was added

Migration `20260716000000_add_tenant_operating_market` (additive only -- no
`UPDATE`, no `DEFAULT`, no `NOT NULL`; every existing row lands `NULL`):

- `Tenant.operatingMarket` (`String?`) -- ISO 3166-1 alpha-2, e.g. `"LB"`.
- `Tenant.operatingMarketSource` (`String?`) -- only `"operator_verified"` is
  defined today.
- `Tenant.operatingMarketVerifiedAt` (`DateTime?`)
- `Tenant.operatingMarketVerifiedBy` (`String?`) -- an **asserted** operator
  identity, not an authenticated one. See D16 in the Lebanon payment program
  master execution plan (`FitDesk/docs/plans/FITDESK_LEBANON_PAYMENT_PROGRAM_MASTER_EXECUTION_PLAN.md`).
- Two additive indexes on `AuditEvent`: `[tenantId]` and `[type, createdAt]`,
  so it can be queried as a compliance record instead of table-scanned.

`SUPPORTED_MARKETS` (`src/lib/markets.ts`) is `["LB"]` -- a real allowlist,
deliberately narrower than `Tenant.country`'s free 2-letter check.

## What this is not

- Not a backfill. No tenant is retroactively granted a market.
- Not an authorization input on its own -- `Tenant.country` never gates
  payment-method eligibility, and neither does this field until an operator
  explicitly verifies it (see the grant/revoke contract in
  `src/modules/tenants/tenant.routes.ts`).
- Not enforced by a database `CHECK` constraint -- the four-field invariant
  (all NULL, or all non-NULL) is enforced in `operating-market.service.ts`,
  not the schema. See D4 in the master plan.

## Tenant-scoped read contract

```
GET /api/erp/tenant/market
Authorization: Bearer <FitDesk-issued tenant JWT>   # HS256, claim { tenantId }

200 { "operatingMarket": "LB", "verified": true,  "verifiedAt": "2026-07-20T10:00:00.000Z" }
200 { "operatingMarket": null, "verified": false, "verifiedAt": null }
401 { error }  missing / invalid / expired JWT
403 { error }  tenant not active
404 { error }  tenant not found
503 { error }  ERP credentials unprovisioned, or FITDESK_JWT_SECRET unset
```

- Scope is the JWT's `tenantId` claim -- there is no route parameter, so no
  caller-supplied value can select a different tenant's row.
- `verified = operatingMarket !== null && operatingMarketSource === "operator_verified"`.
- Exactly these three fields are returned. Never `country`. Never a
  credential of any kind. See `erp-proxy.market.routes.test.ts` for the
  negative-leak assertion.
- Implemented by widening `resolveTenantFromAuth()`'s return (it already
  loads the full `Tenant` row) rather than adding a second query or a
  parallel credential-free resolver -- see D1 in the master plan.
