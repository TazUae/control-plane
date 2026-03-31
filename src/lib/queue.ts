import { Queue } from "bullmq";
import { TENANT_PROVISIONING_QUEUE } from "./constants.js";
import { env } from "../config/env.js";

export const provisioningQueue = new Queue(TENANT_PROVISIONING_QUEUE, {
  connection: {
    host: new URL(env.REDIS_URL).hostname,
    port: Number(new URL(env.REDIS_URL).port || 6379),
  },
});
