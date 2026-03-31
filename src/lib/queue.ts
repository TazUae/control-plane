import { Queue } from "bullmq";
import { redis } from "./redis.js";
import { TENANT_PROVISIONING_QUEUE } from "./constants.js";

export const provisioningQueue = new Queue(TENANT_PROVISIONING_QUEUE, {
  connection: redis,
});
