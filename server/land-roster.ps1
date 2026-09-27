# Refresh roster + model-tab on a live LAN server. Does not wipe data.
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
foreach ($k in @('HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy')) {
  Remove-Item ('Env:' + $k) -ErrorAction SilentlyContinue
}

$Repo = Split-Path -Parent $PSScriptRoot
$Server = Join-Path $Repo 'server'
$Root = 'D:\dsh'
$Dist = Join-Path $Root 'client-dist'
$Runtime = Join-Path $Root 'runtime'
$SiteYml = Join-Path $Root 'site.yml'
$Utf8NoBom = [Text.UTF8Encoding]::new($false)

function Port-Up([int]$Port) {
  return [int][bool](Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
}
function Stop-ListenPort([int]$Port) {
  $pids = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty OwningProcess -Unique)
  foreach ($procId in $pids) {
    if ($procId) { Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue }
  }
}
function Find-Python {
  $hits = @()
  foreach ($n in @('python', 'python3')) {
    $c = Get-Command $n -ErrorAction SilentlyContinue
    if ($c -and $c.Source -and ($c.Source -notmatch 'WindowsApps')) { $hits += $c.Source }
  }
  $hits += @(Get-ChildItem -Path 'C:\Program Files\Python*','C:\Program Files (x86)\Python*' -Filter python.exe -ErrorAction SilentlyContinue | ForEach-Object { $_.FullName })
  foreach ($p in $hits) {
    if ($p -and (Test-Path -LiteralPath $p)) { return $p }
  }
  throw 'python-missing'
}

if (-not (Test-Path -LiteralPath $SiteYml)) { throw 'site-yml-missing' }
$py = Find-Python
$sitePy = Join-Path $Server 'site-cs.py'
$caddyfile = Join-Path $Runtime 'caddy\Caddyfile'
$caddyExe = Join-Path $Runtime 'caddy\caddy.exe'
& $py $sitePy --site $SiteYml emit-caddy --out $caddyfile
if ($LASTEXITCODE -ne 0) { throw 'caddyfile-failed' }

function Place-Client([string]$Name, [int]$MinBytes) {
  $from = Join-Path $Repo ('client\' + $Name)
  $to = Join-Path $Dist $Name
  if (-not (Test-Path -LiteralPath $from)) { return 0 }
  if ((Get-Item -LiteralPath $from).Length -lt $MinBytes) { throw ($Name + '-lfs-pointer-or-too-small') }
  & $py $sitePy --site $SiteYml rewrite-zip --src $from --out $to | Out-Null
  if ($LASTEXITCODE -ne 0) { throw ('rewrite-failed-' + $Name) }
  return 1
}
New-Item -ItemType Directory -Force -Path $Dist | Out-Null
$winZip = Place-Client 'CompanyDesk-win.zip' 20MB
$macZip = Place-Client 'CompanyDesk-mac.zip' 20MB
Write-Output ('CLIENT_WIN=' + $winZip)
Write-Output ('CLIENT_MAC=' + $macZip)
if ($winZip -ne 1) { throw 'client-win-zip-missing' }

& powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Server 'compile-apphost.ps1')
if ($LASTEXITCODE -ne 0) { throw 'compile-apphost-failed' }

$winP = Join-Path $Dist 'CompanyDesk-win.zip'
$macP = Join-Path $Dist 'CompanyDesk-mac.zip'
$winMark = (& $py $sitePy --site $SiteYml print-mark --src $winP).Trim()
if ($winMark.Length -ne 32) { throw 'win-build-mark-missing' }
$macMark = $winMark
if (Test-Path -LiteralPath $macP) {
  $got = (& $py $sitePy --site $SiteYml print-mark --src $macP).Trim()
  if ($got.Length -eq 32) { $macMark = $got }
}
$macBytes = 0
if (Test-Path -LiteralPath $macP) { $macBytes = (Get-Item -LiteralPath $macP).Length }
$obj = [ordered]@{
  schema = 'DSHPACK1'
  utc = [DateTime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ss+00:00')
  win = [ordered]@{ mark = $winMark; bytes = (Get-Item -LiteralPath $winP).Length; file = 'CompanyDesk-win.zip' }
  mac = [ordered]@{ mark = $macMark; bytes = $macBytes; file = 'CompanyDesk-mac.zip' }
}
[IO.File]::WriteAllText((Join-Path $Dist 'version.json'), (($obj | ConvertTo-Json -Compress) + "`n"), $Utf8NoBom)
Write-Output 'VERSION_JSON_OK=1'

$prev = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
foreach ($tn in @('Autostart-PeopleApi', 'Autostart-KnowledgeSearch', 'Autostart-Gateway', 'Autostart-Caddy-8443')) {
  & schtasks.exe /End /TN $tn 2>&1 | Out-Null
}
$ErrorActionPreference = $prev
foreach ($p in @(8443, 4181, 4182, 8450)) { Stop-ListenPort $p }
Get-Process -Name 'caddy' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 1
foreach ($tn in @('Autostart-PeopleApi', 'Autostart-KnowledgeSearch', 'Autostart-Gateway', 'Autostart-Caddy-8443')) {
  & schtasks.exe /Run /TN $tn | Out-Null
}

$up = $false
for ($i = 0; $i -lt 30; $i++) {
  Start-Sleep -Seconds 1
  if ((Port-Up 8443) -and (Port-Up 4181) -and (Port-Up 4182) -and (Port-Up 8450)) { $up = $true; break }
}
Write-Output ('LISTEN_8443=' + (Port-Up 8443))
Write-Output ('LISTEN_4181=' + (Port-Up 4181))
Write-Output ('LISTEN_4182=' + (Port-Up 4182))
Write-Output ('LISTEN_8450=' + (Port-Up 8450))
if (-not $up) { throw 'server-ports-down' }

& $py (Join-Path $Server 'prove-login.py') $SiteYml
if ($LASTEXITCODE -ne 0) { throw 'login-prove-failed' }
& $py (Join-Path $Server 'prove-gui.py') $SiteYml
if ($LASTEXITCODE -ne 0) { throw 'gui-prove-failed' }
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Server 'plant-client.ps1')
if ($LASTEXITCODE -ne 0) { throw 'plant-client-failed' }
Write-Output 'LAND_ROSTER_OK=1'
