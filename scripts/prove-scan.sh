#!/usr/bin/env bash
# Fail if this public tree contains office fingerprints or secrets.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
bad=0
needles=(
  '192\.168\.1\.15'
  '100\.68\.88\.100'
  'desktop-2698418'
  'tskey-'
  'sec-people'
  'dsh-company-rc8'
  '__SITE_HOST__'
)

list_files() {
  if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    local tracked
    tracked="$(git ls-files)"
    if [ -n "$tracked" ]; then
      printf '%s\n' "$tracked"
      return
    fi
  fi
  find . -type f ! -path './.git/*' ! -path './prefix/*' ! -path './node_modules/*'
}

while IFS= read -r f; do
  [ -z "$f" ] && continue
  case "$f" in
    ./scripts/prove-scan.sh|scripts/prove-scan.sh) continue ;;
  esac
  for n in "${needles[@]}"; do
    if grep -E -n "$n" "$f" >/dev/null 2>&1; then
      echo "SCAN_HIT=$f|$n"
      bad=1
    fi
  done
done < <(list_files)

if [ "$bad" -ne 0 ]; then
  echo "SCAN_OK=0" >&2
  exit 1
fi
node scripts/scan-secrets.js
echo "SCAN_OK=1"
