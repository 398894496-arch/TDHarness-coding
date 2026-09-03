#!/usr/bin/env bash
# Drop this check into a bundled start.command before any write into $ROOT.
# Quarantined .app copies run from a read-only AppTranslocation path (EROFS).
# Mark: company-mac-no-translocate-v1
set -euo pipefail
ROOT="${1:-${ROOT:-}}"
if [ -z "$ROOT" ]; then
  echo "usage: mac-no-translocate.sh <app-root>" >&2
  exit 2
fi
case "$ROOT" in
  */AppTranslocation/*)
    echo "BLOCKED=app-translocation" >&2
    echo "Drag the app into /Applications. Do not open it from Downloads or a DMG." >&2
    exit 2
    ;;
esac
echo "TRANSLOCATE_OK=1"
