/**
 * Server-side country defaults lookup.
 *
 * Returns locale-relevant defaults for a given ISO 3166-1 alpha-2 country
 * code. These values are used during POST /tenants to auto-fill optional
 * fields when the caller provides a `country` but omits individual locale
 * fields. Stored derived values are then passed through the provisioning
 * pipeline (fiscal year, global defaults, etc.).
 *
 * Values are intentionally conservative — all are overridable by the caller.
 */

export type CountryDefaults = {
  /** Fiscal year start month (1 = January). */
  fiscalYearStartMonth: number;
  /** ISO 4217 default currency code. */
  currency: string;
  /** IANA timezone string (most representative for the country). */
  timezone: string;
  /** Whether ERPNext has a regional localization module. */
  hasRegionalSetup: boolean;
  /** ERPNext regional setup module name, if applicable. */
  regionalSetupModule?: string;
};

const COUNTRY_DEFAULTS: Record<string, CountryDefaults> = {
  AE: { fiscalYearStartMonth: 1,  currency: "AED", timezone: "Asia/Dubai",       hasRegionalSetup: true,  regionalSetupModule: "erpnext.regional.united_arab_emirates.setup" },
  SA: { fiscalYearStartMonth: 1,  currency: "SAR", timezone: "Asia/Riyadh",      hasRegionalSetup: false },
  US: { fiscalYearStartMonth: 1,  currency: "USD", timezone: "America/New_York", hasRegionalSetup: true,  regionalSetupModule: "erpnext.regional.united_states.setup" },
  GB: { fiscalYearStartMonth: 4,  currency: "GBP", timezone: "Europe/London",    hasRegionalSetup: false },
  IN: { fiscalYearStartMonth: 4,  currency: "INR", timezone: "Asia/Kolkata",     hasRegionalSetup: true,  regionalSetupModule: "erpnext.regional.india" },
  DE: { fiscalYearStartMonth: 1,  currency: "EUR", timezone: "Europe/Berlin",    hasRegionalSetup: false },
  FR: { fiscalYearStartMonth: 1,  currency: "EUR", timezone: "Europe/Paris",     hasRegionalSetup: false },
  AU: { fiscalYearStartMonth: 7,  currency: "AUD", timezone: "Australia/Sydney", hasRegionalSetup: true,  regionalSetupModule: "erpnext.regional.australia.setup" },
  CA: { fiscalYearStartMonth: 1,  currency: "CAD", timezone: "America/Toronto",  hasRegionalSetup: false },
  PK: { fiscalYearStartMonth: 7,  currency: "PKR", timezone: "Asia/Karachi",     hasRegionalSetup: false },
  OM: { fiscalYearStartMonth: 1,  currency: "OMR", timezone: "Asia/Muscat",      hasRegionalSetup: false },
  QA: { fiscalYearStartMonth: 1,  currency: "QAR", timezone: "Asia/Qatar",       hasRegionalSetup: false },
  KW: { fiscalYearStartMonth: 1,  currency: "KWD", timezone: "Asia/Kuwait",      hasRegionalSetup: false },
  BH: { fiscalYearStartMonth: 1,  currency: "BHD", timezone: "Asia/Bahrain",     hasRegionalSetup: false },
  EG: { fiscalYearStartMonth: 7,  currency: "EGP", timezone: "Africa/Cairo",     hasRegionalSetup: false },
  SG: { fiscalYearStartMonth: 1,  currency: "SGD", timezone: "Asia/Singapore",   hasRegionalSetup: false },
  MY: { fiscalYearStartMonth: 1,  currency: "MYR", timezone: "Asia/Kuala_Lumpur", hasRegionalSetup: false },
  LB: { fiscalYearStartMonth: 1,  currency: "USD", timezone: "Asia/Beirut",       hasRegionalSetup: false },
  JO: { fiscalYearStartMonth: 1,  currency: "JOD", timezone: "Asia/Amman",        hasRegionalSetup: false },
  IQ: { fiscalYearStartMonth: 1,  currency: "IQD", timezone: "Asia/Baghdad",      hasRegionalSetup: false },
  TR: { fiscalYearStartMonth: 1,  currency: "TRY", timezone: "Europe/Istanbul",   hasRegionalSetup: false },
  NG: { fiscalYearStartMonth: 1,  currency: "NGN", timezone: "Africa/Lagos",      hasRegionalSetup: false },
  ZA: { fiscalYearStartMonth: 3,  currency: "ZAR", timezone: "Africa/Johannesburg", hasRegionalSetup: false },
  BR: { fiscalYearStartMonth: 1,  currency: "BRL", timezone: "America/Sao_Paulo", hasRegionalSetup: false },
  MX: { fiscalYearStartMonth: 1,  currency: "MXN", timezone: "America/Mexico_City", hasRegionalSetup: false },
  NL: { fiscalYearStartMonth: 1,  currency: "EUR", timezone: "Europe/Amsterdam",  hasRegionalSetup: false },
  ES: { fiscalYearStartMonth: 1,  currency: "EUR", timezone: "Europe/Madrid",     hasRegionalSetup: false },
  IT: { fiscalYearStartMonth: 1,  currency: "EUR", timezone: "Europe/Rome",       hasRegionalSetup: false },
  CH: { fiscalYearStartMonth: 1,  currency: "CHF", timezone: "Europe/Zurich",     hasRegionalSetup: false },
  SE: { fiscalYearStartMonth: 1,  currency: "SEK", timezone: "Europe/Stockholm",  hasRegionalSetup: false },
  NO: { fiscalYearStartMonth: 1,  currency: "NOK", timezone: "Europe/Oslo",       hasRegionalSetup: false },
  NZ: { fiscalYearStartMonth: 4,  currency: "NZD", timezone: "Pacific/Auckland",  hasRegionalSetup: false },
};

const FALLBACK: CountryDefaults = {
  fiscalYearStartMonth: 1,
  currency: "USD",
  timezone: "UTC",
  hasRegionalSetup: false,
};

/**
 * Look up locale defaults for the given ISO 3166-1 alpha-2 country code.
 * Returns a fallback (January FY, USD, UTC) for unknown codes so callers
 * never receive undefined.
 */
export function getCountryDefaults(countryCode: string): CountryDefaults {
  return COUNTRY_DEFAULTS[countryCode.toUpperCase()] ?? FALLBACK;
}

/**
 * Derive the ERPNext Fiscal Year name for a given start month.
 * Must produce the same name as provisioning_api/api/bootstrap.setup_fiscal_year.
 *   - January start → "2026"
 *   - Other months  → "2026-2027" (start_year-end_year based on today)
 */
export function deriveFiscalYearName(fiscalYearStartMonth: number, referenceDate = new Date()): string {
  const year = referenceDate.getFullYear();
  const month = referenceDate.getMonth() + 1; // 1-indexed

  if (fiscalYearStartMonth === 1) {
    return String(year);
  }

  if (month >= fiscalYearStartMonth) {
    // FY started this calendar year, ends next year
    return `${year}-${year + 1}`;
  } else {
    // FY started last calendar year, ends this year
    return `${year - 1}-${year}`;
  }
}
