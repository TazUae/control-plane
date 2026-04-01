export type ProvisioningOperationResult = {
  action: string;
  stdout?: string;
  stderr?: string;
};

export interface ProvisioningAdapter {
  createSite(site: string): Promise<ProvisioningOperationResult>;
  installErp(site: string): Promise<ProvisioningOperationResult>;
  enableScheduler(site: string): Promise<ProvisioningOperationResult>;
  addDomain(site: string): Promise<ProvisioningOperationResult>;
  createApiUser(site: string): Promise<ProvisioningOperationResult>;
  healthCheck(site: string): Promise<ProvisioningOperationResult>;
}
