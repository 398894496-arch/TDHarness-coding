#!/bin/bash
set -euo pipefail
export PATH="/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin:$PATH"
ROOT="$(cd "$(dirname "$0")" && pwd)"
NODEBIN="$ROOT/node/bin/node"
[[ -x "$NODEBIN" ]] || { echo "bundled-node-missing" >&2; exit 2; }
BOOT_STATUS="$HOME/.dsh-company-rc8/desk-boot.status"
boot_status() {
  mkdir -p "$HOME/.dsh-company-rc8"
  printf '%s\n' "$1" > "$BOOT_STATUS"
}
boot_status starting
# company-mac-no-translocate-v1
# Quarantined apps run from a read-only AppTranslocation copy. Writing
# desk-bridge.json or bundled presets then EROFS. Drag to /Applications.
case "$ROOT" in
  */AppTranslocation/*)
    mkdir -p "$HOME/.dsh-company-rc8/desk-home"
    printf '%s\n' "Error: 请把 TDHarness 拖到「应用程序」后再打开。不要从下载文件夹或磁盘映像里直接开。" > "$HOME/.dsh-company-rc8/desk-home/web-runtime.err"
    boot_status fail
    osascript -e 'display dialog "请把 TDHarness 拖到「应用程序」后再打开。不要从下载文件夹或磁盘映像里直接开。" buttons {"OK"} default button "OK" with title "TDHarness"' >/dev/null 2>&1 || true
    echo "BLOCKED=app-translocation" >&2
    exit 2
    ;;
esac
if [ -x "$ROOT/sync-desk-home.sh" ]; then
  bash "$ROOT/sync-desk-home.sh" --root "$ROOT"
fi
export DSH_HOME="${HOME}/.dsh-company-rc8/desk-home"
OV="$DSH_HOME/profiles/web/overlay.yml"
[[ -f "$OV" ]] || { echo "desk-home-overlay-missing" >&2; exit 2; }
if grep -q '__DESK_HOME__' "$OV" 2>/dev/null; then
  OV="$OV" DH="$DSH_HOME" "$NODEBIN" -e 'const fs=require("fs"); fs.writeFileSync(process.env.OV, fs.readFileSync(process.env.OV,"utf8").split("__DESK_HOME__").join(process.env.DH));'
fi
# Stale Error: lines here become the login-timeout dialog. Truncate every launch.
: > "$DSH_HOME/web-runtime.err"
# Stays workspace-write, and this is MEASURED, not assumed (2026-08-26).
#
# The Windows client has to derive its mode from the workspace location, because
# there a confined shell cannot reach a network path at all (WRITE_RESTRICTED
# token vs the SMB redirector). macOS does not have that problem: seatbelt allows
# writes by PATH, not by identity, reads are not restricted at all
# ((allow default)), and the ACL write grants belong to the windows-acl rung
# alone, so nothing tries to materialize an ACE on the workspace.
#
# Measured against a real SMB mount with the shipped provider
# (scripts/p-mac-desk/mac-sandbox-smb-probe.js): stat/list/read/write on an
# smbfs workspace all OK under workspace-write, while writing outside the
# workspace was still EPERM in both the SMB and the local control case. So the
# Mac keeps real confinement AND reaches the share -- strictly better than the
# Windows situation. Do not "fix" this by copying the Windows exception.
#
# This variable is only the deployment default (sandbox-policy.mode). The value
# that actually governs each session is the permission plugin's defaultPreset in
# the shared overlay, which stays baked at workspace-write: unlike the Windows
# launcher, nothing here rewrites it, and that is deliberate.
export DSH_PERMISSION_MODE=workspace-write
export DEEPSEEK_BASE_URL=http://{{TDH_HOST}}:8450/v1
# Hot-planting start.command without site-render.py leaves this token in
# the door. web_search / web_fetch then fail to parse the URL.
case "$DEEPSEEK_BASE_URL" in
  *__SITE_*) echo "BLOCKED=unrendered-site-token" >&2; exit 2 ;;
esac
# ALWAYS_LOGIN=1
# Every launch types roster user+password. Close/logout deletes gw.token.
# Do not reuse a leftover token file to skip the dialog.
unset DEEPSEEK_API_KEY
TOKFILE="${HOME}/.dsh-company-rc8/gw.token"
LOGIN_URL="https://{{TDH_HOST}}:8443/company/login"
# JOIN_BEFORE_LOGIN=1
# Off-LAN must be on 100.x before this POST hits the office login URL.
if [ -x "$ROOT/mac-join-off-lan.sh" ]; then
  bash "$ROOT/mac-join-off-lan.sh" "$ROOT" || true
fi
# company-login-screen-update-v1
# Update ON the login path, BEFORE roster password. Do not wait for LOGIN_OK.
NODEBIN="$ROOT/node/bin/node"
if [ -f "$ROOT/pack-update-check.js" ] && [ -f "$ROOT/BUILD.json" ]; then
  UPD_OUT="$("$NODEBIN" "$ROOT/pack-update-check.js" --root "$ROOT" \
    --url "https://{{TDH_HOST}}:8443/client/version.json" || true)"
  printf '%s\n' "$UPD_OUT"
  case "$UPD_OUT" in
    *UPDATE_AVAILABLE=1*)
      SERVED_MARK="$(printf '%s\n' "$UPD_OUT" | awk -F= '/^SERVED_MARK=/{print $2; exit}')"
      boot_status updating
      CHOICE="$(osascript -e 'button returned of (display dialog "公司已发新版。点「现在更新」一键更新，不用打开下载页。" buttons {"退出","稍后再说","现在更新"} default button "现在更新" with title "TDHarness")' || true)"
      case "$CHOICE" in
        退出)
          boot_status quit
          exit 2
          ;;
        现在更新)
          osascript -e 'display dialog "正在下载并安装新版，进度显示在 TDHarness 窗口里。" buttons {"好"} giving up after 3 with title "TDHarness"' >/dev/null 2>&1 || true
          if lsof -nP -iTCP:17803 -sTCP:LISTEN >/dev/null 2>&1; then
            kill $(lsof -nP -t -iTCP:17803 -sTCP:LISTEN) 2>/dev/null || true
            sleep 1
          fi
          LOCK="$HOME/.dsh-company-rc8/tree-restore.lock"
          if [[ -d "$LOCK" ]]; then
            old="$(cat "$LOCK/pid" 2>/dev/null || true)"
            if [[ -n "$old" ]] && kill -0 "$old" 2>/dev/null; then
              echo "TREE_RESTORE_WAIT=$old"
              for _w in $(seq 1 480); do
                kill -0 "$old" 2>/dev/null || break
                sleep 1
              done
            fi
          fi
          if ! bash "$ROOT/tree-restore.sh" --root "$ROOT"; then
            UPD_AGAIN="$("$NODEBIN" "$ROOT/pack-update-check.js" --root "$ROOT" \
              --url "https://{{TDH_HOST}}:8443/client/version.json" || true)"
            case "$UPD_AGAIN" in
              *UPDATE_AVAILABLE=1*)
                boot_status fail
                echo "TREE_RESTORE_FAIL=1"
                osascript -e 'display dialog "更新失败。程序没有换掉。看 ~/Library/Logs/TDHarness.log" buttons {"OK"} with title "TDHarness"' >/dev/null 2>&1 || true
                exit 2
                ;;
            esac
            echo "TREE_RESTORE_REUSED=1"
          fi
          osascript -e 'display dialog "更新完成。请重新登录。" buttons {"好"} giving up after 3 with title "TDHarness"' >/dev/null 2>&1 || true
          exec /bin/bash "$ROOT/start.command"
          ;;
        *)
          if [[ "$SERVED_MARK" =~ ^[0-9a-f]{32}$ ]]; then
            "$NODEBIN" "$ROOT/pack-update-check.js" --defer "$SERVED_MARK" || true
          fi
          echo "UPDATE_LATER=1"
          boot_status starting
          ;;
      esac
      ;;
  esac
fi
if [ -z "${DEEPSEEK_API_KEY:-}" ] || [ "$DEEPSEEK_API_KEY" = "company-gateway" ]; then
  # Browser GET of this URL is 404 not-found. Win AppHost POSTs JSON; Mac had no form.
  mkdir -p "$(dirname "$TOKFILE")"
  LOGIN_OK=0
  for _try in 1 2 3; do
  USER="$(osascript -e 'text returned of (display dialog "账号（公司花名册里的账号，不是邮箱）" default answer "tdh" with title "TDHarness")' || true)"
  PASS="$(osascript -e 'text returned of (display dialog "密码" default answer "" with hidden answer with title "TDHarness")' || true)"
  if [ -z "$USER" ] || [ -z "$PASS" ]; then
    printf '%s\n' "Error: 没输入账号或密码，已取消。" > "$DSH_HOME/web-runtime.err"
    boot_status quit
    echo "BLOCKED=gw-token-required" >&2
    exit 2
  fi
  if LOGIN_USER="$USER" LOGIN_PASS="$PASS" LOGIN_URL="$LOGIN_URL" TOKFILE="$TOKFILE" \
    "$NODEBIN" "$ROOT/mac-company-login.js"; then
    LOGIN_OK=1
    break
  fi
  osascript -e 'display dialog "账号或密码不对，再试一次。" buttons {"OK"} default button "OK" with title "TDHarness"' >/dev/null 2>&1 || true
  done
  unset USER PASS LOGIN_USER LOGIN_PASS
  if [ "$LOGIN_OK" != 1 ]; then
    printf '%s\n' "Error: 登录失败。花名册账号或密码不对。" > "$DSH_HOME/web-runtime.err"
    boot_status fail
    echo "BLOCKED=gw-token-required" >&2
    exit 2
  fi
  DEEPSEEK_API_KEY="$(tr -d '\r\n' < "$TOKFILE")"
  export DEEPSEEK_API_KEY
fi
export NO_PROXY=localhost,127.0.0.1,{{TDH_HOST}}
unset HTTP_PROXY HTTPS_PROXY ALL_PROXY http_proxy https_proxy all_proxy
mkdir -p "$HOME/Library/Fonts" "$DSH_HOME/work"
FONT_SRC="$ROOT/fonts/NotoSansCJKsc-Regular.otf"
[[ -f "$FONT_SRC" ]] || { echo "bundled-font-missing" >&2; exit 2; }
cp "$FONT_SRC" "$HOME/Library/Fonts/NotoSansCJKsc-Regular.otf"
if [ -x "$ROOT/mac-mount-company.sh" ]; then
  if ! bash "$ROOT/mac-mount-company.sh"; then
    boot_status fail
    echo "BLOCKED=company-mount" >&2
    exit 2
  fi
fi
WORK="$DSH_HOME/work"
WP="$HOME/.dsh-company-rc8/work.personal"
if [ -f "$WP" ]; then
  CAND="$(tr -d '\r\n' < "$WP")"
  if [ -n "$CAND" ] && [ -d "$CAND" ]; then
    WORK="$CAND"
  fi
fi
SKILL_CACHE="$HOME/.dsh-company-rc8/skills"
SHARE_SKILLS="$HOME/company/_skills"
PRESET_YML=""
for cand in \
  "$ROOT/prefix/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-agent-presets/presets/standard/agent.cordis.yml" \
  "$ROOT/prefix/lib/node_modules/@deepseek-ai/dsh/config/agent-presets/standard/agent.cordis.yml" \
  "$ROOT/prefix/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-agent-presets/presets/standard/agent.cordis.yml" \
  "$ROOT/prefix/node_modules/@deepseek-ai/dsh/config/agent-presets/standard/agent.cordis.yml"
do
  if [ -f "$cand" ]; then
    PRESET_YML="$cand"
    break
  fi
done
if [ -f "$ROOT/sync-skills.js" ]; then
  "$ROOT/node/bin/node" "$ROOT/sync-skills.js" --cache "$SKILL_CACHE" \
    --share "$SHARE_SKILLS" --seed "$ROOT/skills" \
    --overlay "$OV" --preset "$PRESET_YML" || true
fi
NODEBIN="$ROOT/node/bin/node"
# Official DeepSeek search stays off. Same pin as Win start.ps1 / AppHost.
"$NODEBIN" -e '
const fs = require("fs");
const p = process.argv[1];
const door = process.argv[2];
let t = fs.readFileSync(p, "utf8");
for (const id of ["web-search-deepseek", "web", "tool-web", "company-web-search"]) {
  t = t.replace(new RegExp("(^|\\n)- id: " + id + "\\n(?:  .*\\n)*", "m"), "$1");
}
const block = "- id: web-search-deepseek\n  disabled: true\n- id: web\n  config:\n    searchProvider: company\n    fetchProvider: company\n- id: tool-web\n  config:\n    fetch: true\n    searchTimeoutMs: 60000\n    fetchTimeoutMs: 90000\n- id: company-web-search\n  config:\n    baseURL: " + door + "\n";
const i = t.indexOf("- id: ");
if (i < 0) throw new Error("overlay-no-rows");
t = t.slice(0, i) + block + t.slice(i);
if (t.includes("api." + "deepseek.com")) throw new Error("overlay-named-upstream");
if (t.includes("/anthropic")) throw new Error("overlay-still-official-search-door");
fs.writeFileSync(p, t);
' "$OV" "http://{{TDH_HOST}}:8450"
"$NODEBIN" -e '
const fs = require("fs");
const p = process.argv[1];
let t = fs.readFileSync(p, "utf8");
// company-click-one-hand-v1
t = t.replace(/(^|\n)- id: bridge-browser\n(?:  .*\n)*/m, "$1");
t = t.replace(/(^|\n)- id: company-open-browser\n(?:  .*\n)*/m, "$1");
t = t.replace(/(^|\n)- id: ego-browser\n(?:  .*\n)*/m, "$1");
const block = "- id: bridge-browser\n  disabled: true\n  config:\n    sessionWorkspacePath: \"\"\n    deferSessionCreate: true\n- id: ego-browser\n  name: ego-browser\n  disabled: true\n- id: company-open-browser\n  disabled: true\n";
const i = t.indexOf("- id: ");
if (i < 0) throw new Error("overlay-no-rows");
fs.writeFileSync(p, t.slice(0, i) + block + t.slice(i));
' "$OV"
BIN="$ROOT/prefix/lib/node_modules/@deepseek-ai/dsh/lib/bin.js"
[[ -f "$BIN" ]] || BIN="$ROOT/prefix/node_modules/@deepseek-ai/dsh/lib/bin.js"
PORT=17803
if [ -d "$ROOT/browser-extension" ]; then
  BRIDGE_DIR="$HOME/.dsh-company-rc8/browser-extension"
  mkdir -p "$BRIDGE_DIR"
  if [ ! -f "$BRIDGE_DIR/manifest.json" ]; then
    ditto "$ROOT/browser-extension" "$BRIDGE_DIR" 2>/dev/null || cp -R "$ROOT/browser-extension/." "$BRIDGE_DIR/"
  fi
  printf '%s\n' "{\"http\":\"http://127.0.0.1:${PORT}\"}" > "$BRIDGE_DIR/desk-bridge.json"
  export COMPANY_BRIDGE_EXT="$BRIDGE_DIR"
  printf '%s\n' "$BRIDGE_DIR" > "$HOME/.dsh-company-rc8/bridge-ext.path"
  echo "BROWSER_BRIDGE=http://127.0.0.1:${PORT}"
fi
# GUI WKWebView child can get EPERM on smbfs getcwd. Probe node cwd; fall back local.
DESK_CWD="$DSH_HOME"
if [ -d "$WORK" ] && "$NODEBIN" -e 'process.chdir(process.argv[1]); process.stdout.write("ok")' "$WORK" >/dev/null 2>&1; then
  DESK_CWD="$WORK"
else
  echo "DESK_CWD_FALLBACK=$DSH_HOME"
fi
echo "DESK_CWD=$DESK_CWD"
LEASE_JS="$ROOT/desk-lease.js"
LEASE_SITE="https://{{TDH_HOST}}:8443"
PIN_ORG=""
[[ -f "$HOME/.dsh-company-rc8/work.org" ]] && PIN_ORG="$(tr -d '\r\n' < "$HOME/.dsh-company-rc8/work.org")"
if [ -f "$LEASE_JS" ]; then
  osascript -e 'display dialog "正在交接会话。" buttons {"OK"} giving up after 1 with title "TDHarness"' >/dev/null 2>&1 || true
  if ! "$NODEBIN" "$LEASE_JS" acquire --personal "$WORK" --org "$PIN_ORG" --home "$DSH_HOME" --site "$LEASE_SITE"; then
    boot_status fail
    printf '%s\n' "Error: 拿不到座位，或公司盘太慢。没有开桌。" > "$DSH_HOME/web-runtime.err"
    osascript -e 'display dialog "拿不到座位，或公司盘太慢。没有开桌。" buttons {"OK"} with title "TDHarness"' >/dev/null 2>&1 || true
    echo "BLOCKED=desk-lease" >&2
    exit 2
  fi
fi
# Leftover 17803 keeps the overlay from the last boot. After a wipe of
# local sessions that looks like "history gone". Always spawn fresh.
if lsof -nP -iTCP:$PORT -sTCP:LISTEN >/dev/null 2>&1; then
  for pid in $(lsof -nP -t -iTCP:$PORT -sTCP:LISTEN 2>/dev/null); do
    kill "$pid" 2>/dev/null || true
  done
  for i in $(seq 1 8); do
    lsof -nP -iTCP:$PORT -sTCP:LISTEN >/dev/null 2>&1 || break
    sleep 0.25
  done
fi
DESK_CWD="$DESK_CWD" DESK_OUT="$DSH_HOME/web-runtime.out" DESK_ERR="$DSH_HOME/web-runtime.err" \
  "$NODEBIN" "$ROOT/mac-desk-spawn.js" "$BIN" --profile web --patch "$OV" \
    --host 127.0.0.1 --port "$PORT" --no-open \
    --trusted-host 127.0.0.1 --trusted-host localhost
for i in $(seq 1 40); do
  lsof -nP -iTCP:$PORT -sTCP:LISTEN >/dev/null 2>&1 && break
  sleep 1
done
PIN_PERSONAL=""
PIN_ORG=""
[[ -f "$HOME/.dsh-company-rc8/work.personal" ]] && PIN_PERSONAL="$(tr -d '\r\n' < "$HOME/.dsh-company-rc8/work.personal")"
[[ -f "$HOME/.dsh-company-rc8/work.org" ]] && PIN_ORG="$(tr -d '\r\n' < "$HOME/.dsh-company-rc8/work.org")"
if [[ -n "$PIN_PERSONAL" && -f "$ROOT/mac-pin-workspaces.js" ]] \
  && lsof -nP -iTCP:$PORT -sTCP:LISTEN >/dev/null 2>&1; then
  PIN_PERSONAL="$PIN_PERSONAL" PIN_ORG="$PIN_ORG" PIN_PORT="$PORT" \
    "$NODEBIN" "$ROOT/mac-pin-workspaces.js" || true
fi
if [ -f "$LEASE_JS" ]; then
  nohup "$NODEBIN" "$LEASE_JS" watch --personal "$WORK" --org "$PIN_ORG" --home "$DSH_HOME" --site "$LEASE_SITE" \
    >>"$DSH_HOME/lease-watch.log" 2>&1 &
  echo $! > "$HOME/.dsh-company-rc8/lease-watch.pid"
fi
# Tree check is log-only. Do not pop on a dirty local tree (hot plant).
# Update already ran before the desk started.
if [ -f "$ROOT/tree-check.js" ] && [ -f "$ROOT/BUILD.json" ]; then
  TREE_OUT="$("$NODEBIN" "$ROOT/tree-check.js" --root "$ROOT" || true)"
  printf '%s\n' "$TREE_OUT"
fi
if lsof -nP -iTCP:$PORT -sTCP:LISTEN >/dev/null 2>&1; then
  boot_status ready
else
  boot_status fail
  echo "DESK_NOT_UP=1" >&2
  exit 2
fi
# Window is the WKWebView TDHarness binary, same class as Win WebView2. Do not open a browser.


# DSHWM1:a2ace91e2760ff6dc5a941e0dde9531c
