import { isProvisioningError } from "../../lib/provisioning/errors.js";
import { matchesTransientDbSignature } from "../../lib/provisioning/transient-db-signature.js";

/**
 * The erp-execution-service already flips `retryable` on the transient DB
 * signature, but we detect it defensively here too so a not-yet-updated
 * execution service still retries instead of failing the job.
 */
export function isTransientProvisioningError(error: unknown): boolean {
  if (!isProvisioningError(error)) return false;
  const haystack = [error.stderr, error.stdout, error.details, error.message]
    .filter((s): s is string => typeof s === "string")
    .join("\n");
  return matchesTransientDbSignature(haystack);
}

export function shouldRetryProvisioningError(error: unknown): boolean {
  if (isProvisioningError(error)) {
    return error.retryable || isTransientProvisioningError(error);
  }
  return true;
}

export type BackoffOptions = {
  baseMs?: number;
  factor?: number;
  capMs?: number;
  jitter?: boolean;
  /** Test seam for deterministic jitter. */
  random?: () => number;
};

/**
 * Exponential backoff with equal jitter for the per-step retry sleep. Attempt is
 * 1-based (the delay after the Nth failed attempt). Jitter spreads retries so a
 * transient DB blip that hit multiple steps doesn't resynchronize on retry.
 */
export function computeBackoffMs(attempt: number, options: BackoffOptions = {}): number {
  const base = options.baseMs ?? 3000;
  const factor = options.factor ?? 2;
  const cap = options.capMs ?? 30_000;
  const jitter = options.jitter ?? true;
  const rand = options.random ?? Math.random;

  const exp = Math.min(cap, base * Math.pow(factor, Math.max(0, attempt - 1)));
  if (!jitter) return Math.round(exp);
  const half = exp / 2;
  return Math.round(half + rand() * half);
}
