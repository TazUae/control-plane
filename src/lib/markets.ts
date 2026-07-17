/**
 * Supported operating markets for market-gated payment methods.
 *
 * ADR-MKT-001: `operatingMarket` is a separate, operator-verified field --
 * never derived from `Tenant.country`, timezone, locale, phone, or currency.
 * Starts with LB only: the sole market with a defined payment catalog today.
 * An allowlist that names a market with no catalog behind it is a lie.
 */
export const SUPPORTED_MARKETS = ["LB"] as const;

export type SupportedMarket = (typeof SUPPORTED_MARKETS)[number];

export function isSupportedMarket(value: unknown): value is SupportedMarket {
  return (
    typeof value === "string" &&
    (SUPPORTED_MARKETS as readonly string[]).includes(value)
  );
}
