/**
 * Transient MariaDB DDL failure signatures (1412 table-definition-changed, 1205
 * lock-wait, 1213 deadlock). Shared between the retry policy (decides whether
 * to retry a step) and the public failure-message sanitizer (decides what a
 * trainer sees). Numeric codes are matched only in errno context to avoid
 * false positives on unrelated numbers (e.g. `account_count=1412`).
 */
const TRANSIENT_DB_PATTERNS: RegExp[] = [
  /table definition has changed/i,
  /lock wait timeout exceeded/i,
  /deadlock found when trying to get lock/i,
  /\(\s*(?:1412|1205|1213)\s*,/,
  /errno[:=]?\s*(?:1412|1205|1213)\b/i,
];

export function matchesTransientDbSignature(text: string): boolean {
  return TRANSIENT_DB_PATTERNS.some((re) => re.test(text));
}
