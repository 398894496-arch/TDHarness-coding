# Stop 0.1.7 from RestoreProduct-on-open. Does not wipe the server.
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
foreach ($k in @('HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy')) {
  Remove-Item ('Env:' + $k) -ErrorAction SilentlyContinue
}

$Repo = Split-Path -Parent $PSScriptRoot
$env:TDH_REPO = $Repo
$env:TDH_SITE = 'D:\dsh\site.yml'
$utf8 = [Text.UTF8Encoding]::new($false)
$stamp = "`n// win-junction-failed // company-win-junction-mark-v5: 0.1.7 has no ensureSymlink; do not RestoreProduct`n"

function Find-Boot([string]$root) {
  @(
    (Join-Path $root 'node_modules\@deepseek-ai\dsh\node_modules\@deepseek-ai\dsh-app-boot\lib\index.js'),
    (Join-Path $root 'lib\node_modules\@deepseek-ai\dsh\node_modules\@deepseek-ai\dsh-app-boot\lib\index.js'),
    (Join-Path $root 'prefix\node_modules\@deepseek-ai\dsh\node_modules\@deepseek-ai\dsh-app-boot\lib\index.js'),
    (Join-Path $root 'prefix\lib\node_modules\@deepseek-ai\dsh\node_modules\@deepseek-ai\dsh-app-boot\lib\index.js')
  ) | Where-Object { Test-Path -LiteralPath $_ }
}

function Stamp-Boot([string]$root) {
  $n = 0
  foreach ($p in (Find-Boot $root)) {
    $t = [IO.File]::ReadAllText($p)
    if ($t.IndexOf('win-junction-failed') -lt 0) {
      [IO.File]::AppendAllText($p, $stamp, $utf8)
    }
    $t2 = [IO.File]::ReadAllText($p)
    if ($t2.IndexOf('win-junction-failed') -lt 0) { throw ('stamp-failed=' + $p) }
    $n += 1
  }
  return $n
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

$log = Get-Item -Path ('C:\Users\*\.dsh-company-rc' + '8\desk-home\app-start.log') -ErrorAction SilentlyContinue | Select-Object -First 1
if ($log) {
  $tail = Get-Content -LiteralPath $log.FullName -Tail 30 -ErrorAction SilentlyContinue
  Write-Output ('APP_START_LOG=' + $log.FullName)
  foreach ($line in $tail) { Write-Output ('LOG|' + $line) }
  $forced = 0
  if ($tail -and (($tail -join "`n").IndexOf('update-force-junction') -ge 0)) { $forced = 1 }
  Write-Output ('HAD_FORCE_RESTORE=' + $forced)
} else {
  Write-Output 'APP_START_LOG=missing'
}

$runtimeHits = Stamp-Boot 'D:\dsh\runtime\dsh-0-1-7-rc-2'
Write-Output ('STAMP_RUNTIME=' + $runtimeHits)
if ($runtimeHits -lt 1) { throw 'runtime-boot-missing' }

$planted = Get-Item -Path 'C:\Users\*\TDH\CompanyDesk\TDHarness.exe' -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $planted) { throw 'planted-exe-missing' }
$desk = $planted.Directory.FullName
$plantHits = Stamp-Boot $desk
Write-Output ('PLANTED=' + $planted.FullName)
Write-Output ('STAMP_PLANTED=' + $plantHits)
if ($plantHits -lt 1) { throw 'planted-boot-missing' }

$py = $null
foreach ($n in @('python', 'python3')) {
  $c = Get-Command $n -ErrorAction SilentlyContinue
  if ($c -and $c.Source -and ($c.Source -notmatch 'WindowsApps')) { $py = $c.Source; break }
}
if (-not $py) { throw 'python-missing' }

$zip = 'D:\dsh\client-dist\CompanyDesk-win.zip'
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'compile-apphost.ps1')
if ($LASTEXITCODE -ne 0) { throw 'compile-apphost-failed' }

$stage = Join-Path $env:TEMP 'tdh-open-hang-017-exe'
New-Item -ItemType Directory -Force -Path $stage | Out-Null
& $py (Join-Path $PSScriptRoot 'site-cs.py') --site 'D:\dsh\site.yml' extract-zip --src $zip --out $stage --names 'CompanyDesk/TDHarness.exe'
$newExe = Join-Path $stage 'TDHarness.exe'
if (-not (Test-Path -LiteralPath $newExe)) { throw 'new-exe-missing' }
Copy-Item -Force -LiteralPath $newExe -Destination $planted.FullName
$hay = [Text.Encoding]::Unicode.GetString([IO.File]::ReadAllBytes($planted.FullName))
if ($hay.IndexOf('tree-check skip-on-login') -lt 0) { throw 'planted-exe-missing-skip' }
if ($hay.IndexOf('junction-skip-no-ensuresymlink') -lt 0) { throw 'planted-exe-missing-017-skip' }
Write-Output 'PLANTED_EXE_017_SKIP=1'

$boot = Find-Boot $desk | Select-Object -First 1
$bootText = [IO.File]::ReadAllText($boot)
if ($bootText.IndexOf('win-junction-failed') -lt 0) { throw 'planted-boot-still-unmarked' }
if ($bootText.IndexOf('function ensureSymlink') -ge 0) { Write-Output 'PLANTED_HAS_ENSURE=1' } else { Write-Output 'PLANTED_HAS_ENSURE=0' }
Write-Output 'PLANTED_BOOT_MARK=1'

$bootStatus = Get-Item -Path ('C:\Users\*\.dsh-company-rc' + '8\desk-home\desk-boot.status') -ErrorAction SilentlyContinue
foreach ($f in @($bootStatus)) {
  if (-not $f) { continue }
  $old = [IO.File]::ReadAllText($f.FullName).Trim()
  Write-Output ('BOOT_STATUS_WAS=' + $old)
  [IO.File]::WriteAllText($f.FullName, "idle`n", $utf8)
}
Write-Output 'BOOT_STATUS_IDLE=1'

$tdh = @(Get-Process -Name 'TDHarness','CompanyDesk' -ErrorAction SilentlyContinue)
$listen = @(Get-NetTCPConnection -LocalPort 17803 -State Listen -ErrorAction SilentlyContinue)
Write-Output ('TDH_PROCS=' + $tdh.Count)
Write-Output ('PORT_17803=' + $(if ($listen) { 1 } else { 0 }))
Write-Output 'OPEN_HANG_017_OK=1'
