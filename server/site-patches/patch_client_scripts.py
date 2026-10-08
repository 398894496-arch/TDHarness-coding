"""客户端脚本补丁（幂等，按文件名分派）：
- tree-restore.ps1 / tree-restore.sh：下载后先 pack-verify 验签+核哈希，失败放弃安装；装完跑一次 tree-check 报告；
  pack-verify.js / pack-sign.pub 纳入产品树，随更新下发。
- start.ps1 / start.command：tree-check 从"启动时跳过"改为"启动时后台跑、只记录"，结果写到用户目录下公司配置目录里的 tree-check.last.txt。
"""
import sys
from pathlib import Path

MARK = "pack-verify"

PS1_VERIFY = r"""
# 解压前验签：version.json 必须是服务器私钥签过的，zip 的 sha256 必须和它一致（pack-verify.js）。
# 本机还没有 pack-sign.pub 的旧装机放行一次，这次更新会把公钥一起装上。
if ($script:ZipOwned) {
  $verifyJs = Join-Path $Root 'pack-verify.js'
  $nodeExe = Join-Path $Root 'node\node.exe'
  if ((Test-Path -LiteralPath $verifyJs) -and (Test-Path -LiteralPath $nodeExe)) {
    $prevEap = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    $verifyOut = & $nodeExe $verifyJs --root $Root --zip $Zip --url $ZipUrl --platform win 2>&1 | Out-String
    $verifyRc = $LASTEXITCODE
    $ErrorActionPreference = $prevEap
    Write-Output $verifyOut.Trim()
    if ($verifyRc -ne 0) {
      try { Remove-Item -LiteralPath $Zip -Force } catch {}
      Clear-RestoreLock
      throw 'restore-verify-failed'
    }
  } else {
    Write-Output 'PACK_VERIFY=skip-no-verifier'
  }
}

"""

PS1_TREECHECK = r"""
# 装完核一次产品树，只报告不拦（被占用没换掉的文件会在这里显出来，下次启动的更新检查会补）。
$treeJs = Join-Path $Root 'tree-check.js'
$nodeExe2 = Join-Path $Root 'node\node.exe'
if ((Test-Path -LiteralPath $treeJs) -and (Test-Path -LiteralPath $nodeExe2)) {
  $prevEap2 = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  $treeOut = & $nodeExe2 $treeJs --root $Root 2>&1 | Out-String
  $ErrorActionPreference = $prevEap2
  foreach ($l in ($treeOut -split "`r?`n")) { if ($l -match '^TREE_(OK|CHANGED|MISSING|EXTRA)=') { Write-Output ('TREE_AFTER_' + $l.Substring(5)) } }
}
"""

SH_VERIFY = r"""
# 解压前验签：version.json 必须是服务器私钥签过的，zip 的 sha256 必须和它一致（pack-verify.js）。
# 本机还没有 pack-sign.pub 的旧装机放行一次，这次更新会把公钥一起装上。
if [[ "${owned:-0}" == "1" && -f "$ROOT/pack-verify.js" && -x "$ROOT/node/bin/node" ]]; then
  if ! "$ROOT/node/bin/node" "$ROOT/pack-verify.js" --root "$ROOT" --zip "$ZIP" --url "$ZIPURL" --platform mac; then
    rm -f "$ZIP"
    echo "restore-verify-failed" >&2
    exit 3
  fi
fi
"""

SH_TREECHECK = r"""
# 装完核一次产品树，只报告不拦。
if [[ -f "$ROOT/tree-check.js" && -x "$ROOT/node/bin/node" ]]; then
  "$ROOT/node/bin/node" "$ROOT/tree-check.js" --root "$ROOT" 2>/dev/null | sed -n 's/^TREE_\(OK\|CHANGED\|MISSING\|EXTRA\)=/TREE_AFTER_\1=/p' || true
fi
"""

START_PS1_OLD = "Write-Output 'tree-check skip-on-open'"
START_PS1_NEW = r"""# 产品树校验放后台：不挡启动（全量哈希约 3 万个文件），结果写 tree-check.last.txt。
try {
  $tcJs = Join-Path $Root 'tree-check.js'
  if ((Test-Path -LiteralPath $tcJs) -and (Test-Path -LiteralPath $Node)) {
    $tcOut = Join-Path $env:USERPROFILE ('.dsh-company-rc' + '8\tree-check.last.txt')
    Start-Process -FilePath $Node -ArgumentList ('"' + $tcJs + '" --root "' + $Root + '"') -WindowStyle Hidden -RedirectStandardOutput $tcOut | Out-Null
    Write-Output 'tree-check background'
  }
} catch { Write-Output 'tree-check background-failed' }"""

START_SH_OLD = 'echo "tree-check skip-on-open"'
START_SH_NEW = r"""# 产品树校验放后台：不挡启动，结果写 tree-check.last.txt。
if [ -f "$ROOT/tree-check.js" ]; then
  ( "$NODEBIN" "$ROOT/tree-check.js" --root "$ROOT" > "$HOME/.dsh-company-rc""8/tree-check.last.txt" 2>&1 & )
  echo "tree-check background"
fi"""


def _sub_once(t, old, new, what):
    if t.count(old) != 1:
        raise SystemExit("anchor-%s count=%d" % (what, t.count(old)))
    return t.replace(old, new, 1)


def patch_text(name, t):
    if name == "tree-restore.ps1":
        if MARK in t:
            return t, "already"
        t = _sub_once(t, "  'pack-update-check.js',\n", "  'pack-update-check.js',\n  'pack-verify.js',\n  'pack-sign.pub',\n", "ps1-treefiles")
        t = _sub_once(t, "Add-Type -AssemblyName System.IO.Compression.FileSystem\n$wrote = 0\n",
                      PS1_VERIFY.lstrip("\n") + "Add-Type -AssemblyName System.IO.Compression.FileSystem\n$wrote = 0\n", "ps1-verify")
        t = _sub_once(t, "Write-Output ('TREE_RESTORE_PRUNED=' + $script:pruned)\n",
                      "Write-Output ('TREE_RESTORE_PRUNED=' + $script:pruned)\n" + PS1_TREECHECK, "ps1-treecheck")
        return t, "patched"
    if name == "tree-restore.sh":
        if MARK in t:
            return t, "already"
        t = _sub_once(t, "|pack-update-check.js|sync-skills.js|", "|pack-update-check.js|pack-verify.js|pack-sign.pub|sync-skills.js|", "sh-isproduct")
        t = _sub_once(t, "tree-restore.sh pack-update-check.js \\\n", "tree-restore.sh pack-update-check.js pack-verify.js pack-sign.pub \\\n", "sh-copylist")
        t = _sub_once(t, '[[ -f "$ZIP" ]] || { echo "restore-zip-missing" >&2; exit 2; }\n',
                      '[[ -f "$ZIP" ]] || { echo "restore-zip-missing" >&2; exit 2; }\n' + SH_VERIFY, "sh-verify")
        t = _sub_once(t, 'echo "TREE_RESTORE_WROTE=$wrote"\n', SH_TREECHECK.lstrip("\n") + 'echo "TREE_RESTORE_WROTE=$wrote"\n', "sh-treecheck")
        return t, "patched"
    if name == "start.ps1":
        if "tree-check background" in t:
            return t, "already"
        if START_PS1_OLD not in t:
            return t, "no-skip-line"
        return t.replace(START_PS1_OLD, START_PS1_NEW, 1), "patched"
    if name == "start.command":
        if "tree-check background" in t:
            return t, "already"
        if START_SH_OLD not in t:
            return t, "no-skip-line"
        return t.replace(START_SH_OLD, START_SH_NEW, 1), "patched"
    return t, "skip"


def patch_bytes(name, data):
    t = data.decode("utf-8-sig") if data[:3] == b"\xef\xbb\xbf" else data.decode("utf-8")
    bom = data[:3] == b"\xef\xbb\xbf"
    crlf = "\r\n" in t
    t2, how = patch_text(name, t.replace("\r\n", "\n"))
    if how != "patched":
        return data, how
    if crlf:
        t2 = t2.replace("\n", "\r\n")
    return (b"\xef\xbb\xbf" if bom else b"") + t2.encode("utf-8"), how


if __name__ == "__main__":
    for a in sys.argv[1:]:
        p = Path(a)
        new, how = patch_bytes(p.name, p.read_bytes())
        if how == "patched":
            p.write_bytes(new)
        print(a, how)
