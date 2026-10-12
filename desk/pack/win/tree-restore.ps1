# Overlay the product tree from a client zip. Leaves sessions and login alone.
# Keep @@TREE_SCOPE in sync with tree-restore.sh and pack-update-check.js PARTS.
# tree-check.js checks a narrower set on purpose (restore overlays a wider one).
# Prints TREE_PROGRESS=<phase> <done> <total> lines as it goes; the window
# shows them so a 400 MB update does not look like a hang.
param(
  [Parameter(Mandatory = $true)][string]$Root,
  [string]$Zip,
  [string]$ZipUrl = 'https://{{TDH_HOST}}:8443/client/CompanyDesk-win.zip?v=login1'
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new()

# @@TREE_SCOPE
$TreePrefixes = @(
  'prefix/',
  'node/',
  'plugins/',
  'home/profiles/web/node_modules/',
  'presets/',
  'skills/',
  'opencli/',
  'windows-mcp/',
  'ffmpeg/'
)
$TreeFiles = @(
  'TDHarness.exe',
  'TDHarness',
  'start.ps1',
  'start.command',
  'CompanyDesk.vbs',
  'WebView2Loader.dll',
  'tree-check.js',
  'tree-restore.ps1',
  'tree-restore.sh',
  'pack-update-check.js',
  'sync-skills.js',
  'sync-desk-home.sh',
  'sync-desk-home.ps1',
  'prove-cosmokit.js',
  'desk-lease.js',
  'mac-mount-company.sh',
  'BUILD.json',
  'home/profiles/web/package.json',
  'home/profiles/web/overlay.yml'
)

function Test-ProductPath([string]$Rel) {
  $n = $Rel.Replace('\', '/')
  foreach ($p in $TreePrefixes) {
    if ($n -eq $p.TrimEnd('/') -or $n.StartsWith($p)) { return $true }
  }
  return $TreeFiles -contains $n
}

function Progress([string]$Phase, [long]$Done, [long]$Total) {
  [Console]::Out.WriteLine('TREE_PROGRESS=' + $Phase + ' ' + $Done + ' ' + $Total)
  [Console]::Out.Flush()
}

if (-not (Test-Path -LiteralPath $Root)) { throw 'restore-root-missing' }

$lockDir = Join-Path $env:USERPROFILE '.dsh-company-rc8\tree-restore.lock'
$lockParent = Split-Path -Parent $lockDir
if (-not (Test-Path -LiteralPath $lockParent)) {
  New-Item -ItemType Directory -Force -Path $lockParent | Out-Null
}
if (Test-Path -LiteralPath $lockDir) {
  $old = $null
  try { $old = Get-Content -LiteralPath (Join-Path $lockDir 'pid') -ErrorAction SilentlyContinue } catch {}
  $alive = $false
  if ($old) {
    try { $alive = [bool](Get-Process -Id ([int]$old) -ErrorAction SilentlyContinue) } catch { $alive = $false }
  }
  if ($alive) { throw 'restore-busy' }
  Remove-Item -LiteralPath $lockDir -Recurse -Force -ErrorAction SilentlyContinue
}
New-Item -ItemType Directory -Force -Path $lockDir | Out-Null
Set-Content -LiteralPath (Join-Path $lockDir 'pid') -Value $PID -Encoding ASCII
function Clear-RestoreLock {
  try { Remove-Item -LiteralPath $lockDir -Recurse -Force -ErrorAction SilentlyContinue } catch {}
}

if (-not $Zip) {
  if ($ZipUrl -match '__SITE_') {
    Write-Output 'TREE_DOWNLOAD_UNRENDERED=1'
    throw 'restore-url-unrendered'
  }
  $Zip = Join-Path $env:TEMP ('dsh-tree-' + [Guid]::NewGuid().ToString('N').Substring(0, 8) + '.zip')
  $script:ZipOwned = $true
  [Net.ServicePointManager]::ServerCertificateValidationCallback = { $true }
  try { [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor 3072 } catch {}
  Write-Output ('TREE_DOWNLOAD=' + $ZipUrl)
  $req = [Net.HttpWebRequest]::Create($ZipUrl)
  $req.Method = 'GET'
  $req.Timeout = 600000
  $req.ReadWriteTimeout = 600000
  $resp = $req.GetResponse()
  try {
    $src = $resp.GetResponseStream()
    $dst = [IO.File]::Create($Zip)
    try {
      $buf = New-Object byte[] (256 * 1024)
      $total = [long]$resp.ContentLength
      $done = [long]0
      $tick = [Diagnostics.Stopwatch]::StartNew()
      Progress 'download' 0 $total
      while (($n = $src.Read($buf, 0, $buf.Length)) -gt 0) {
        $dst.Write($buf, 0, $n)
        $done += $n
        if ($tick.ElapsedMilliseconds -ge 500) { Progress 'download' $done $total; $tick.Restart() }
      }
      Progress 'download' $done $total
    } finally { $dst.Close() }
  } finally { $resp.Close() }
  if ((Get-Item -LiteralPath $Zip).Length -lt 1MB) { throw 'restore-zip-too-small' }
} else {
  $script:ZipOwned = $false
  if (-not (Test-Path -LiteralPath $Zip)) { throw 'restore-zip-missing' }
}

Add-Type -AssemblyName System.IO.Compression.FileSystem
$wrote = 0
$skipped = 0
$busy = 0
try {
  $z = [IO.Compression.ZipFile]::OpenRead($Zip)
  try {
    $entryTotal = $z.Entries.Count
    $entryDone = 0
    $tick2 = [Diagnostics.Stopwatch]::StartNew()
    Progress 'install' 0 $entryTotal
    foreach ($e in $z.Entries) {
    $entryDone++
    if ($tick2.ElapsedMilliseconds -ge 500) { Progress 'install' $entryDone $entryTotal; $tick2.Restart() }
    $name = $e.FullName.Replace('\', '/').TrimStart('/')
    if ($name.EndsWith('/')) { continue }
    $slash = $name.IndexOf('/')
    $rest = if ($slash -ge 0 -and $name.Substring(0, $slash) -eq 'CompanyDesk') { $name.Substring($slash + 1) } else { $name }
    if (-not $rest) { continue }
    if (-not (Test-ProductPath $rest)) { $skipped++; continue }
    $outPath = Join-Path $Root ($rest.Replace('/', '\'))
    $dir = Split-Path -Parent $outPath
    if ($dir -and -not (Test-Path -LiteralPath $dir)) {
      New-Item -ItemType Directory -Force -Path $dir | Out-Null
    }
    try {
      [IO.Compression.ZipFileExtensions]::ExtractToFile($e, $outPath, $true)
      $wrote++
    } catch {
      if ($rest -eq 'TDHarness.exe') {
        # The window itself is TDHarness.exe and still running. A running exe
        # can be renamed though: move it aside and put the new one in place.
        $aside = $outPath + '.old-' + [DateTime]::UtcNow.Ticks
        $swapped = $false
        try {
          Move-Item -LiteralPath $outPath -Destination $aside -Force
          [IO.Compression.ZipFileExtensions]::ExtractToFile($e, $outPath, $true)
          $wrote++
          $swapped = $true
          Write-Output 'TREE_RESTORE_EXE_SWAPPED=1'
        } catch {
          if (-not (Test-Path -LiteralPath $outPath) -and (Test-Path -LiteralPath $aside)) {
            try { Move-Item -LiteralPath $aside -Destination $outPath -Force } catch {}
          }
        }
        if ($swapped) { continue }
        $alt = Join-Path $Root 'TDHarness.exe.new'
        try {
          [IO.Compression.ZipFileExtensions]::ExtractToFile($e, $alt, $true)
          $wrote++
          Write-Output 'TREE_RESTORE_EXE_STAGED=1'
        } catch {
          $busy++
          Write-Output 'TREE_RESTORE_EXE_BUSY=1'
        }
      } else { Write-Output ('TREE_RESTORE_SKIP=' + $rest) }
    }
  }
  } finally { $z.Dispose() }
  Progress 'install' $entryTotal $entryTotal
} catch {
  Write-Output ('TREE_RESTORE_ZIP_ERR=' + $_.Exception.Message)
}

if ($wrote -lt 1) {
  Write-Output 'TREE_RESTORE_TAR_FALLBACK=1'
  $staging = Join-Path $env:TEMP ('dsh-tree-tar-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
  New-Item -ItemType Directory -Force -Path $staging | Out-Null
  $ErrorActionPreference = 'Continue'
  & tar.exe -xf $Zip -C $staging
  $tarRc = $LASTEXITCODE
  $ErrorActionPreference = 'Stop'
  if ($tarRc -ne 0) { Clear-RestoreLock; throw 'restore-tar-failed' }
  $src = Join-Path $staging 'CompanyDesk'
  if (-not (Test-Path -LiteralPath $src)) { $src = $staging }
  Get-ChildItem -LiteralPath $src -Recurse -Force -File | ForEach-Object {
    $rel = $_.FullName.Substring($src.Length).TrimStart('\', '/').Replace('\', '/')
    if (-not $rel) { return }
    if (-not (Test-ProductPath $rel)) { $skipped++; return }
    $outPath = Join-Path $Root ($rel.Replace('/', '\'))
    $dir = Split-Path -Parent $outPath
    if ($dir -and -not (Test-Path -LiteralPath $dir)) {
      New-Item -ItemType Directory -Force -Path $dir | Out-Null
    }
    Copy-Item -LiteralPath $_.FullName -Destination $outPath -Force
    $wrote++
  }
  try { Remove-Item -LiteralPath $staging -Recurse -Force } catch {}
}

# New zip is thinner: leftover plugins / node_modules fail TREE_EXTRA.
$keep = @{}
try {
  $z2 = [IO.Compression.ZipFile]::OpenRead($Zip)
  try {
    foreach ($e in $z2.Entries) {
      $name = $e.FullName.Replace('\', '/').TrimStart('/')
      if ($name.EndsWith('/')) { continue }
      $slash = $name.IndexOf('/')
      $rest = if ($slash -ge 0 -and $name.Substring(0, $slash) -eq 'CompanyDesk') { $name.Substring($slash + 1) } else { $name }
      if ($rest -and (Test-ProductPath $rest)) { $keep[$rest] = 1 }
    }
  } finally { $z2.Dispose() }
} catch {
  Write-Output ('TREE_RESTORE_KEEP_ERR=' + $_.Exception.Message)
}
function Unlink-Extra([string]$Full) {
  $item = Get-Item -LiteralPath $Full -Force -ErrorAction SilentlyContinue
  if (-not $item) { return }
  if ([bool]($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
    if ($item.PSIsContainer) { cmd /c rmdir "$Full" | Out-Null }
    else { cmd /c del /f /q "$Full" | Out-Null }
    return
  }
  Remove-Item -LiteralPath $Full -Force -ErrorAction SilentlyContinue
}
function Walk-Prune([string]$Dir, [string]$RelBase) {
  Get-ChildItem -LiteralPath $Dir -Force -ErrorAction SilentlyContinue | ForEach-Object {
    $rel = if ($RelBase) { $RelBase + '/' + $_.Name } else { $_.Name }
    $rel = $rel.Replace('\', '/')
    $isLink = [bool]($_.Attributes -band [IO.FileAttributes]::ReparsePoint)
    if ($isLink -or -not $_.PSIsContainer) {
      if (-not $keep.ContainsKey($rel)) {
        Unlink-Extra $_.FullName
        $script:pruned++
      }
    }
    if ($_.PSIsContainer -and -not $isLink) { Walk-Prune $_.FullName $rel }
  }
}
$script:pruned = 0
if ($keep.Count -lt 1) {
  Write-Output 'TREE_RESTORE_PRUNE_SKIP=1'
} else {
  foreach ($scopeRel in @('plugins', 'home\profiles\web\node_modules')) {
    $scope = Join-Path $Root $scopeRel
    if (Test-Path -LiteralPath $scope) { Walk-Prune $scope ($scopeRel.Replace('\', '/')) }
  }
}
Write-Output ('TREE_RESTORE_PRUNED=' + $script:pruned)

if ($script:ZipOwned) { try { Remove-Item -LiteralPath $Zip -Force } catch {} }

Write-Output ('TREE_RESTORE_WROTE=' + $wrote)
Write-Output ('TREE_RESTORE_SKIPPED=' + $skipped)
Write-Output ('TREE_RESTORE_BUSY=' + $busy)
if ($wrote -lt 1) { Clear-RestoreLock; throw 'restore-wrote-nothing' }
Clear-RestoreLock
Write-Output 'TREE_RESTORE_OK=1'
