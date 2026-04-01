import { SiteOperationRequestSchema, SuccessEnvelope } from "../contracts/provisioning.js";
import { requireBearerToken } from "../lib/auth.js";
import { ProvisioningService } from "../services/provisioning-service.js";
import { AllowedProvisioningAction } from "../providers/erpnext/commands.js";

type RouteSpec = {
  path: string;
  action: AllowedProvisioningAction;
};

const routeSpecs: RouteSpec[] = [
  { path: "/sites/create", action: "createSite" },
  { path: "/sites/install-erp", action: "installErp" },
  { path: "/sites/enable-scheduler", action: "enableScheduler" },
  { path: "/sites/add-domain", action: "addDomain" },
  { path: "/sites/create-api-user", action: "createApiUser" },
];

export async function registerSiteRoutes(app: any, service: ProvisioningService): Promise<void> {
  for (const spec of routeSpecs) {
    app.post(spec.path, { preHandler: [requireBearerToken] }, async (req: any, reply: any) => {
      const parsed = SiteOperationRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(422).send({
          ok: false,
          error: {
            code: "ERP_VALIDATION_FAILED",
            message: "Invalid request body",
            retryable: false,
            details: parsed.error.message,
          },
          timestamp: new Date().toISOString(),
        });
      }

      const result = await service.run(spec.action, parsed.data.site);
      const response: SuccessEnvelope<typeof result> = {
        ok: true,
        data: result,
        timestamp: new Date().toISOString(),
      };
      return response;
    });
  }
}
