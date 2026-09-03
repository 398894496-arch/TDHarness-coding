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
node "$ROOT/patches/apply-kernel-patches.js" "$PREFIX"
echo "SETUP_OK=1"
echo "PATH_HINT=$PREFIX/bin"
echo "NEXT=export PATH=\"$PREFIX/bin:\$PATH\" DEEPSEEK_API_KEY=... && dsh --patch \"$ROOT/overlays/solo.yml\""
