# Official DSH workspace ids are UUIDs. Planted w-* rows show in the picker
# but selecting them never commits, so the composer stays locked.
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
foreach ($k in @('HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy')) {
  Remove-Item ('Env:' + $k) -ErrorAction SilentlyContinue
}

$Repo = Split-Path -Parent $PSScriptRoot
$env:TDH_REPO = $Repo
$env:TDH_SITE = 'D:\dsh\site.yml'
$LeaseSrc = 'C:\Users\tdhssh\src\tdh-desk-lease.js'
if (-not (Test-Path -LiteralPath $LeaseSrc)) { throw 'desk-lease-src-missing' }

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

$planted = Get-ChildItem -Path 'C:\Users' -Filter 'TDHarness.exe' -Recurse -ErrorAction SilentlyContinue |
  Where-Object { $_.FullName -match '\\TDH\\CompanyDesk\\TDHarness\.exe$' } |
  Select-Object -First 1
if (-not $planted) { throw 'planted-exe-missing' }
$root = $planted.Directory.FullName
Copy-Item -Force -LiteralPath $LeaseSrc -Destination (Join-Path $root 'desk-lease.js')
$leaseTxt = [IO.File]::ReadAllText((Join-Path $root 'desk-lease.js'))
if ($leaseTxt -notmatch 'function collapseSeatWorkspaces') { throw 'planted-lease-missing-collapse' }
if ($leaseTxt -notmatch 'function isUuid') { throw 'planted-lease-missing-uuid' }
if ($leaseTxt -notmatch 'function chairPath') { throw 'planted-lease-missing-chair' }

$py = $null
foreach ($n in @('python', 'python3')) {
  $c = Get-Command $n -ErrorAction SilentlyContinue
  if ($c -and $c.Source -and ($c.Source -notmatch 'WindowsApps')) { $py = $c.Source; break }
}
if (-not $py) { throw 'python-missing' }
$zip = 'D:\dsh\client-dist\CompanyDesk-win.zip'
& $py (Join-Path $PSScriptRoot 'site-cs.py') --site 'D:\dsh\site.yml' replace-zip --src $zip --out $zip --name 'CompanyDesk/desk-lease.js' --file (Join-Path $root 'desk-lease.js')
if ($LASTEXITCODE -ne 0) { throw 'zip-replace-lease-failed' }

& powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'compile-apphost.ps1')
if ($LASTEXITCODE -ne 0) { throw 'compile-apphost-failed' }
$stage = Join-Path $env:TEMP 'tdh-pin-uuid-exe'
New-Item -ItemType Directory -Force -Path $stage | Out-Null
& $py (Join-Path $PSScriptRoot 'site-cs.py') --site 'D:\dsh\site.yml' extract-zip --src $zip --out $stage --names 'CompanyDesk/TDHarness.exe'
Copy-Item -Force -LiteralPath (Join-Path $stage 'TDHarness.exe') -Destination $planted.FullName
$hay = [Text.Encoding]::Unicode.GetString([IO.File]::ReadAllBytes($planted.FullName))
if ($hay.IndexOf('pin-uuid-seats') -lt 0) { throw 'planted-exe-missing-uuid-pin' }

$node = Join-Path $root 'node\node.exe'
$real = Join-Path $root 'node\node-real.exe'
if (Test-Path -LiteralPath $real) { $node = $real }
$rc = Join-Path $planted.Directory.Parent.Parent.FullName ('.dsh-company-rc' + '8')
$env:DSH_COMPANY_RC = $rc
& $node (Join-Path $root 'desk-lease.js') collapse-seats --personal 'D:\dsh\company\_office' --org 'D:\dsh\company' --home (Join-Path $rc 'desk-home')
if ($LASTEXITCODE -ne 0) { throw 'collapse-seats-failed' }

& $py -c @"
import json
from pathlib import Path
p = Path(r'D:\dsh\company\_office\.dsh-desk\storages\workspace.json')
ws = json.loads(p.read_text(encoding='utf-8'))
tables = ((ws.get('tables') or {}).get('workspaces')) or {}
titles = sorted(str(r.get('title') or '') for r in tables.values() if isinstance(r, dict))
paths = [str(r.get('path') or '') for r in tables.values() if isinstance(r, dict)]
print('WS_COUNT=' + str(len(tables)))
print('WS_TITLE_ESC=' + ','.join(t.encode('unicode_escape').decode('ascii') for t in titles))
print('WS_PATH_ESC=' + ','.join(x.encode('unicode_escape').decode('ascii') for x in paths))
want = ['\u4e2a\u4eba', '\u56e2\u961f']
if titles != want:
    raise SystemExit('workspace-titles-wrong')
if len(tables) != 2:
    raise SystemExit('workspace-count-wrong')
if any('/' in x and '://' not in x for x in paths):
    raise SystemExit('workspace-paths-still-fwd')
print('WS_WIN_PATHS=1')
print('PIN_UUID_LAND=1')
"@
if ($LASTEXITCODE -ne 0) { throw 'workspace-prove-failed' }

$pkg = Join-Path $root 'prefix\node_modules\@deepseek-ai\dsh\package.json'
if (-not (Test-Path -LiteralPath $pkg)) {
  $pkg = Join-Path $root 'prefix\lib\node_modules\@deepseek-ai\dsh\package.json'
}
if (Test-Path -LiteralPath $pkg) {
  $ver = (Get-Content -LiteralPath $pkg -Raw | ConvertFrom-Json).version
  Write-Output ('PLANTED_DSH=' + $ver)
}
Write-Output 'PIN_UUID_OK=1'
