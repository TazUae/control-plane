import { HealthResponseDataSchema, SuccessEnvelope } from "../contracts/provisioning.js";

export async function registerHealthRoutes(app: any): Promise<void> {
  app.get("/health", async () => {
    const data = HealthResponseDataSchema.parse({
      status: "ok",
      service: "provisioning-agent",
      version: "1.0.0",
    });

    const response: SuccessEnvelope<typeof data> = {
      ok: true,
      data,
      timestamp: new Date().toISOString(),
    };
    return response;
  });
}
