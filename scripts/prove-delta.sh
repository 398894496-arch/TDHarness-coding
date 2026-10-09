#!/usr/bin/env bash
# Delta update proof (Mac side of tree-restore): the update scripts come out of the patched
# client/CompanyDesk-mac.zip, the product tree is a small synthetic one so this runs in seconds.
# v1 -> v2 changes a file, adds one and drops one. A local http server plays the site.
#   A  delta for this mark            -> delta applied, TREE_OK=1, no full download
#   B  delta zip altered after signing -> PACK_VERIFY_FAIL, full pack, TREE_OK=1
#   C  local product file edited       -> delta applied, tree dirty, full pack, TREE_OK=1
#   D  no delta for this mark          -> full pack, TREE_OK=1
# Windows was checked the same way on PowerShell 5.1 (2026-10-09), including a running TDHarness.exe.
# Needs the LFS packages (`git lfs pull`), node, python3, zip and unzip. Prints DELTA_PROOF_OK=1.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ZIP="$ROOT/client/CompanyDesk-mac.zip"
size=$(wc -c < "$ZIP" | tr -d ' ')
if (( size < 20000000 )); then echo "DELTA_PROOF_SKIP=lfs-pointer (run git lfs pull)"; exit 0; fi
T="$(mktemp -d)"
HP=""
trap '[[ -n "$HP" ]] && kill "$HP" 2>/dev/null; rm -rf "$T"' EXIT
PORT=$((20000 + RANDOM % 20000))
URL="http://127.0.0.1:$PORT/CompanyDesk-mac.zip?v=1"
printf 'host: delta-check.local\nshare: dsh-company\nlogin_port: 8443\ngateway_port: 8450\ncompany_path: D:/dsh/company\n' > "$T/site.yml"
node "$ROOT/server/pack-sign.js" keygen --dir "$T/sign" >/dev/null
python3 "$ROOT/server/site-cs.py" --site "$T/site.yml" rewrite-zip --src "$ZIP" --out "$T/mac.zip" >/dev/null
python3 "$ROOT/server/site-patches/apply_site_patches.py" --zip "$T/mac.zip" --patches "$ROOT/server/site-patches" --pub "$T/sign/pack-sign.pub" >/dev/null
mkdir -p "$T/x"
unzip -q "$T/mac.zip" 'CompanyDesk/tree-restore.sh' 'CompanyDesk/tree-check.js' 'CompanyDesk/pack-update-check.js' \
  'CompanyDesk/pack-verify.js' 'CompanyDesk/pack-sign.pub' -d "$T/x"
grep -q '@@delta-update' "$T/x/CompanyDesk/tree-restore.sh" || { echo "DELTA_PROOF_FAIL=not-patched"; exit 1; }

DS="prefix/lib/node_modules/@deepseek-ai/x"
tree() { # dir mark a-content with-b with-c
  local b="$T/$1/CompanyDesk"
  mkdir -p "$b/$DS" "$b/node/bin"
  cp "$T/x/CompanyDesk/"* "$b/"
  ln -s "$(command -v node)" "$b/node/bin/node"
  echo "$3" > "$b/$DS/a.txt"
  [[ "$4" == 1 ]] && echo b1 > "$b/$DS/b.txt"
  [[ "$5" == 1 ]] && echo c2 > "$b/$DS/c.txt"
  printf '{"mark":"%s"}\n' "$2" > "$b/BUILD.json"
}
pack() { (cd "$T/$1" && zip -qry "$T/dist/CompanyDesk-mac.zip" CompanyDesk); python3 "$ROOT/server/site-cs.py" --site "$T/site.yml" reseal-zip --src "$T/dist/CompanyDesk-mac.zip" >/dev/null; }
mkdir -p "$T/dist"
tree v1 aaaa1111 a1 1 0
tree v2 bbbb2222 a2-new 0 1
pack v1
echo '{"mac":{"file":"CompanyDesk-mac.zip"}}' > "$T/dist/version.json"
python3 "$ROOT/server/pack-delta.py" remember --dist "$T/dist" --history "$T/history" >/dev/null
mkdir -p "$T/inst" && unzip -q "$T/dist/CompanyDesk-mac.zip" -d "$T/inst"
rm -f "$T/dist/CompanyDesk-mac.zip"
pack v2
python3 "$ROOT/server/pack-delta.py" build --dist "$T/dist" --history "$T/history" | grep -q '^DELTA mac aaaa1111->bbbb2222' || { echo "DELTA_PROOF_FAIL=no-delta-built"; exit 1; }
node "$ROOT/server/pack-sign.js" sign --dist "$T/dist" --dir "$T/sign" | grep -q '^PACK_SIGN_OK=1'
python3 -m http.server "$PORT" --bind 127.0.0.1 -d "$T/dist" >/dev/null 2>&1 & HP=$!; disown "$HP" 2>/dev/null || true
for _ in $(seq 1 50); do curl -fs "http://127.0.0.1:$PORT/version.json" >/dev/null 2>&1 && break; sleep 0.1; done

R="$T/root"
fresh() { rm -rf "$R"; cp -a "$T/inst/CompanyDesk" "$R"; }
restore() { HOME="$T/home" bash "$R/tree-restore.sh" --root "$R" --url "$URL" > "$T/out.txt" 2>&1 || { cat "$T/out.txt"; echo "DELTA_PROOF_FAIL=$1-restore"; exit 1; }; }
expect() { # case want-line [unwanted-line]
  grep -q "^$2" "$T/out.txt" || { cat "$T/out.txt"; echo "DELTA_PROOF_FAIL=$1-missing-$2"; exit 1; }
  if [[ -n "${3:-}" ]] && grep -q "^$3" "$T/out.txt"; then cat "$T/out.txt"; echo "DELTA_PROOF_FAIL=$1-unexpected-$3"; exit 1; fi
  node "$R/tree-check.js" --root "$R" > "$T/tc.txt" || true; grep -q "^TREE_OK=1" "$T/tc.txt" || { cat "$T/out.txt" "$T/tc.txt"; echo "DELTA_PROOF_FAIL=$1-tree"; exit 1; }
  [[ "$(cat "$R/$DS/a.txt")" == a2-new && -f "$R/$DS/c.txt" && ! -e "$R/$DS/b.txt" ]] || { echo "DELTA_PROOF_FAIL=$1-content"; exit 1; }
  echo "DELTA_PROOF_$1=ok"
}
fresh; node "$R/tree-check.js" --root "$R" | grep -q '^TREE_OK=1' || { echo "DELTA_PROOF_FAIL=v1-tree"; exit 1; }
restore A; expect A TREE_RESTORE_DELTA_OK=1 PACK_VERIFY_SHA256=
D="$(ls "$T/dist/delta/"*.zip)"; cp "$D" "$T/delta.good"; echo junk >> "$D"
fresh; restore B; expect B PACK_VERIFY_FAIL=delta-sha256-mismatch TREE_RESTORE_DELTA_OK=1
cp "$T/delta.good" "$D"
fresh; echo '// edited' >> "$R/pack-update-check.js"; restore C; expect C TREE_DELTA_TREE_DIRTY=1 TREE_RESTORE_DELTA_OK=1
fresh; python3 -c 'import json,sys; p=sys.argv[1]; d=json.load(open(p)); d["mark"]="zzzz"; json.dump(d, open(p, "w"))' "$R/BUILD.json"
restore D; expect D PACK_VERIFY_SHA256= TREE_DELTA=
echo "DELTA_PROOF_OK=1"
