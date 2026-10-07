# One Windows entry after clone. Administrator.
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
function Find-Node {
  $hits = @()
  $c = Get-Command node -ErrorAction SilentlyContinue
  if ($c -and $c.Source -and ($c.Source -notmatch 'WindowsApps')) { $hits += $c.Source }
  $hits += @(
    (Join-Path $env:USERPROFILE 'tools\node\node.exe'),
    (Join-Path $env:USERPROFILE '.tdh-coding-prefix\node.exe'),
    (Join-Path $env:USERPROFILE '.tdh-coding-prefix\bin\node.exe'),
    (Join-Path ${env:ProgramFiles} 'nodejs\node.exe')
  )
  foreach ($p in $hits) {
    if ($p -and (Test-Path -LiteralPath $p)) { return $p }
  }
  throw 'node-missing'
}
function Detect-LanHost {
  if ($HostName) { return $HostName }
  $rows = @(Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object {
      $_.IPAddress -and
      $_.PrefixOrigin -in @('Dhcp', 'Manual') -and
      $_.IPAddress -notmatch '^127\.' -and
      $_.IPAddress -notmatch '^169\.254\.' -and
      $_.IPAddress -notmatch '^198\.18\.'
    })
  if (-not $rows) {
    $rows = @(Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
      Where-Object {
        $_.IPAddress -and
        $_.IPAddress -notmatch '^127\.' -and
        $_.IPAddress -notmatch '^169\.254\.' -and
        $_.IPAddress -notmatch '^198\.18\.'
      })
  }
  if (-not $rows) { throw 'lan-ip-missing' }
  $pref = @($rows | Where-Object { $_.IPAddress -match '^192\.168\.' })
  if ($pref) { return [string]$pref[0].IPAddress }
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
function Test-LfsFile([string]$Path, [int]$MinBytes, [string]$Name) {
  if (-not (Test-Path -LiteralPath $Path)) { throw ($Name + '-missing-git-lfs-pull') }
  if ((Get-Item -LiteralPath $Path).Length -lt $MinBytes) { throw ($Name + '-lfs-pointer-or-too-small') }
}

if (-not (Test-Path -LiteralPath $Server)) { throw 'server-pack-missing' }
$py = Find-Python
$node = Find-Node
$lan = Detect-LanHost
Write-Output ('REPO=' + $Repo)
Write-Output ('PYTHON=' + $py)
Write-Output ('NODE=' + $node)
Write-Output ('SITE_HOST=' + $lan)

Test-LfsFile (Join-Path $Server 'caddy.exe') 1MB 'caddy-exe'
Test-LfsFile (Join-Path $Repo 'client\CompanyDesk-win.zip') 20MB 'client-win-zip'

New-Item -ItemType Directory -Force -Path $Root, $Dist, $Runtime, $Logs, $Company, $Brain, (Join-Path $Brain '90-system'), (Join-Path $Runtime 'caddy'), (Join-Path $Runtime 'desk-lease') | Out-Null

$siteBody = @(
  ('host: ' + $lan),
  'share: dsh-company',
  'login_port: 8443',
  'gateway_port: 8450',
  'company_path: D:/dsh/company',
  'brain_path: D:/dsh/brain'
) -join "`n"
[IO.File]::WriteAllText($SiteYml, $siteBody + "`n", $Utf8NoBom)

$rosterPath = Join-Path $Runtime 'roster.json'
$rosterJson = @'
{
  "owner": "setup-server",
  "note": "Seed admin only. Add people after login.",
  "people": [
    {
      "login": "tdh",
      "role": "admin",
      "dept": "company",
      "status": "active",
      "workspace": "D:/dsh/company",
      "org": "D:/dsh/company",
      "personal": "D:/dsh/company/_office",
      "pid": "p-tdh-seed"
    }
  ]
}
'@
[IO.File]::WriteAllText($rosterPath, $rosterJson.Trim() + "`n", $Utf8NoBom)
$passPath = Join-Path $Runtime 'caddy\PASSWORDS.txt'
[IO.File]::WriteAllText($passPath, "tdh:12345678`n", $Utf8NoBom)
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
$sharePassPath = Join-Path $Runtime 'dshshare.pass'
if (-not (Test-Path -LiteralPath $sharePassPath)) {
  $sharePass = [guid]::NewGuid().ToString('N').Substring(0, 16)
  [IO.File]::WriteAllText($sharePassPath, $sharePass + "`n", $Utf8NoBom)
} else {
  $sharePass = ([IO.File]::ReadAllText($sharePassPath).Trim().Split("`n")[0]).Trim()
}
if (-not $sharePass) { throw 'dshshare-pass-empty' }
$prevShare = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
& net.exe user dshshare $sharePass /add 2>&1 | Out-Null
& net.exe user dshshare $sharePass 2>&1 | Out-Null
$ErrorActionPreference = $prevShare
try { Grant-SmbShareAccess -Name 'dsh-company' -AccountName 'dshshare' -AccessRight Full -Force -ErrorAction SilentlyContinue | Out-Null } catch {}
try { Grant-SmbShareAccess -Name 'dsh-company' -AccountName 'Everyone' -AccessRight Change -Force -ErrorAction SilentlyContinue | Out-Null } catch {}
try { icacls.exe $Company /grant '*S-1-1-0:(OI)(CI)M' /T /C | Out-Null } catch {}
try { Enable-NetFirewallRule -DisplayGroup 'File and Printer Sharing' -ErrorAction SilentlyContinue | Out-Null } catch {}
Write-Output 'SMB_SHARE_AUTH=1'

$prevCaddy = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
foreach ($tn in @('Autostart-PeopleApi', 'Autostart-KnowledgeSearch', 'Autostart-Gateway', 'Autostart-Caddy-8443')) {
  & schtasks.exe /End /TN $tn 2>&1 | Out-Null
}
$ErrorActionPreference = $prevCaddy
foreach ($p in @(8443, 4181, 4182, 8450)) { Stop-ListenPort $p }
Start-Sleep -Seconds 1
Get-Process -Name 'caddy' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 1

$caddyExe = Join-Path $Runtime 'caddy\caddy.exe'
Copy-Item -Force -LiteralPath (Join-Path $Server 'caddy.exe') -Destination $caddyExe
if ((Get-Item -LiteralPath $caddyExe).Length -lt 1MB) { throw 'caddy-copy-too-small' }

$sitePy = Join-Path $Server 'site-cs.py'
$caddyfile = Join-Path $Runtime 'caddy\Caddyfile'
& $py $sitePy --site $SiteYml emit-caddy --out $caddyfile
if ($LASTEXITCODE -ne 0) { throw 'caddyfile-failed' }

Copy-Item -Force -LiteralPath (Join-Path $Server 'download.html') -Destination (Join-Path $Dist 'index.html')

function Place-Client([string]$Name, [int]$MinBytes) {
  $from = Join-Path $Repo ('client\' + $Name)
  $to = Join-Path $Dist $Name
  if (-not (Test-Path -LiteralPath $from)) { return 0 }
  if ((Get-Item -LiteralPath $from).Length -lt $MinBytes) { throw ($Name + '-lfs-pointer-or-too-small') }
  & $py $sitePy --site $SiteYml rewrite-zip --src $from --out $to | Out-Null
  if ($LASTEXITCODE -ne 0) { throw ('rewrite-failed-' + $Name) }
  if (-not (Test-Path -LiteralPath $to)) { throw ('rewrite-missing-' + $Name) }
  return 1
}
$winZip = Place-Client 'CompanyDesk-win.zip' 20MB
$macZip = Place-Client 'CompanyDesk-mac.zip' 20MB
Write-Output ('CLIENT_WIN=' + $winZip)
Write-Output ('CLIENT_MAC=' + $macZip)
if ($winZip -ne 1) { throw 'client-win-zip-missing-git-lfs-pull' }

& powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Server 'compile-apphost.ps1')
if ($LASTEXITCODE -ne 0) { throw 'compile-apphost-failed' }

function Write-ClientVersion {
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
  Write-Output ('VERSION_WIN_MARK=' + $winMark)
  Write-Output 'VERSION_JSON_OK=1'
}
Write-ClientVersion

& powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Server 'pack-setup.ps1')
if ($LASTEXITCODE -ne 0) { throw 'pack-setup-failed' }

$prevErr = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
foreach ($tn in @('Autostart-PeopleApi', 'Autostart-KnowledgeSearch', 'Autostart-Gateway', 'Autostart-Caddy-8443')) {
  & schtasks.exe /End /TN $tn 2>&1 | Out-Null
}
$ErrorActionPreference = $prevErr
foreach ($p in @(8443, 4181, 4182, 8450)) { Stop-ListenPort $p }
Start-Sleep -Seconds 1

$env:TDH_ROSTER = $rosterPath
$env:TDH_PASSWORDS = $passPath
$env:TDH_GW_TOKENS = Join-Path $Runtime 'gw-tokens.json'
$env:TDH_GW_ENV = $gwEnv
$env:TDH_BRAIN = $Brain

Write-Task 'Autostart-PeopleApi' $py ('-u "' + (Join-Path $Server 'people-api.py') + '"') $Server
Write-Task 'Autostart-KnowledgeSearch' $node ('"' + (Join-Path $Server 'knowledge-search.js') + '"') $Server
Write-Task 'Autostart-Gateway' $node ('"' + (Join-Path $Server 'gw-lite.js') + '"') $Server
Write-Task 'Autostart-Caddy-8443' $caddyExe ('run --config "' + $caddyfile + '" --adapter caddyfile') (Join-Path $Runtime 'caddy')

# The brain's daily job: every night it reads the day's conversations where
# they already are, writes the evidence layer, distils one page per person and
# harvests corrections (server\brain\run-daily.ps1). Without it the knowledge
# service answers from an empty folder.
$brainJob = Join-Path $Server 'brain\run-daily.ps1'
if (Test-Path -LiteralPath $brainJob) {
  $brainAction = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ('-NoProfile -ExecutionPolicy Bypass -File "' + $brainJob + '" -Root "' + $Root + '" -Node "' + $node + '"')
  $brainTrigger = New-ScheduledTaskTrigger -Daily -At '00:15'
  $brainPrincipal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
  $brainSettings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 2)
  Register-ScheduledTask -TaskName 'TDH-Brain-Daily' -Action $brainAction -Trigger $brainTrigger -Principal $brainPrincipal -Settings $brainSettings -Force | Out-Null
  Write-Output 'TASK_BRAIN_DAILY=00:15'
}

try {
  New-NetFirewallRule -DisplayName 'tdh-lan-8443' -Direction Inbound -Action Allow -Protocol TCP -LocalPort 8443 -Profile Any -ErrorAction SilentlyContinue | Out-Null
  New-NetFirewallRule -DisplayName 'tdh-lan-8450' -Direction Inbound -Action Allow -Protocol TCP -LocalPort 8450 -Profile Any -ErrorAction SilentlyContinue | Out-Null
} catch {}

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

$homeHttp = & C:\Windows\System32\curl.exe -skI --noproxy '*' --max-time 15 -o NUL -w '%{http_code}' ('https://' + $lan + ':8443/')
Write-Output ('HOME_HTTP=' + $homeHttp)
if ($homeHttp -ne '200') { throw 'server-http-failed' }
& $py (Join-Path $Server 'prove-login.py') $SiteYml
if ($LASTEXITCODE -ne 0) { throw 'login-prove-failed' }
& $py (Join-Path $Server 'prove-gui.py') $SiteYml
if ($LASTEXITCODE -ne 0) { throw 'gui-prove-failed' }
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Server 'plant-client.ps1')
if ($LASTEXITCODE -ne 0) { throw 'plant-client-failed' }
Write-Output ('DOWNLOAD=https://' + $lan + ':8443/')
Write-Output 'DEFAULT_LOGIN=tdh'
Write-Output 'GW_KEY_FILE=D:\dsh\runtime\gateway.env'
Write-Output 'SITE_INSTALL_OK=1'
