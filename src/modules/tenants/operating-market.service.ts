import { prisma } from "../../lib/prisma.js";
import type { SupportedMarket } from "../../lib/markets.js";

export class TenantNotFoundError extends Error {
  constructor() {
    super("Tenant not found");
  }
}

type MarketFields = {
  operatingMarket: string | null;
  operatingMarketSource: string | null;
  operatingMarketVerifiedAt: Date | null;
  operatingMarketVerifiedBy: string | null;
};

const MARKET_SELECT = {
  operatingMarket: true,
  operatingMarketSource: true,
  operatingMarketVerifiedAt: true,
  operatingMarketVerifiedBy: true,
} as const;

export type OperatingMarketState = MarketFields & {
  tenantId: string;
  changed: boolean;
};

function serializeMarketFields(f: MarketFields) {
  return {
    operatingMarket: f.operatingMarket,
    operatingMarketSource: f.operatingMarketSource,
    operatingMarketVerifiedAt: f.operatingMarketVerifiedAt
      ? f.operatingMarketVerifiedAt.toISOString()
      : null,
    operatingMarketVerifiedBy: f.operatingMarketVerifiedBy,
  };
}

/**
 * D2: the audit write lives INSIDE this transaction, using `tx.auditEvent.create`
 * directly — never the fail-open `writeAuditEvent` helper. If the audit write
 * throws, the whole transaction (including the tenant update) rolls back, so
 * a grant/revoke can never commit without its audit row.
 *
 * D3: no optimistic-locking column. Operator writes are rare and
 * human-serialized, and every write is fully audited with before/after, so
 * last-write-wins is itself auditable.
 *
 * D4: the "all four NULL, or all four non-NULL" invariant is enforced here
 * (every write sets or clears all four fields together), not by a DB CHECK
 * constraint.
 *
 * Idempotency: `changed` compares ONLY `operatingMarket`. Re-asserting the
 * same market leaves the row untouched (verifiedAt/verifiedBy are NOT
 * overwritten by a second operator) but still writes an audit row recording
 * the re-affirmation — the operator's repeated confirmation is itself a fact
 * worth keeping, even though it changes nothing durable.
 */
async function applyOperatingMarketChange(
  tenantId: string,
  auditType: string,
  nextFields: MarketFields,
  assertedHumanOperator: string,
  requestId: string
): Promise<OperatingMarketState> {
  return prisma.$transaction(async (tx: any) => {
    const before: MarketFields | null = await tx.tenant.findUnique({
      where: { id: tenantId },
      select: MARKET_SELECT,
    });
    if (!before) throw new TenantNotFoundError();

    const changed = before.operatingMarket !== nextFields.operatingMarket;
    const after: MarketFields = changed
      ? await tx.tenant.update({
          where: { id: tenantId },
          data: nextFields,
          select: MARKET_SELECT,
        })
      : before;

    // D16: `authenticatedServiceIdentity` is WHAT was authenticated (the shared
    // admin key, i.e. a service credential). `assertedHumanOperator` is a
    // CLAIMED human identity — anyone holding that key can write any name here.
    // Never present the latter as proof of who acted.
    await tx.auditEvent.create({
      data: {
        type: auditType,
        tenantId,
        payload: {
          requestId,
          authenticatedServiceIdentity: "control-plane-admin-key",
          assertedHumanOperator,
          changed,
          before: serializeMarketFields(before),
          after: serializeMarketFields(after),
        },
      },
    });

    return { tenantId, ...after, changed };
  });
}

export async function grantOperatingMarket(
  tenantId: string,
  market: SupportedMarket,
  assertedHumanOperator: string,
  requestId: string
): Promise<OperatingMarketState> {
  return applyOperatingMarketChange(
    tenantId,
    "tenant.operating_market.verified",
    {
      operatingMarket: market,
      operatingMarketSource: "operator_verified",
      operatingMarketVerifiedAt: new Date(),
      operatingMarketVerifiedBy: assertedHumanOperator,
    },
    assertedHumanOperator,
    requestId
  );
}

export async function revokeOperatingMarket(
  tenantId: string,
  assertedHumanOperator: string,
  requestId: string
): Promise<OperatingMarketState> {
  return applyOperatingMarketChange(
    tenantId,
    "tenant.operating_market.revoked",
    {
      operatingMarket: null,
      operatingMarketSource: null,
      operatingMarketVerifiedAt: null,
      operatingMarketVerifiedBy: null,
    },
    assertedHumanOperator,
    requestId
  );
}
