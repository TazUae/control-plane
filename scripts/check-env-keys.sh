#!/usr/bin/env bash
# Compare keys in .env.example vs .env (names only). Exits 0 on match, 1 on mismatch or missing .env.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

EXAMPLE=".env.example"
LOCAL=".env"

extract_keys() {
  grep -E '^[A-Za-z_][A-Za-z0-9_]*=' "$1" | sed 's/=.*//' | sort -u
}

if [[ ! -f "$EXAMPLE" ]]; then
  echo "error: missing $EXAMPLE" >&2
  exit 1
fi

EX_LIST=$(mktemp)
LO_LIST=$(mktemp)
trap 'rm -f "$EX_LIST" "$LO_LIST"' EXIT

extract_keys "$EXAMPLE" > "$EX_LIST"

if [[ ! -f "$LOCAL" ]]; then
  echo "No $LOCAL — copy from $EXAMPLE (e.g. cp $EXAMPLE $LOCAL)" >&2
  echo "Missing keys (expected from $EXAMPLE):"
  sed 's/^/  /' "$EX_LIST"
  exit 1
fi

extract_keys "$LOCAL" > "$LO_LIST"

echo "Keys in .env.example but not in .env:"
MISSING_KEYS=$(comm -23 "$EX_LIST" "$LO_LIST" || true)
if [[ -n "$MISSING_KEYS" ]]; then
  echo "$MISSING_KEYS" | sed 's/^/  /'
else
  echo "  (none)"
fi

echo "Keys in .env but not in .env.example:"
EXTRA_KEYS=$(comm -13 "$EX_LIST" "$LO_LIST" || true)
if [[ -n "$EXTRA_KEYS" ]]; then
  echo "$EXTRA_KEYS" | sed 's/^/  /'
else
  echo "  (none)"
fi

if [[ -z "$MISSING_KEYS" ]]; then MISSING=0; else MISSING=$(echo "$MISSING_KEYS" | wc -l | tr -d ' '); fi
if [[ -z "$EXTRA_KEYS" ]]; then EXTRA=0; else EXTRA=$(echo "$EXTRA_KEYS" | wc -l | tr -d ' '); fi

if [[ "$MISSING" -eq 0 && "$EXTRA" -eq 0 ]]; then
  echo "OK: key sets match (names only)."
  exit 0
fi
exit 1
