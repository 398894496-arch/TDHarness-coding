"""tree-restore.sh / tree-restore.ps1：先试增量更新（幂等，需在 patch_resume_download 之后打）。
version.json 里 <平台>.deltas[<本机 mark>] 有增量包时，只下载变化的文件（通常几 MB），
用 pack-verify.js --delta-from 核对签名里的 sha256，覆盖产品范围内的文件、删掉已移除的，
再跑 tree-check：TREE_OK=1 才算完成，否则退回下载整包。设 TREE_NO_DELTA=1 可跳过。
2026-10-09：一次只改了 14 个文件的更新，整包 395 MB，在中继链路上要下一个小时。"""
import sys
from pathlib import Path

MARK = "@@delta-update"

SH_ANCHOR = "  fetch_zip &\n"
SH_BLOCK = r'''  # Delta first: only the files that changed since this install. @@delta-update
  if [[ "${TREE_NO_DELTA:-}" != "1" && -f "$ROOT/pack-verify.js" && -f "$ROOT/pack-sign.pub" && -x "$ROOT/node/bin/node" && -f "$ROOT/tree-check.js" ]]; then
    PLAN="$("$ROOT/node/bin/node" "$ROOT/pack-verify.js" --root "$ROOT" --url "$ZIPURL" --platform mac --plan 2>/dev/null || true)"
    DFILE="$(printf '%s\n' "$PLAN" | awk -F= '/^DELTA_FILE=/{print $2; exit}')"
    DFROM="$(printf '%s\n' "$PLAN" | awk -F= '/^DELTA_FROM=/{print $2; exit}')"
    if [[ -n "$DFILE" && -n "$DFROM" ]]; then
      DURL="${ZIPURL%%\?*}"; DURL="${DURL%/*}/$DFILE"
      echo "TREE_DELTA=$DURL"
      DZIP="$(mktemp /tmp/dsh-delta.XXXXXX)"
      DBYTES="$(printf '%s\n' "$PLAN" | awk -F= '/^DELTA_BYTES=/{print $2; exit}')"
      progress download 0 "${DBYTES:-0}"
      if ( ZIP="$DZIP"; ZIPURL="$DURL"; fetch_zip ) \
        && "$ROOT/node/bin/node" "$ROOT/pack-verify.js" --root "$ROOT" --zip "$DZIP" --url "$ZIPURL" --platform mac --delta-from "$DFROM"; then
        DX="$(mktemp -d /tmp/dsh-delta-x.XXXXXX)"
        if unzip -q -o "$DZIP" -d "$DX"; then
          DSRC="$DX"; [[ -d "$DX/CompanyDesk" ]] && DSRC="$DX/CompanyDesk"
          if [[ -f "$DSRC/DELTA.json" ]]; then
            "$ROOT/node/bin/node" -e 'for (const r of (JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).removed || [])) console.log(r)' "$DSRC/DELTA.json" |
              while IFS= read -r r; do
                if [[ -n "$r" && "$r" != *..* ]] && is_product "$r"; then rm -f "$ROOT/$r"; fi
              done || true
            rm -f "$DSRC/DELTA.json"
          fi
          (cd "$DSRC" && find . \( -type f -o -type l \) -print0) | while IFS= read -r -d '' f; do
            rel="${f#./}"
            is_product "$rel" || continue
            mkdir -p "$(dirname "$ROOT/$rel")"
            # Copy beside, then rename: overwriting a running Mach-O in place gets it killed.
            cp -a "$DSRC/$rel" "$ROOT/$rel.delta-new" && mv -f "$ROOT/$rel.delta-new" "$ROOT/$rel"
          done || true
          TC="$("$ROOT/node/bin/node" "$ROOT/tree-check.js" --root "$ROOT" 2>/dev/null || true)"
          rm -rf "$DX" "$DZIP"
          if printf '%s\n' "$TC" | grep -q '^TREE_OK=1'; then
            echo "TREE_RESTORE_DELTA_OK=1"
            echo "TREE_RESTORE_OK=1"
            exit 0
          fi
          echo "TREE_DELTA_TREE_DIRTY=1"
        fi
      fi
      rm -f "$DZIP"
      echo "TREE_DELTA_FALLBACK=1"
    fi
  fi
'''

PS1_ANCHOR = "  Write-Output ('TREE_DOWNLOAD=' + $ZipUrl)\n"
PS1_BLOCK = r'''  # Delta first: only the files that changed since this install. @@delta-update
  try {
    $dVerify = Join-Path $Root 'pack-verify.js'
    $dNode = Join-Path $Root 'node\node.exe'
    $dTree = Join-Path $Root 'tree-check.js'
    if ($env:TREE_NO_DELTA -ne '1' -and (Test-Path -LiteralPath $dVerify) -and (Test-Path -LiteralPath (Join-Path $Root 'pack-sign.pub')) -and (Test-Path -LiteralPath $dNode) -and (Test-Path -LiteralPath $dTree)) {
      $dEap = $ErrorActionPreference
      $ErrorActionPreference = 'Continue'
      $dPlan = & $dNode $dVerify --root $Root --url $ZipUrl --platform win --plan 2>$null | Out-String
      $ErrorActionPreference = $dEap
      $dFile = ([regex]::Match($dPlan, '(?m)^DELTA_FILE=(\S+)')).Groups[1].Value
      $dFrom = ([regex]::Match($dPlan, '(?m)^DELTA_FROM=(\S+)')).Groups[1].Value
      if ($dFile -and $dFrom) {
        $dBase = $ZipUrl.Split('?')[0]
        $dUrl = $dBase.Substring(0, $dBase.LastIndexOf('/') + 1) + $dFile
        Write-Output ('TREE_DELTA=' + $dUrl)
        Write-Output ('TREE_PROGRESS=download 0 ' + ([regex]::Match($dPlan, '(?m)^DELTA_BYTES=(\d+)')).Groups[1].Value)
        $dZip = Join-Path $env:TEMP ('dsh-delta-' + [Guid]::NewGuid().ToString('N').Substring(0, 8) + '.zip')
        $dOk = $false
        for ($dTry = 0; $dTry -lt 10 -and -not $dOk; $dTry++) {
          try { (New-Object Net.WebClient).DownloadFile($dUrl, $dZip); $dOk = $true } catch { Start-Sleep -Seconds 3 }
        }
        if ($dOk) {
          $ErrorActionPreference = 'Continue'
          $dOut = & $dNode $dVerify --root $Root --zip $dZip --url $ZipUrl --platform win --delta-from $dFrom 2>&1 | Out-String
          $dRc = $LASTEXITCODE
          $ErrorActionPreference = $dEap
          Write-Output $dOut.Trim()
          $dOk = ($dRc -eq 0)
        }
        if ($dOk) {
          Add-Type -AssemblyName System.IO.Compression.FileSystem
          $dz = [IO.Compression.ZipFile]::OpenRead($dZip)
          try {
            $dMeta = $dz.Entries | Where-Object { $_.FullName -match '(^|/)DELTA\.json$' } | Select-Object -First 1
            if ($dMeta) {
              $dSr = New-Object IO.StreamReader($dMeta.Open())
              $dGone = @(($dSr.ReadToEnd() | ConvertFrom-Json).removed)
              $dSr.Dispose()
              foreach ($r in $dGone) {
                if ($r -and $r -notmatch '\.\.' -and (Test-ProductPath $r)) {
                  $rp = Join-Path $Root ($r.Replace('/', '\'))
                  if (Test-Path -LiteralPath $rp) { Remove-Item -LiteralPath $rp -Force -ErrorAction SilentlyContinue }
                }
              }
            }
            foreach ($e in $dz.Entries) {
              $name = $e.FullName.Replace('\', '/').TrimStart('/')
              if ($name.EndsWith('/')) { continue }
              $slash = $name.IndexOf('/')
              $rest = if ($slash -ge 0 -and $name.Substring(0, $slash) -eq 'CompanyDesk') { $name.Substring($slash + 1) } else { $name }
              if ($rest -eq 'DELTA.json' -or -not (Test-ProductPath $rest)) { continue }
              $op = Join-Path $Root ($rest.Replace('/', '\'))
              $od = Split-Path -Parent $op
              if ($od -and -not (Test-Path -LiteralPath $od)) { New-Item -ItemType Directory -Force -Path $od | Out-Null }
              try { [IO.Compression.ZipFileExtensions]::ExtractToFile($e, $op, $true) }
              catch {
                # Running exe/dll (the window itself, node.exe): a locked file can still be renamed.
                Move-Item -LiteralPath $op -Destination ($op + '.old-' + [DateTime]::UtcNow.Ticks) -Force
                [IO.Compression.ZipFileExtensions]::ExtractToFile($e, $op, $true)
              }
            }
          } finally { $dz.Dispose() }
          $ErrorActionPreference = 'Continue'
          $dTc = & $dNode $dTree --root $Root 2>&1 | Out-String
          $ErrorActionPreference = $dEap
          Remove-Item -LiteralPath $dZip -Force -ErrorAction SilentlyContinue
          if ($dTc -match '(?m)^TREE_OK=1') {
            Write-Output 'TREE_RESTORE_DELTA_OK=1'
            Clear-RestoreLock
            Write-Output 'TREE_RESTORE_OK=1'
            exit 0
          }
          Write-Output 'TREE_DELTA_TREE_DIRTY=1'
        }
        Remove-Item -LiteralPath $dZip -Force -ErrorAction SilentlyContinue
        Write-Output 'TREE_DELTA_FALLBACK=1'
      }
    }
  } catch {
    Write-Output ('TREE_DELTA_FALLBACK=' + $_.Exception.Message)
  }
'''

PS1_PRUNE_OLD = "  foreach ($scopeRel in @('plugins', 'home\\profiles\\web\\node_modules')) {\n"
PS1_PRUNE_NEW = "  foreach ($scopeRel in @('plugins', 'home\\profiles\\web\\node_modules', 'prefix\\lib\\node_modules\\@deepseek-ai', 'prefix\\node_modules\\@deepseek-ai')) {\n"


def patch(name, t):
    if MARK in t:
        return t, "already"
    if name == "tree-restore.sh":
        if t.count(SH_ANCHOR) != 1:
            raise SystemExit("anchor-delta-sh count=%d (needs patch_resume_download first)" % t.count(SH_ANCHOR))
        return t.replace(SH_ANCHOR, SH_BLOCK + SH_ANCHOR, 1), "patched"
    if name == "tree-restore.ps1":
        if t.count(PS1_ANCHOR) != 1:
            raise SystemExit("anchor-delta-ps1 count=%d" % t.count(PS1_ANCHOR))
        t = t.replace(PS1_ANCHOR, PS1_BLOCK + PS1_ANCHOR, 1)
        # Full restore also prunes what tree-check covers under prefix: a file a newer pack
        # dropped there used to stay behind and leave the tree dirty (TREE_OK=0) for good.
        if t.count(PS1_PRUNE_OLD) == 1:
            t = t.replace(PS1_PRUNE_OLD, PS1_PRUNE_NEW, 1)
        return t, "patched"
    return t, "skip"


def patch_bytes(name, data):
    bom = data[:3] == b"\xef\xbb\xbf"
    s = data.decode("utf-8-sig"); crlf = "\r\n" in s
    t, how = patch(name, s.replace("\r\n", "\n"))
    if how != "patched":
        return data, how
    if crlf: t = t.replace("\n", "\r\n")
    return (b"\xef\xbb\xbf" if bom else b"") + t.encode("utf-8"), how


if __name__ == "__main__":
    for a in sys.argv[1:]:
        p = Path(a); new, how = patch_bytes(p.name, p.read_bytes())
        if how == "patched": p.write_bytes(new)
        print(a, how)
