# Operating Market Verification -- Operator Runbook

Controlling document: FitDesk `docs/adr/ADR-MKT-001-workspace-operating-market-authority.md`
(Approved, binding). This runbook operationalizes that decision; it does not
define it. If this document and the ADR disagree, the ADR wins.

## What this grants -- and what it does not

Granting a workspace's `operatingMarket` makes market-gated payment methods
**eligible** to appear for that workspace. It is **necessary, not sufficient**:
the ERP preflight (does a company-mapped Mode of Payment actually exist on the
tenant's site?) still gates whether a method is actually offered. Granting a
market never moves money, never creates a Payment Entry, and never touches
ERPNext by itself.

## Required evidence before granting a market

A **direct, recorded confirmation from the trainer** that the business
operates in that market. Record where this confirmation came from (e.g. a
support ticket reference, a dated message) -- but do not paste personal data
into the audit payload itself; reference the evidence, don't inline it.

## Explicitly NOT evidence

Do not infer or accept any of the following as a substitute for the direct
confirmation above:

- Timezone
- Phone number prefix / country code
- Browser or account locale
- IP address / geolocation
- Billing currency
- Company name or site name
- `Tenant.country` (a locale / Chart-of-Accounts provisioning seed -- it
  authorizes nothing; see ADR-MKT-001)
- ERPNext `Company.country`

This list is deliberately long. It is the ADR's central point: none of these
signals establish where a business actually operates, and treating any of
them as sufficient is exactly the failure this field exists to prevent.

## Who may verify

Only an operator holding `CONTROL_PLANE_API_KEY`. This key authenticates a
**shared service credential, not a person** -- the API has no per-operator
identity. `verifiedBy` in the request body is an **asserted, unauthenticated
claim**: anyone holding the key can write any name into it. The audit trail
proves *a credential acted*, not *who acted*. Treat it as a claim recorded
alongside the request, never as proof (see D16 in the Lebanon payment program
master execution plan). Restrict access to `CONTROL_PLANE_API_KEY` accordingly
until per-operator credentials exist (a separate, not-yet-scheduled hardening
slice).

## Where evidence is retained

Outside this system, in whatever ticketing/support tool captured the
trainer's confirmation. The audit payload references the request only
(`requestId`, `assertedHumanOperator`, before/after market state) -- it is not
a document store, and it must never contain personal data.

## Granting

```
POST /tenants/:id/operating-market
Authorization: Bearer <CONTROL_PLANE_API_KEY>
Content-Type: application/json

{ "market": "LB", "verifiedBy": "<your operator identifier>" }
```

- `market` must be one of `SUPPORTED_MARKETS` (`src/lib/markets.ts`) -- today
  only `"LB"`. Anything else returns `422`.
- `verifiedBy` must be non-empty. Empty/missing returns `400`.
- Re-granting the same market is a safe no-op (`changed: false`): the stored
  `operatingMarketVerifiedBy`/`operatingMarketVerifiedAt` are **not**
  overwritten, but a fresh audit row still records that a re-affirmation
  happened.
- Success returns the full state: `tenantId`, `operatingMarket`,
  `operatingMarketSource`, `operatingMarketVerifiedAt`,
  `operatingMarketVerifiedBy`, `changed`.

## Revoking

```
DELETE /tenants/:id/operating-market
Authorization: Bearer <CONTROL_PLANE_API_KEY>
Content-Type: application/json

{ "verifiedBy": "<your operator identifier>" }
```

- Instant. No deploy, no ERP change. This is the primary rollback lever for
  the whole program.
- Revoking an already-unverified tenant is a safe no-op (`changed: false`).
- Historical payment records for that tenant are untouched -- payment
  identity is global and market-independent; only future eligibility changes.
- Any tenant-side cache (e.g. FitDesk's market resolver) may take up to its
  TTL to reflect a revoke. Confirm the effect by re-reading
  `GET /api/erp/tenant/market` with a valid tenant JWT after that window.

## How to trigger a revocation

Any operator holding `CONTROL_PLANE_API_KEY` may revoke immediately if:

- the trainer disputes the recorded market;
- the original evidence is found to be insufficient or mistaken;
- the workspace is suspected of being incorrectly verified for any reason.

There is no approval gate on revoking -- removing eligibility is always the
safe direction.

## Verifying the result

Read back through the **tenant-scoped** contract, never the admin one, to
confirm what the workspace itself will see:

```
GET /api/erp/tenant/market
Authorization: Bearer <tenant JWT>
```

Expect `{ "operatingMarket": "LB", "verified": true, "verifiedAt": "<iso>" }`
after a grant, and `{ "operatingMarket": null, "verified": false, "verifiedAt": null }`
after a revoke or for any workspace never granted.
