import { z } from "zod";
import {
  normalizeSlug,
  SLUG_SITE_MAX_LENGTH,
  SLUG_SITE_MIN_LENGTH,
  SLUG_SITE_REGEX,
} from "../../lib/validation.js";

export const GetTenantParamsSchema = z.object({
  id: z.string().uuid(),
});

export type GetTenantParams = z.infer<typeof GetTenantParamsSchema>;

export const CreateTenantSchema = z.object({
  slug: z
    .string()
    .trim()
    .transform((value) => normalizeSlug(value))
    .refine((value) => value.length >= SLUG_SITE_MIN_LENGTH && value.length <= SLUG_SITE_MAX_LENGTH, {
      message: `slug length must be ${SLUG_SITE_MIN_LENGTH}-${SLUG_SITE_MAX_LENGTH}`,
    })
    .refine((value) => SLUG_SITE_REGEX.test(value), {
      message: "slug must match ^[a-z0-9-]+$",
    }),
  plan: z.string().trim().min(1).max(64).default("pro"),
  region: z.string().trim().min(1).max(32).default("eu"),
  /** ISO 3166-1 alpha-2 country code (e.g. "AE", "US"). Required — drives all locale defaults. */
  country: z
    .string()
    .trim()
    .length(2, "country must be a 2-letter ISO 3166-1 alpha-2 code")
    .transform((v) => v.toUpperCase()),
  /** ISO 4217 currency code override (e.g. "AED", "USD"). Derived from country if omitted. */
  defaultCurrency: z
    .string()
    .trim()
    .length(3, "defaultCurrency must be a 3-letter ISO 4217 currency code")
    .transform((v) => v.toUpperCase())
    .optional(),
  /** IANA timezone string override (e.g. "Asia/Dubai"). Derived from country if omitted. */
  timezone: z.string().trim().min(1).max(64).optional(),
  language: z.string().trim().min(2).max(10).default("en"),
  dateFormat: z.string().trim().min(1).max(20).default("dd-mm-yyyy"),
  currencyPrecision: z.number().int().min(0).max(9).default(2),
  /** Legal company name (e.g. "Test Fitness LLC"). Required. */
  companyName: z.string().trim().min(1).max(140),
  /** Short abbreviation used as account suffix in Frappe CoA (e.g. "TF"). Required. */
  companyAbbr: z.string().trim().min(1).max(10),
  /** Fiscal year start month 1–12 (default 1 = January). Auto-derived from country if omitted. */
  fiscalYearStartMonth: z.number().int().min(1).max(12).optional(),
});

export type CreateTenantInput = z.infer<typeof CreateTenantSchema>;

// ---------------------------------------------------------------------------
// Operating market grant / revoke (ADR-MKT-001, Phase 4)
//
// `market` is validated as a well-formed string here (missing/wrong-type -> 400
// via this schema); membership in SUPPORTED_MARKETS is checked separately by
// the route so an unsupported-but-well-formed value (e.g. "XX", "lb", "USA",
// or "") reports 422, not 400. `verifiedBy` is a required, non-empty ASSERTED
// operator identity — not authenticated (D16) — so empty/missing is a 400.
// ---------------------------------------------------------------------------

export const OperatingMarketGrantSchema = z.object({
  market: z.string(),
  verifiedBy: z.string().trim().min(1),
});

export type OperatingMarketGrantInput = z.infer<typeof OperatingMarketGrantSchema>;

export const OperatingMarketRevokeSchema = z.object({
  verifiedBy: z.string().trim().min(1),
});

export type OperatingMarketRevokeInput = z.infer<typeof OperatingMarketRevokeSchema>;
