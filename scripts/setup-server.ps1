# One Windows entry: clone this repo, then run this file as Administrator.
# Starts download (8443), people/login (4181), knowledge (4182), gateway (8450).
# Does not start 7801-7803. Does not write company documents or model keys into git.
param(
  [string]$Repo = '',
  [string]$HostName = ''
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
foreach ($k in @('HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy')) {
  Remove-Item ('Env:' + $k) -ErrorAction SilentlyContinue
}

if (-not $Repo) { $Repo = Split-Path -Parent $PSScriptRoot }
$Server = Join-Path $Repo 'server'
$Root = 'D:\dsh'
$Dist = Join-Path $Root 'client-dist'
$Runtime = Join-Path $Root 'runtime'
$Logs = Join-Path $Root 'logs'
$Company = Join-Path $Root 'company'
$Brain = Join-Path $Root 'brain'
$SiteYml = Join-Path $Root 'site.yml'
$env:TDH_REPO = $Repo
$env:TDH_ROOT = $Root
$env:TDH_SITE = $SiteYml

function Port-Up([int]$Port) {
  return [int][bool](Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
}
function Find-Python {
  foreach ($n in 'python3', 'python', 'py') {
    $c = Get-Command $n -ErrorAction SilentlyContinue
    if ($c) { return $c.Source }
  }
  throw 'python-missing'
}
function Find-Node {
  $c = Get-Command node -ErrorAction SilentlyContinue
  if ($c) { return $c.Source }
  $prefix = Join-Path $env:USERPROFILE '.tdh-coding-prefix'
  $hit = Join-Path $prefix 'node.exe'
  if (Test-Path -LiteralPath $hit) { return $hit }
  $hit = Join-Path $prefix 'bin\node.exe'
  if (Test-Path -LiteralPath $hit) { return $hit }
  throw 'node-missing-run-setup-ps1-first'
}
function Detect-LanHost {
  if ($HostName) { return $HostName }
  $rows = @(Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object {
      $_.IPAddress -and
      $_.IPAddress -notmatch '^127\.' -and
      $_.IPAddress -notmatch '^169\.254\.' -and
      $_.IPAddress -notmatch '^198\.18\.'
    })
  if (-not $rows) { throw 'lan-ip-missing' }
  return [string]$rows[0].IPAddress
}
function Write-Task([string]$Name, [string]$Command, [string]$Arguments, [string]$WorkDir) {
  $xmlPath = Join-Path $Logs ($Name + '.xml')
  $cmdEsc = [Security.SecurityElement]::Escape($Command)
  $argEsc = [Security.SecurityElement]::Escape($Arguments)
  $workEsc = [Security.SecurityElement]::Escape($WorkDir)
  $xml = @"
<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.4" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <Triggers><BootTrigger><Enabled>true</Enabled></BootTrigger></Triggers>
  <Principals>
    <Principal id="Author">
      <UserId>S-1-5-18</UserId>
      <RunLevel>HighestAvailable</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>false</AllowHardTerminate>
    <StartWhenAvailable>true</StartWhenAvailable>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>true</Enabled>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <Priority>7</Priority>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>$cmdEsc</Command>
      <Arguments>$argEsc</Arguments>
      <WorkingDirectory>$workEsc</WorkingDirectory>
    </Exec>
  </Actions>
</Task>
"@
  [IO.File]::WriteAllText($xmlPath, $xml, [Text.Encoding]::Unicode)
  & schtasks.exe /Create /TN $Name /XML $xmlPath /F | Out-Null
  & schtasks.exe /Run /TN $Name | Out-Null
}

if (-not (Test-Path -LiteralPath $Server)) { throw 'server-pack-missing' }
$py = Find-Python
$node = Find-Node
$lan = Detect-LanHost
Write-Output ('REPO=' + $Repo)
Write-Output ('SITE_HOST=' + $lan)

New-Item -ItemType Directory -Force -Path $Root, $Dist, $Runtime, $Logs, $Company, $Brain, (Join-Path $Brain '90-system'), (Join-Path $Runtime 'caddy'), (Join-Path $Runtime 'desk-lease') | Out-Null

$siteBody = @(
  ('host: ' + $lan),
  'share: dsh-company',
  'login_port: 8443',
  'gateway_port: 8450',
  'company_path: D:/dsh/company',
  'brain_path: D:/dsh/brain'
) -join "`n"
[IO.File]::WriteAllText($SiteYml, $siteBody + "`n", [Text.Encoding]::UTF8)

$rosterPath = Join-Path $Runtime 'roster.json'
if (-not (Test-Path -LiteralPath $rosterPath)) {
  $roster = @{
    owner = 'setup-server'
    note = 'Seed admin only. Add people after login. No office roster.'
    people = @(
      @{
        login = 'tdh'
        role = 'admin'
        dept = 'company'
        status = 'active'
        workspace = 'D:/dsh/company'
        org = 'D:/dsh/company'
        personal = 'D:/dsh/company/_office'
        pid = 'p-tdh-seed'
      }
    )
  }
  $roster | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $rosterPath -Encoding UTF8
}
$passPath = Join-Path $Runtime 'caddy\PASSWORDS.txt'
if (-not (Test-Path -LiteralPath $passPath)) {
  [IO.File]::WriteAllText($passPath, "tdh:12345678`n", [Text.Encoding]::UTF8)
}
$gwEnv = Join-Path $Runtime 'gateway.env'
if (-not (Test-Path -LiteralPath $gwEnv)) {
  Copy-Item -LiteralPath (Join-Path $Server 'gateway.env.example') -Destination $gwEnv
}

foreach ($n in @('_office', '_shared', '_skills', '_control', 'content')) {
  New-Item -ItemType Directory -Force -Path (Join-Path $Company $n) | Out-Null
}

$share = Get-SmbShare -Name 'dsh-company' -ErrorAction SilentlyContinue
if (-not $share) {
  New-SmbShare -Name 'dsh-company' -Path $Company -Description 'TDH company share' | Out-Null
  Write-Output 'SMB_SHARE_CREATED=1'
}

$caddyExe = Join-Path $Runtime 'caddy\caddy.exe'
$caddySrc = Join-Path $Server 'caddy.exe'
if (-not (Test-Path -LiteralPath $caddyExe)) {
  if (-not (Test-Path -LiteralPath $caddySrc)) { throw 'caddy-exe-missing-git-lfs-pull' }
  Copy-Item -LiteralPath $caddySrc -Destination $caddyExe -Force
}

$sitePy = Join-Path $Server 'site-cs.py'
$caddyfile = Join-Path $Runtime 'caddy\Caddyfile'
& $py $sitePy --site $SiteYml emit-caddy --out $caddyfile
if ($LASTEXITCODE -ne 0) { throw 'caddyfile-failed' }

$index = Join-Path $Dist 'index.html'
Copy-Item -Force -LiteralPath (Join-Path $Server 'download.html') -Destination $index

function Place-Client([string]$Name) {
  $from = Join-Path $Repo ('client\' + $Name)
  $to = Join-Path $Dist $Name
  if (-not (Test-Path -LiteralPath $from)) { return 0 }
  & $py $sitePy --site $SiteYml rewrite-zip --src $from --out $to
  if ($LASTEXITCODE -ne 0) { throw ('rewrite-failed-' + $Name) }
  return 1
}
$winZip = Place-Client 'CompanyDesk-win.zip'
$macZip = Place-Client 'CompanyDesk-mac.zip'
Write-Output ('CLIENT_WIN=' + $winZip)
Write-Output ('CLIENT_MAC=' + $macZip)
if ($winZip -eq 0) { throw 'client-win-zip-missing-git-lfs-pull' }

& powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Server 'pack-setup.ps1')
if ($LASTEXITCODE -ne 0) { throw 'pack-setup-failed' }

$env:TDH_ROSTER = $rosterPath
$env:TDH_PASSWORDS = $passPath
$env:TDH_GW_TOKENS = Join-Path $Runtime 'gw-tokens.json'
$env:TDH_GW_ENV = $gwEnv
$env:TDH_BRAIN = $Brain

Write-Task 'Autostart-PeopleApi' $py ('-u "' + (Join-Path $Server 'people-api.py') + '"') $Server
Write-Task 'Autostart-KnowledgeSearch' $node ('"' + (Join-Path $Server 'knowledge-search.js') + '"') $Server
Write-Task 'Autostart-Gateway' $node ('"' + (Join-Path $Server 'gw-lite.js') + '"') $Server
Write-Task 'Autostart-Caddy-8443' $caddyExe ('run --config "' + $caddyfile + '" --adapter caddyfile') (Join-Path $Runtime 'caddy')

try {
  New-NetFirewallRule -DisplayName 'tdh-lan-8443' -Direction Inbound -Action Allow -Protocol TCP -LocalPort 8443 -Profile Any -ErrorAction SilentlyContinue | Out-Null
  New-NetFirewallRule -DisplayName 'tdh-lan-8450' -Direction Inbound -Action Allow -Protocol TCP -LocalPort 8450 -Profile Any -ErrorAction SilentlyContinue | Out-Null
} catch {}

$up = $false
for ($i = 0; $i -lt 25; $i++) {
  Start-Sleep -Seconds 1
  if ((Port-Up 8443) -and (Port-Up 4181) -and (Port-Up 4182) -and (Port-Up 8450)) { $up = $true; break }
}
Write-Output ('LISTEN_8443=' + (Port-Up 8443))
Write-Output ('LISTEN_4181=' + (Port-Up 4181))
Write-Output ('LISTEN_4182=' + (Port-Up 4182))
Write-Output ('LISTEN_8450=' + (Port-Up 8450))
if (-not $up) { throw 'server-ports-down' }

$login = Join-Path $env:TEMP 'tdh-login.json'
[IO.File]::WriteAllText($login, '{"username":"tdh","password":"12345678"}', [Text.Encoding]::ASCII)
$code = & C:\Windows\System32\curl.exe -sk --noproxy '*' --max-time 15 -o (Join-Path $env:TEMP 'tdh-login-out.json') -w '%{http_code}' -H 'Content-Type: application/json' --data-binary ('@' + $login) ('https://' + $lan + ':8443/company/login')
Write-Output ('LOGIN_HTTP=' + $code)
$home = & C:\Windows\System32\curl.exe -skI --noproxy '*' --max-time 15 -o NUL -w '%{http_code}' ('https://' + $lan + ':8443/')
Write-Output ('HOME_HTTP=' + $home)
if ($code -ne '200' -or $home -ne '200') { throw 'server-http-failed' }
Write-Output ('DOWNLOAD=https://' + $lan + ':8443/')
Write-Output 'DEFAULT_LOGIN=tdh'
Write-Output 'GW_KEY_FILE=D:\dsh\runtime\gateway.env'
Write-Output 'SITE_INSTALL_OK=1'
