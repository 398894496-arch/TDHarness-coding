# Plant the Mac 0.1.7 plugin fixes onto this desk. Does not wipe the server.
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
foreach ($k in @('HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy')) {
  Remove-Item ('Env:' + $k) -ErrorAction SilentlyContinue
}

$drop = 'C:\Users\tdhssh\src\tdh-plugin-017'
$need = @(
  'dsh-artifact\lib\client.js',
  'dsh-better-sidebar\lib\client.js',
  'company-shell\lib\client.js',
  'company-shell\lib\index.js',
  'company-shell\lib\kernel-watch.js'
)
foreach ($rel in $need) {
  if (-not (Test-Path -LiteralPath (Join-Path $drop $rel))) { throw ('drop-missing=' + $rel) }
}

Get-Process -Name 'TDHarness','CompanyDesk' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
  Where-Object {
    $_.Name -match '^(node|node-real)\.exe$' -and (
      ($_.ExecutablePath -and ($_.ExecutablePath -like '*\TDH\*')) -or
      ($_.CommandLine -and ($_.CommandLine -like '*\TDH\*'))
    )
  } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Start-Sleep -Seconds 2
Write-Output 'TDH_STOPPED=1'

$planted = Get-Item -Path 'C:\Users\*\TDH\CompanyDesk\TDHarness.exe' -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $planted) { throw 'planted-exe-missing' }
$desk = $planted.Directory.FullName
$rc = Join-Path $planted.Directory.Parent.Parent.FullName ('.dsh-company-rc' + '8')
$bases = @($desk, (Join-Path $desk 'home'), (Join-Path $rc 'desk-home'))

function Copy-PluginFile([string]$name, [string]$file) {
  $src = Join-Path $drop ($name + '\lib\' + $file)
  $n = 0
  foreach ($base in $bases) {
    foreach ($dir in @(
      (Join-Path $base ('plugins\' + $name + '\lib')),
      (Join-Path $base ('profiles\web\node_modules\' + $name + '\lib'))
    )) {
      if (-not (Test-Path -LiteralPath $dir)) { continue }
      Copy-Item -Force -LiteralPath $src -Destination (Join-Path $dir $file)
      $n += 1
    }
  }
  return $n
}

$artN = Copy-PluginFile 'dsh-artifact' 'client.js'
$sideN = Copy-PluginFile 'dsh-better-sidebar' 'client.js'
$shellC = Copy-PluginFile 'company-shell' 'client.js'
$shellI = Copy-PluginFile 'company-shell' 'index.js'
$shellK = Copy-PluginFile 'company-shell' 'kernel-watch.js'
Write-Output ('COPY_ARTIFACT=' + $artN)
Write-Output ('COPY_SIDEBAR=' + $sideN)
Write-Output ('COPY_SHELL=' + $shellC + ',' + $shellI + ',' + $shellK)
if ($artN -lt 2) { throw 'artifact-dest-missing' }
if ($sideN -lt 1) { throw 'sidebar-dest-missing' }
if ($shellC -lt 2) { throw 'shell-dest-missing' }

function Assert-Needle([string]$name, [string]$file, [string]$needle, [string]$tag) {
  $ok = 0
  foreach ($base in $bases) {
    foreach ($dir in @(
      (Join-Path $base ('plugins\' + $name + '\lib')),
      (Join-Path $base ('profiles\web\node_modules\' + $name + '\lib'))
    )) {
      $p = Join-Path $dir $file
      if (-not (Test-Path -LiteralPath $p)) { continue }
      $t = [IO.File]::ReadAllText($p)
      if ($t.IndexOf($needle) -lt 0) { throw ('needle-missing=' + $tag + '=' + $p) }
      $ok += 1
    }
  }
  Write-Output ($tag + '=' + $ok)
}

Assert-Needle 'dsh-artifact' 'client.js' 'create: () => schema' 'ARTIFACT_CREATE'
Assert-Needle 'dsh-better-sidebar' 'client.js' 'retainedBy.mainView' 'SIDEBAR_017'
Assert-Needle 'company-shell' 'client.js' 'ICON_ALIAS' 'SHELL_ICON'
Assert-Needle 'company-shell' 'client.js' 'KernelWatchSection' 'SHELL_017'

function Find-Under([string]$root, [string]$tail) {
  $out = @()
  foreach ($pre in @('', 'lib\', 'prefix\', 'prefix\lib\')) {
    $p = Join-Path $root ($pre + $tail)
    if (Test-Path -LiteralPath $p) { $out += $p }
  }
  return $out
}

$settingsTail = 'node_modules\@deepseek-ai\dsh\node_modules\@deepseek-ai\dsh-settings\lib\index.js'
$subTail = 'node_modules\@deepseek-ai\dsh\node_modules\@deepseek-ai\dsh-tool-subagent\lib\index.js'
$settingsSrc = Join-Path $drop 'kernel\dsh-settings-index.js'
$subSrc = Join-Path $drop 'kernel\dsh-tool-subagent-index.js'
$ns = 0
$sub = 0
foreach ($root in @('D:\dsh\runtime\dsh-0-1-7-rc-2', $desk)) {
  foreach ($p in (Find-Under $root $settingsTail)) {
    $t = [IO.File]::ReadAllText($p)
    if ($t.IndexOf('function settingsNamespace') -lt 0) {
      Copy-Item -Force -LiteralPath $settingsSrc -Destination $p
      $t = [IO.File]::ReadAllText($p)
    }
    if ($t.IndexOf('function settingsNamespace') -lt 0) { throw ('settings-namespace-missing=' + $p) }
    $ns += 1
  }
  foreach ($p in (Find-Under $root $subTail)) {
    $t = [IO.File]::ReadAllText($p)
    if ($t.IndexOf('company-subagent-tool-once-v1') -lt 0) {
      Copy-Item -Force -LiteralPath $subSrc -Destination $p
      $t = [IO.File]::ReadAllText($p)
    }
    if ($t.IndexOf('company-subagent-tool-once-v1') -lt 0) { throw ('subagent-once-missing=' + $p) }
    $sub += 1
  }
}
Write-Output ('SETTINGS_NS=' + $ns)
Write-Output ('SUBAGENT_ONCE=' + $sub)
if ($ns -lt 1) { throw 'settings-file-missing' }
if ($sub -lt 1) { throw 'subagent-file-missing' }

$py = $null
foreach ($n in @('python', 'python3')) {
  $c = Get-Command $n -ErrorAction SilentlyContinue
  if ($c -and $c.Source -and ($c.Source -notmatch 'WindowsApps')) { $py = $c.Source; break }
}
if (-not $py) { throw 'python-missing' }
$zip = 'D:\dsh\client-dist\CompanyDesk-win.zip'
$zipPy = Join-Path $env:TEMP 'tdh-zip-artifact-017.py'
[IO.File]::WriteAllText($zipPy, @'
import sys, zipfile
from pathlib import Path
src = Path(sys.argv[1])
drop = Path(sys.argv[2])
pairs = [
    ("dsh-artifact/lib/client.js", drop / "dsh-artifact/lib/client.js"),
    ("dsh-better-sidebar/lib/client.js", drop / "dsh-better-sidebar/lib/client.js"),
    ("company-shell/lib/client.js", drop / "company-shell/lib/client.js"),
    ("company-shell/lib/index.js", drop / "company-shell/lib/index.js"),
    ("company-shell/lib/kernel-watch.js", drop / "company-shell/lib/kernel-watch.js"),
]
payloads = {rel: p.read_bytes() for rel, p in pairs}
tmp = src.with_suffix(".zip.tmp")
hits = {rel: 0 for rel, _ in pairs}
with zipfile.ZipFile(src, "r") as zin, zipfile.ZipFile(tmp, "w") as zout:
    for info in zin.infolist():
        name = info.filename.replace("\\", "/")
        data = zin.read(info.filename)
        for rel, blob in payloads.items():
            if name.endswith(rel):
                data = blob
                hits[rel] += 1
        zout.writestr(info, data)
missing = [rel for rel, n in hits.items() if n < 1]
if missing:
    tmp.unlink(missing_ok=True)
    raise SystemExit("zip-member-missing:" + ",".join(missing))
tmp.replace(src)
for rel, n in hits.items():
    print("ZIP_" + rel.split("/")[0].upper() + "=" + str(n))
print("ZIP_PLUGINS_017=1")
'@, [Text.UTF8Encoding]::new($false))
& $py $zipPy $zip $drop
if ($LASTEXITCODE -ne 0) { throw 'zip-plugin-patch-failed' }

Write-Output 'ARTIFACT_017_OK=1'
