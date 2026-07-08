import type { ProvisioningStatus } from "@prisma/client";
import { matchesTransientDbSignature } from "./transient-db-signature.js";

/**
 * Trainer-facing failure copy. Never derived from raw stderr/stack traces —
 * `getProvisioningFailureReason` (errors.ts) prefers raw command stderr for the
 * *internal* failure reason (persisted to `ProvisioningJob.failureReason`,
 * logs, and audit events), which is correct for operators but unsafe to show
 * a trainer verbatim (internal paths, DB names, stack frames).
 */
export const SAFE_TRANSIENT_DB_MESSAGE =
  "Workspace setup hit a temporary database issue. Retrying safely.";
export const SAFE_UNKNOWN_FAILURE_MESSAGE =
  "Workspace setup could not complete automatically. Please contact support.";

/**
 * Map the internal (raw) failure reason to a safe, trainer-facing message.
 * The raw reason is never returned here — only used to pick which of the two
 * fixed, safe sentences applies. Callers that need the raw text for
 * diagnostics should read it from logs, `ProvisioningJob.result`, or audit
 * events, not from this function's output.
 */
export function getSafePublicFailureMessage(rawReason: string | null | undefined): string | null {
  if (!rawReason) return null;
  return matchesTransientDbSignature(rawReason) ? SAFE_TRANSIENT_DB_MESSAGE : SAFE_UNKNOWN_FAILURE_MESSAGE;
}

/**
 * Status-aware variant for callers (e.g. tenant.service.ts) that know the
 * job's current lifecycle status, not just its stored failure text.
 *
 * A terminal `failed` job has exhausted retries, so even a transient-looking
 * signature no longer means "still retrying" — showing the transient/"Retrying
 * safely" copy there would be misleading. Terminal failures always get the
 * deterministic contact-support message. Any non-terminal status (queued,
 * running, enqueue_failed) reuses `getSafePublicFailureMessage` unchanged, so
 * a recorded transient signature during an in-flight retry still reads as
 * "Retrying safely."
 */
export function getStatusAwarePublicFailureMessage(
  status: ProvisioningStatus,
  rawReason: string | null | undefined
): string | null {
  if (!rawReason) return null;
  if (status === "failed") {
    return SAFE_UNKNOWN_FAILURE_MESSAGE;
  }
  return getSafePublicFailureMessage(rawReason);
}
