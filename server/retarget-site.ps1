# Point the whole LAN site (site.yml, Caddyfile, both client zips, TDHarness.exe, Setup.exe,
# signed version.json) at a new host name. Default is this box's mDNS name <computername>.local,
# which survives a network or IP change; rerun only after renaming the computer.
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File retarget-site.ps1 [-NewHost name.local] [-NoRestart]
# Clients installed under the old host cannot reach the new one; reinstall them from the new URL.
# Keep this file ASCII: Windows PowerShell 5.1 reads BOM-less UTF-8 as the ANSI code page.
param(
  [string]$NewHost = ($env:COMPUTERNAME.ToLowerInvariant() + '.local'),
  [switch]$NoRestart
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new()
$Utf8NoBom = [Text.UTF8Encoding]::new($false)

$Server = $PSScriptRoot
$Dist = 'D:\dsh\client-dist'
$SiteYml = 'D:\dsh\site.yml'
$Caddyfile = 'D:\dsh\runtime\caddy\Caddyfile'
$Caddy = 'D:\dsh\runtime\caddy\caddy.exe'
$SitePy = Join-Path $Server 'site-cs.py'
$py = $null
foreach ($n in 'python', 'python3') {
  $c = Get-Command $n -ErrorAction SilentlyContinue
  if ($c -and $c.Source -and ($c.Source -notmatch 'WindowsApps')) { $py = $c.Source; break }
}
if (-not $py) { $py = @(Get-ChildItem -Path 'C:\Program Files\Python*' -Filter python.exe -ErrorAction SilentlyContinue | ForEach-Object { $_.FullName })[0] }
if (-not $py) { throw 'python-missing' }

# 1. Old host
$lines = [IO.File]::ReadAllLines($SiteYml)
$OldHost = ''
foreach ($raw in $lines) {
  $t = ($raw -split '#', 2)[0].Trim()
  if ($t -match '^host:\s*(.+)$') { $OldHost = $Matches[1].Trim().Trim('"').Trim("'") }
}
if (-not $OldHost) { throw 'site-host-missing' }
Write-Output ('OLD_HOST=' + $OldHost)
Write-Output ('NEW_HOST=' + $NewHost)

# 2. Backup
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$bak = "D:\dsh\backup-retarget-$stamp"
New-Item -ItemType Directory -Force -Path $bak | Out-Null
Copy-Item -LiteralPath $SiteYml, $Caddyfile -Destination $bak
Copy-Item -LiteralPath $Dist -Destination (Join-Path $bak 'client-dist') -Recurse
Write-Output ('BACKUP=' + $bak)

# 3. site.yml + Caddyfile (validated before it replaces the live one)
$out = foreach ($raw in $lines) { if ($raw -match '^\s*host:') { 'host: ' + $NewHost } else { $raw } }
[IO.File]::WriteAllLines($SiteYml, [string[]]$out, $Utf8NoBom)
$tmpCaddy = $Caddyfile + '.new'
& $py $SitePy --site $SiteYml emit-caddy --out $tmpCaddy
if ($LASTEXITCODE -ne 0) { throw 'emit-caddy-failed' }
# caddy logs to stderr; PS 5.1 with Stop would treat that as a failure
$ErrorActionPreference = 'Continue'
& $Caddy validate --config $tmpCaddy --adapter caddyfile 2>&1 | Out-Null
$rc = $LASTEXITCODE
$ErrorActionPreference = 'Stop'
if ($rc -ne 0) { throw 'caddy-validate-failed' }
Move-Item -Force -LiteralPath $tmpCaddy -Destination $Caddyfile

# 4. Loopback SMB by the new name (the desk on this box mounts its own share)
if ($NewHost -notmatch '^\d+\.\d+\.\d+\.\d+$') {
  $k = 'HKLM:\SYSTEM\CurrentControlSet\Control\Lsa\MSV1_0'
  $cur = @((Get-ItemProperty $k -Name BackConnectionHostNames -ErrorAction SilentlyContinue).BackConnectionHostNames) | Where-Object { $_ }
  New-ItemProperty -Path $k -Name BackConnectionHostNames -PropertyType MultiString -Value (@($cur + $NewHost) | Select-Object -Unique) -Force | Out-Null
}

# 5. Old host inside both zips
foreach ($name in 'CompanyDesk-win.zip', 'CompanyDesk-mac.zip') {
  $zip = Join-Path $Dist $name
  if (-not (Test-Path -LiteralPath $zip)) { continue }
  $hits = & $py $SitePy --site $SiteYml retarget-zip --old $OldHost --src $zip --out $zip
  if ($LASTEXITCODE -ne 0) { throw ('retarget-failed-' + $name) }
  Write-Output ($name + ' ' + $hits)
}

# 6. Recompile, reseal, sign (same tail as a normal publish)
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Server 'publish-site-update.ps1')
if ($LASTEXITCODE -ne 0) { throw 'publish-failed' }

# 7. Restart Caddy
if (-not $NoRestart) {
  Stop-ScheduledTask -TaskName 'Autostart-Caddy-8443' -ErrorAction SilentlyContinue
  Get-Process caddy -ErrorAction SilentlyContinue | Stop-Process -Force
  Start-Sleep -Seconds 1
  Start-ScheduledTask -TaskName 'Autostart-Caddy-8443'
  Start-Sleep -Seconds 4
  if (-not (Get-Process caddy -ErrorAction SilentlyContinue)) { throw 'caddy-not-running' }
}
Write-Output ('DOWNLOAD=https://' + $NewHost + ':8443/')
Write-Output 'RETARGET_OK=1'
