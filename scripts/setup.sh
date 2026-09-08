#!/usr/bin/env bash
# Install pinned dsh into ~/.tdh-coding-prefix and apply this tree's patches.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PIN="$(awk -F': ' '/^id:/{gsub(/[" ]/, "", $2); print $2; exit}' "$ROOT/kernel.yml")"
PREFIX="${TDH_PREFIX:-$HOME/.tdh-coding-prefix}"
case "$PREFIX" in
  "$HOME/.local"|"$HOME/.local/"*|"$HOME/dsh-node-rc8"|"$HOME/dsh-node-rc8/"*)
    echo "BLOCKED=refuses-known-live-tree:$PREFIX" >&2
    exit 2
    ;;
esac
mkdir -p "$PREFIX"
echo "PIN=$PIN"
echo "PREFIX=$PREFIX"
npm install -g "@deepseek-ai/dsh@${PIN}" --prefix "$PREFIX"
# Coding setup applies only the local-workspace subset. The full patcher also
# pins company skill roots (__DESK_SKILLS__), custom trustedHost, web_fetch
# and .company-root into the official presets, which overlays/solo.yml does
# not define (C4). TDH_FULL_PATCHES=1 restores the old full-pin behavior for
# the company desk tree.
CODING_MARKS="company-sandbox-local-unc-v1,company-win-junction-mklink-v3,company-win-junction-mklink-v4,company-glob-missing-root-v1,company-session-smbfs-rename-v1,company-goal-resume-armed-v1"
if [ "${TDH_FULL_PATCHES:-}" = "1" ]; then
  node "$ROOT/patches/apply-kernel-patches.js" "$PREFIX"
else
  node "$ROOT/patches/apply-kernel-patches.js" "$PREFIX" --only "$CODING_MARKS"
fi
echo "SETUP_OK=1"
echo "PATH_HINT=$PREFIX/bin"
echo "NEXT=export PATH=\"$PREFIX/bin:\$PATH\" DEEPSEEK_API_KEY=... && dsh --patch \"$ROOT/overlays/solo.yml\""
