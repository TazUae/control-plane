import { spawn } from "node:child_process";
import { AgentError } from "./errors.js";

export type ExecResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
};

type ExecOptions = {
  timeoutMs: number;
  cwd?: string;
};

export async function execCommand(command: string, args: string[], options: ExecOptions): Promise<ExecResult> {
  const startedAt = Date.now();
  const { timeoutMs, cwd } = options;

  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      clearTimeout(timer);
      reject(
        new AgentError("INFRA_UNAVAILABLE", "Provisioning command unavailable", {
          details: error.message,
          stdout: stdout.trim(),
          stderr: stderr.trim(),
          statusCode: 503,
        })
      );
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      const trimmedStdout = stdout.trim();
      const trimmedStderr = stderr.trim();
      const durationMs = Date.now() - startedAt;

      if (timedOut) {
        reject(
          new AgentError("ERP_TIMEOUT", "Provisioning command timed out", {
            details: `Command exceeded ${timeoutMs}ms`,
            stdout: trimmedStdout,
            stderr: trimmedStderr,
            statusCode: 504,
          })
        );
        return;
      }

      const exitCode = code ?? 1;
      if (exitCode !== 0) {
        reject(
          new AgentError("ERP_COMMAND_FAILED", "Provisioning command failed", {
            details: `Command exited with code ${exitCode}`,
            stdout: trimmedStdout,
            stderr: trimmedStderr,
            exitCode,
            retryable: false,
            statusCode: 400,
          })
        );
        return;
      }

      resolve({
        stdout: trimmedStdout,
        stderr: trimmedStderr,
        exitCode,
        durationMs,
      });
    });
  });
}
