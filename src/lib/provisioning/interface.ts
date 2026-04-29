export type LocalePayload = {
  country: string;
  defaultCurrency: string;
  timezone: string;
  language: string;
  dateFormat: string;
  currencyPrecision: number;
};

export type SetupCompletePayload = {
  companyName: string;
};

export type RegionalSetupPayload = {
  country: string;
  companyName: string;
  companyAbbr?: string;
};

export type DomainsPayload = {
  companyName: string;
};

export type FiscalYearPayload = {
  companyName: string;
  fiscalYearStartMonth: number;
  companyAbbr?: string;
};

export type GlobalDefaultsPayload = {
  companyName: string;
  defaultCurrency: string;
  fiscalYearName: string;
  country: string;
};

export type CompanyPayload = {
  companyName: string;
  companyAbbr: string;
  country: string;
  defaultCurrency: string;
  companyType?: string;
  domain?: string;
};

export type ProvisioningOperationResult = {
  action: string;
  /** Frappe MariaDB `db_name` from site_config (when resolved). */
  dbName?: string;
  outcome?: "applied" | "already_done";
  alreadyExists?: boolean;
  alreadyInstalled?: boolean;
  alreadyConfigured?: boolean;
  stdout?: string;
  stderr?: string;
  /** ERP API credentials returned by the createApiUser step only. */
  apiKey?: string;
  apiSecret?: string;
};

export type SmokeTestPayload = {
  companyName: string;
  apiKey: string;
  apiSecret: string;
};

export type FitdeskPayload = {
  companyName: string;
  companyAbbr: string;
  controlPlaneWebhookUrl?: string;
  controlPlaneWebhookSecret?: string;
};

/** Optional correlation for HTTP headers and logs (not sent in POST /sites/create body). */
export type ProvisioningCallContext = {
  requestId?: string;
  tenantId?: string;
};

export interface ProvisioningAdapter {
  /**
   * Stable adapter identifier used by orchestration logs and diagnostics.
   */
  readonly kind: "http-provisioning";
  createSite(site: string, adminPassword: string, ctx?: ProvisioningCallContext): Promise<ProvisioningOperationResult>;
  installErp(site: string, ctx?: ProvisioningCallContext): Promise<ProvisioningOperationResult>;
  installFitdesk(site: string, ctx?: ProvisioningCallContext): Promise<ProvisioningOperationResult>;
  enableScheduler(site: string, ctx?: ProvisioningCallContext): Promise<ProvisioningOperationResult>;
  setupLocale(site: string, payload: LocalePayload, ctx?: ProvisioningCallContext): Promise<ProvisioningOperationResult>;
  setupCompany(site: string, payload: CompanyPayload, ctx?: ProvisioningCallContext): Promise<ProvisioningOperationResult>;
  setupFiscalYear(site: string, payload: FiscalYearPayload, ctx?: ProvisioningCallContext): Promise<ProvisioningOperationResult>;
  setupGlobalDefaults(site: string, payload: GlobalDefaultsPayload, ctx?: ProvisioningCallContext): Promise<ProvisioningOperationResult>;
  setupComplete(site: string, payload: SetupCompletePayload, ctx?: ProvisioningCallContext): Promise<ProvisioningOperationResult>;
  setupRegional(site: string, payload: RegionalSetupPayload, ctx?: ProvisioningCallContext): Promise<ProvisioningOperationResult>;
  setupDomains(site: string, payload: DomainsPayload, ctx?: ProvisioningCallContext): Promise<ProvisioningOperationResult>;
  setupRoles(site: string, ctx?: ProvisioningCallContext): Promise<ProvisioningOperationResult>;
  addDomain(site: string, ctx?: ProvisioningCallContext): Promise<ProvisioningOperationResult>;
  createApiUser(site: string, ctx?: ProvisioningCallContext): Promise<ProvisioningOperationResult>;
  runSmokeTest(site: string, payload: SmokeTestPayload, ctx?: ProvisioningCallContext): Promise<ProvisioningOperationResult>;
  setupFitdesk(site: string, payload: FitdeskPayload, ctx?: ProvisioningCallContext): Promise<ProvisioningOperationResult>;
  healthCheck(site: string, ctx?: ProvisioningCallContext): Promise<ProvisioningOperationResult>;
  /**
   * Optional lazy backfill: read `db_name` from ERP `site_config.json` (HTTP provisioning API only).
   */
  resolveSiteDbName?(site: string, ctx?: ProvisioningCallContext): Promise<ProvisioningOperationResult>;
}
