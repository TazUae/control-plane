import { env } from "../../config/env.js";
import { DockerExecBackend } from "./docker-exec-backend.js";
import { HostBenchExecBackend } from "./host-bench-exec-backend.js";
import type { ErpExecutionBackend } from "./erp-execution-backend.js";

/**
 * Selects the ERP execution backend from `ERP_EXECUTION_MODE`.
 * Default remains Docker for backward-compatible deployments.
 */
export function createErpExecutionBackend(): ErpExecutionBackend {
  if (env.ERP_EXECUTION_MODE === "host_bench") {
    return new HostBenchExecBackend();
  }
  return new DockerExecBackend();
}
