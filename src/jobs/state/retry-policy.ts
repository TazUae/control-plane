import { isProvisioningError } from "../../lib/provisioning/errors.js";

/**
 * Transient MariaDB DDL failures (1412 table-definition-changed, 1205 lock-wait,
 * 1213 deadlock). The erp-execution-service already flips `retryable` on these,
 * but we detect them defensively here too so a not-yet-updated execution service
 * still retries instead of failing the job. Numeric codes are matched only in
 * errno context to avoid false positives.
 */
const TRANSIENT_DB_PATTERNS: RegExp[] = [
  /table definition has changed/i,
  /lock wait timeout exceeded/i,
  /deadlock found when trying to get lock/i,
  /\(\s*(?:1412|1205|1213)\s*,/,
  /errno[:=]?\s*(?:1412|1205|1213)\b/i,
];

export function isTransientProvisioningError(error: unknown): boolean {
  if (!isProvisioningError(error)) return false;
  const haystack = [error.stderr, error.stdout, error.details, error.message]
    .filter((s): s is string => typeof s === "string")
    .join("\n");
  return TRANSIENT_DB_PATTERNS.some((re) => re.test(haystack));
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
