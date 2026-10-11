# Local chair path + overlay re-pin. Does not wipe the server.
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
foreach ($k in @('HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy')) {
  Remove-Item ('Env:' + $k) -ErrorAction SilentlyContinue
}

$Repo = Split-Path -Parent $PSScriptRoot
$env:TDH_REPO = $Repo
$env:TDH_SITE = 'D:\dsh\site.yml'
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'compile-apphost.ps1')
if ($LASTEXITCODE -ne 0) { throw 'compile-apphost-failed' }

$prev = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
& schtasks.exe /End /TN Autostart-PeopleApi 2>&1 | Out-Null
$ErrorActionPreference = $prev
$pids = @(Get-NetTCPConnection -LocalPort 4181 -State Listen -ErrorAction SilentlyContinue |
  Select-Object -ExpandProperty OwningProcess -Unique)
foreach ($procId in $pids) {
  if ($procId) { Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue }
}
Start-Sleep -Seconds 1
& schtasks.exe /Run /TN Autostart-PeopleApi | Out-Null
$up = $false
for ($i = 0; $i -lt 20; $i++) {
  Start-Sleep -Seconds 1
  if (Get-NetTCPConnection -LocalPort 4181 -State Listen -ErrorAction SilentlyContinue) { $up = $true; break }
}
if (-not $up) { throw 'people-api-down' }
Write-Output 'PEOPLE_API_RESTART=1'

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

$zip = 'D:\dsh\client-dist\CompanyDesk-win.zip'
$stage = Join-Path $env:TEMP 'tdh-open-fix-exe'
New-Item -ItemType Directory -Force -Path $stage | Out-Null
$py = $null
foreach ($n in @('python', 'python3')) {
  $c = Get-Command $n -ErrorAction SilentlyContinue
  if ($c -and $c.Source -and ($c.Source -notmatch 'WindowsApps')) { $py = $c.Source; break }
}
if (-not $py) { throw 'python-missing' }
& $py (Join-Path $PSScriptRoot 'site-cs.py') --site 'D:\dsh\site.yml' extract-zip --src $zip --out $stage --names 'CompanyDesk/TDHarness.exe'
$newExe = Join-Path $stage 'TDHarness.exe'
if (-not (Test-Path -LiteralPath $newExe)) { throw 'new-exe-missing' }

$planted = Get-ChildItem -Path 'C:\Users' -Filter 'TDHarness.exe' -Recurse -ErrorAction SilentlyContinue |
  Where-Object { $_.FullName -match '\\TDH\\CompanyDesk\\TDHarness\.exe$' } |
  Select-Object -First 1
if (-not $planted) { throw 'planted-exe-missing' }
Copy-Item -Force -LiteralPath $newExe -Destination $planted.FullName
$hay = [Text.Encoding]::Unicode.GetString([IO.File]::ReadAllBytes($planted.FullName))
if ($hay.IndexOf('open-fix-local-chair') -lt 0) { throw 'planted-exe-missing-open-fix' }
if ($hay.IndexOf('tree-check skip-on-login') -lt 0) { throw 'planted-exe-missing-skip' }
Write-Output ('PLANTED=' + $planted.FullName)

$prof = $planted.Directory.Parent.Parent.FullName
$rc = Join-Path $prof ('.dsh-company-rc' + '8')
New-Item -ItemType Directory -Force -Path $rc | Out-Null
$utf8 = [Text.UTF8Encoding]::new($false)
[IO.File]::WriteAllText((Join-Path $rc 'work.personal'), "D:\dsh\company\_office`n", $utf8)
[IO.File]::WriteAllText((Join-Path $rc 'work.org'), "D:\dsh\company`n", $utf8)
Write-Output 'WORK_LOCAL=1'

$node = Join-Path $planted.Directory.FullName 'node\node.exe'
$real = Join-Path $planted.Directory.FullName 'node\node-real.exe'
if (Test-Path -LiteralPath $real) { $node = $real }
$leaseJs = Join-Path $planted.Directory.FullName 'desk-lease.js'
$ov = Join-Path $rc 'desk-home\profiles\web\overlay.yml'
if ((Test-Path -LiteralPath $node) -and (Test-Path -LiteralPath $leaseJs) -and (Test-Path -LiteralPath $ov)) {
  & $node $leaseJs pin-overlay --overlay $ov --personal 'D:\dsh\company\_office' --home (Join-Path $rc 'desk-home')
  if ($LASTEXITCODE -ne 0) { throw 'pin-overlay-failed' }
}
$ws = 'D:\dsh\company\_office\.dsh-desk\storages\workspace.json'
& $py -c @"
import json
from pathlib import Path
p = Path(r'D:\dsh\company\_office\.dsh-desk\storages\workspace.json')
ws = json.loads(p.read_text(encoding='utf-8'))
tables = ((ws.get('tables') or {}).get('workspaces')) or {}
for row in tables.values():
    if not isinstance(row, dict):
        continue
    cur = str(row.get('path') or '').replace('\\', '/')
    low = cur.lower()
    if '_office' in low:
        row['path'] = 'D:/dsh/company/_office'
    elif low.rstrip('/').endswith('dsh-company') or low.rstrip('/').endswith('dsh/company'):
        row['path'] = 'D:/dsh/company'
p.write_text(json.dumps(ws, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print('WS_LOCAL=1')
"@
if ($LASTEXITCODE -ne 0) { throw 'workspace-rewrite-failed' }
if (-not (Test-Path -LiteralPath $ws)) { throw 'workspace-json-missing' }
$wsText = [IO.File]::ReadAllText($ws)
if ($wsText -notmatch 'D:/dsh/company/_office') { throw 'workspace-missing-local-personal' }
if ($wsText -notmatch 'D:/dsh/company"') { throw 'workspace-missing-local-org' }
$ovText = [IO.File]::ReadAllText($ov)
if ($ovText -notmatch 'D:/dsh/company/_office/.dsh-desk') { throw 'overlay-missing-desk-pin' }
Write-Output 'OVERLAY_PINNED=1'
Write-Output 'OPEN_FIX_OK=1'
