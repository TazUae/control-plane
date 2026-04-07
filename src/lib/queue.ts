import { Queue } from "bullmq";
import { TENANT_PROVISIONING_QUEUE } from "./constants.js";
import { redis } from "./redis.js";

export const provisioningQueue = new Queue(TENANT_PROVISIONING_QUEUE, {
  connection: redis,
});
