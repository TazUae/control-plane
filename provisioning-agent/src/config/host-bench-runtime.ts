import { accessSync, constants, existsSync, statSync } from "node:fs";
import path from "node:path";

/**
 * Thrown when `ERP_EXECUTION_MODE=host_bench` but the filesystem does not match
 * what `HostBenchExecBackend` requires (real bench directory, optional executable path).
 */
export class HostBenchRuntimeError extends Error {
  override readonly name = "HostBenchRuntimeError";
  readonly code = "HOST_BENCH_RUNTIME_INVALID" as const;

  constructor(message: string) {
    super(message);
  }
}

function executableLooksLikeFilesystemPath(benchExecutable: string): boolean {
  return (
    path.isAbsolute(benchExecutable) ||
    benchExecutable.includes("/") ||
    benchExecutable.includes("\\")
  );
}

/**
 * Validates that `host_bench` mode can plausibly run: the bench workspace must exist.
 * If `ERP_BENCH_EXECUTABLE` is a filesystem path, it must exist and be accessible.
 * A bare name (e.g. `bench`) is not checked here — it must be on `PATH` at runtime.
 *
 * @see docs/erp-side-runtime.md
 */
export function validateHostBenchPaths(benchPath: string, benchExecutable: string): void {
  if (!existsSync(benchPath)) {
    throw new HostBenchRuntimeError(
      `ERP_BENCH_PATH does not exist: ${benchPath}. host_bench requires the provisioning-agent process to run where the real Frappe bench directory is mounted or installed (see docs/erp-side-runtime.md).`
    );
  }
  const st = statSync(benchPath);
  if (!st.isDirectory()) {
    throw new HostBenchRuntimeError(`ERP_BENCH_PATH is not a directory: ${benchPath}`);
  }

  if (!executableLooksLikeFilesystemPath(benchExecutable)) {
    return;
  }

  if (!existsSync(benchExecutable)) {
    throw new HostBenchRuntimeError(`ERP_BENCH_EXECUTABLE path does not exist: ${benchExecutable}`);
  }
  try {
    accessSync(benchExecutable, constants.R_OK);
  } catch {
    throw new HostBenchRuntimeError(`ERP_BENCH_EXECUTABLE is not readable: ${benchExecutable}`);
  }
}
