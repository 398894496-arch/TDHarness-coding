#!/usr/bin/env bash
# Mac client boot smoke: build a site pack from client/CompanyDesk-mac.zip the way setup does
# (address, desk source, site patches, seal), unpack it, run its sync-desk-home.sh under an empty
# HOME and its own tree check. That step runs before the login
# prompt; if it exits non-zero the window stays on "正在打开本机 Agent..." forever (2026-10-09:
# every Mac pack did, because it required ego-browser's deps after ego-browser stopped shipping).
# Needs the LFS packages (`git lfs pull`), node, python3 and unzip. Prints CLIENT_BOOT_OK=1.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ZIP="$ROOT/client/CompanyDesk-mac.zip"
size=$(wc -c < "$ZIP" | tr -d ' ')
if (( size < 20000000 )); then echo "CLIENT_BOOT_SKIP=lfs-pointer (run git lfs pull)"; exit 0; fi
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
printf 'host: boot-check.local\nshare: dsh-company\nlogin_port: 8443\ngateway_port: 8450\ncompany_path: D:/dsh/company\n' > "$T/site.yml"
node "$ROOT/server/pack-sign.js" keygen --dir "$T/sign" >/dev/null
python3 "$ROOT/server/site-cs.py" --site "$T/site.yml" rewrite-zip --src "$ZIP" --out "$T/mac.zip" >/dev/null
# The desk source from this repository (desk/plugins, desk/pack), as setup and publish put it in.
python3 "$ROOT/server/site-cs.py" --site "$T/site.yml" overlay-zip --src "$T/mac.zip" --plugins "$ROOT/desk/plugins" >/dev/null
python3 "$ROOT/server/site-patches/apply_site_patches.py" --zip "$T/mac.zip" --patches "$ROOT/server/site-patches" --pub "$T/sign/pack-sign.pub" >/dev/null
python3 "$ROOT/server/site-cs.py" --site "$T/site.yml" reseal-zip --src "$T/mac.zip" >/dev/null
# unzip keeps the exec bits and symlinks (node/bin/node, npm links); Python's extractall does not.
mkdir -p "$T/x" && unzip -q "$T/mac.zip" -d "$T/x"
mkdir -p "$T/home"
if ! HOME="$T/home" bash "$T/x/CompanyDesk/sync-desk-home.sh" --root "$T/x/CompanyDesk" > "$T/out.txt" 2>&1; then
  cat "$T/out.txt"; echo "CLIENT_BOOT_FAIL=sync-desk-home"; exit 1
fi
grep -q '^DESK_HOME_SYNC=1' "$T/out.txt" || { cat "$T/out.txt"; echo "CLIENT_BOOT_FAIL=no-sync-line"; exit 1; }
# The desk checks its own files against the seal on every launch.
"$T/x/CompanyDesk/node/bin/node" "$T/x/CompanyDesk/tree-check.js" --root "$T/x/CompanyDesk" > "$T/tree.txt" 2>&1 || true
grep -q '^TREE_OK=1' "$T/tree.txt" || { cat "$T/tree.txt"; echo "CLIENT_BOOT_FAIL=tree-check"; exit 1; }
echo "CLIENT_BOOT_OK=1"
