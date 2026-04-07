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
};

/** Optional correlation context propagated to provisioning-agent and logs. */
export type ProvisioningCallContext = {
  requestId?: string;
  tenantId?: string;
};

export interface ProvisioningAdapter {
  /**
   * Stable adapter identifier used by orchestration logs and diagnostics.
   */
  readonly kind: "http-provisioning";
  createSite(site: string, ctx?: ProvisioningCallContext): Promise<ProvisioningOperationResult>;
  installErp(site: string, ctx?: ProvisioningCallContext): Promise<ProvisioningOperationResult>;
  enableScheduler(site: string, ctx?: ProvisioningCallContext): Promise<ProvisioningOperationResult>;
  addDomain(site: string, ctx?: ProvisioningCallContext): Promise<ProvisioningOperationResult>;
  createApiUser(site: string, ctx?: ProvisioningCallContext): Promise<ProvisioningOperationResult>;
  healthCheck(site: string, ctx?: ProvisioningCallContext): Promise<ProvisioningOperationResult>;
  /**
   * Optional lazy backfill: read `db_name` from ERP `site_config.json` (HTTP provisioning API only).
   */
  resolveSiteDbName?(site: string, ctx?: ProvisioningCallContext): Promise<ProvisioningOperationResult>;
}
