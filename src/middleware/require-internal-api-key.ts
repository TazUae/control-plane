import { env } from "../config/env.js";

export async function requireInternalApiKey(
  req: any,
  reply: any
): Promise<void> {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) {
    void reply.code(401).send({ error: "Missing Bearer token" });
    return;
  }

  const token = auth.slice("Bearer ".length).trim();
  if (!token) {
    void reply.code(401).send({ error: "Missing Bearer token" });
    return;
  }

  if (token !== env.CONTROL_PLANE_API_KEY) {
    void reply.code(403).send({ error: "Invalid API key" });
    return;
  }
}
