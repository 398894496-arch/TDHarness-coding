#!/bin/bash
# Copy product bits from the install tree into a durable DSH_HOME.
# Chat is on the person's share (.dsh-desk), not here. Do not copy sessions.
set -euo pipefail
ROOT=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --root) ROOT="$2"; shift 2 ;;
    *) echo "usage: sync-desk-home.sh --root DIR" >&2; exit 2 ;;
  esac
done
[[ -n "$ROOT" && -d "$ROOT/home" ]] || { echo "sync-src-missing" >&2; exit 2; }
SRC="$ROOT/home"
DEST="${DSH_DESK_HOME:-$HOME/.dsh-company-rc8/desk-home}"
mkdir -p "$DEST/profiles/web" "$DEST/work"

migrate() {
  local name="$1"
  if [[ -e "$SRC/$name" && ! -e "$DEST/$name" ]]; then
    cp -a "$SRC/$name" "$DEST/$name"
    echo "DESK_HOME_MIGRATE=$name"
  fi
}
migrate ext-bridge-token
# sessions/storages are not local. Leftovers are deleted at acquire.

# settings.yaml is the official user-settings document (appearance, locale,
# sidebar). Stamp it once. Later boots must not clobber what the person set.
if [[ -f "$SRC/settings.yaml" ]]; then
  if [[ ! -f "$DEST/settings.yaml" ]]; then
    cp -a "$SRC/settings.yaml" "$DEST/settings.yaml"
    echo "DESK_HOME_MIGRATE=settings.yaml"
  else
    echo "DESK_HOME_SETTINGS_KEEP=1"
  fi
  # Company standard: sidebar agent tools stay on. Do not rewrite the rest
  # of the person's settings.yaml (theme / locale).
  # Bundled node only. A fresh Mac has no CLT; do not call the system interpreter.
  PIN_JS="$ROOT/mac-pin-settings.js"
  NODEBIN=""
  for c in "$ROOT/node/bin/node" "$ROOT/node"; do
    [[ -n "$c" && -x "$c" ]] && { NODEBIN="$c"; break; }
  done
  [[ -n "$NODEBIN" && -f "$PIN_JS" ]] || { echo "bundled-node-or-pin-missing" >&2; exit 2; }
  # mac-pin-settings.js prints SIDEBAR_TOOLS_ON / COMPLETE_AGENT_PRESET
  "$NODEBIN" "$PIN_JS" "$DEST/settings.yaml"
fi
if [[ -f "$SRC/profiles/web/overlay.yml" ]]; then
  cp -a "$SRC/profiles/web/overlay.yml" "$DEST/profiles/web/overlay.yml"
fi
# Mac sample only. Pack overlay has no youyun; settings.yaml is kept.
# Without this re-wire the selector shows a model id overlay no longer has.
if [[ -f "$HOME/.dsh-company-rc8/youyun.want" ]]; then
  WIRE=""
  for c in "$ROOT/mac-youyun-tdh-wire.sh"; do
    [[ -f "$c" ]] && { WIRE="$c"; break; }
  done
  if [[ -n "$WIRE" ]]; then
    if bash "$WIRE"; then
      echo "YOUYUN_WIRE_AFTER_SYNC=1"
    else
      echo "YOUYUN_WIRE_AFTER_SYNC=0"
    fi
  fi
fi
if [[ -f "$SRC/profiles/web/package.json" ]]; then
  cp -a "$SRC/profiles/web/package.json" "$DEST/profiles/web/package.json"
fi
cosmokit_ok() {
  local ego="$DEST/profiles/web/node_modules/ego-browser/node_modules"
  [[ -f "$ego/schemastery/lib/index.cjs" && -f "$ego/cosmokit/lib/index.cjs" ]] || return 1
  local node=""
  for c in "$ROOT/node/bin/node" "$ROOT/node" "$(command -v node 2>/dev/null || true)"; do
    [[ -n "$c" && -x "$c" ]] && { node="$c"; break; }
  done
  [[ -n "$node" ]] || return 1
  local prove="$ROOT/prove-cosmokit.js"
  [[ -f "$prove" ]] || return 1
  "$node" "$prove" "$ego" >/dev/null 2>&1
}

if [[ -d "$SRC/profiles/web/node_modules" ]]; then
  # Do not rewrite node_modules while 17803 is the live desk: it has those
  # files mapped. First run or a stopped desk still gets a fresh copy.
  # Exception: a dest that cannot require("cosmokit") from ego-browser
  # already cannot boot. Refill or the next launch dies the same way.
  desk_up=0
  if command -v lsof >/dev/null 2>&1 && lsof -nP -iTCP:17803 -sTCP:LISTEN >/dev/null 2>&1; then
    desk_up=1
  fi
  if [[ $desk_up -eq 1 && -d "$DEST/profiles/web/node_modules" ]] && cosmokit_ok; then
    echo "DESK_HOME_NM_SKIP=desk-up"
  else
    mkdir -p "$DEST/profiles/web/node_modules"
    if command -v rsync >/dev/null 2>&1; then
      rsync -a --delete "$SRC/profiles/web/node_modules/" "$DEST/profiles/web/node_modules/"
    else
      rm -rf "$DEST/profiles/web/node_modules"
      cp -a "$SRC/profiles/web/node_modules" "$DEST/profiles/web/node_modules"
    fi
    if cosmokit_ok; then
      echo "EGO_COSMOKIT_REQUIRE=1"
    else
      echo "EGO_COSMOKIT_REQUIRE=0" >&2
      exit 2
    fi
  fi
fi
echo "DSH_HOME=$DEST"
echo "DESK_HOME_SYNC=1"
