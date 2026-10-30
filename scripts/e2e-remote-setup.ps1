# End to end on a fresh Windows box away from the site (workflow tailnet-e2e): build the remote Setup the way
# pack-setup.ps1 does, run it unattended, and require that it
#   1. finds the site unreachable, joins the company tailnet with the key it carries (Tailscale's MSI inside),
#   2. reaches the site by its LAN name over the tailnet (split DNS), downloads the desk pack and installs it,
#   3. refuses to join again once on the tailnet (the guard that keeps a joined machine's address),
# then logs out. Use an ephemeral key: the node is removed from the tailnet once it goes offline.
# Inputs (environment): TS_KEY (tskey-auth-..., ephemeral), SERVER_IP (the site server's tailnet address),
# SITE_HOST (the site name, e.g. tdh.local). Needs administrator (CI runners are). Prints E2E_REMOTE_SETUP_OK=1.
# Keep this file ASCII: Windows PowerShell 5.1 reads BOM-less UTF-8 as the ANSI code page.
$ErrorActionPreference = 'Stop'
foreach ($n in 'TS_KEY', 'SERVER_IP', 'SITE_HOST') { if (-not [Environment]::GetEnvironmentVariable($n)) { throw ('missing ' + $n) } }
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$server = Join-Path (Split-Path -Parent $here) 'server'
$tmpBase = if ($env:RUNNER_TEMP) { $env:RUNNER_TEMP } else { $env:TEMP }
$Work = Join-Path $tmpBase ('tdh-e2e-' + [guid]::NewGuid().ToString('N').Substring(0, 6))
$Vendor = Join-Path $Work 'vendor'
New-Item -ItemType Directory -Force -Path $Vendor | Out-Null
$ts = Join-Path $env:ProgramFiles 'Tailscale\tailscale.exe'
$site = $env:SITE_HOST

function Reach([string]$h, [int]$port) {
  try { $c = New-Object Net.Sockets.TcpClient; $ar = $c.BeginConnect($h, $port, $null, $null); $ok = $ar.AsyncWaitHandle.WaitOne(3000) -and $c.Connected; $c.Close(); return $ok } catch { return $false }
}

try {
  if (Test-Path -LiteralPath $ts) { throw 'tailscale-already-installed (needs a fresh machine)' }
  if (Reach $site 8443) { throw 'site-reachable-before-join (not away from the site)' }

  # what pack-setup.ps1 embeds: the official MSI, the join key, the server's tailnet address
  $msi = Join-Path $Vendor 'tailscale-setup.msi'
  & curl.exe -sL --max-time 600 -o $msi 'https://pkgs.tailscale.com/stable/tailscale-setup-latest-amd64.msi'
  $sig = Get-AuthenticodeSignature -LiteralPath $msi
  if ($sig.Status -ne 'Valid' -or $sig.SignerCertificate.Subject -notmatch 'O=Tailscale Inc\.') { throw 'msi-signature' }
  $utf8 = New-Object Text.UTF8Encoding($false)
  [IO.File]::WriteAllText((Join-Path $Vendor 'employee.auth'), $env:TS_KEY + "`n", $utf8)
  [IO.File]::WriteAllText((Join-Path $Vendor 'company-tailnet.txt'), "ip=$($env:SERVER_IP)`nnode=site`n", $utf8)

  $siteYml = Join-Path $Work 'site.yml'
  [IO.File]::WriteAllText($siteYml, "host: $site`nshare: dsh-company`nlogin_port: 8443`ngateway_port: 8450`ncompany_path: D:/dsh/company`n", $utf8)
  $siteCs = Join-Path $Work 'Site.generated.cs'
  & python (Join-Path $server 'site-cs.py') --site $siteYml emit-cs --out $siteCs
  if ($LASTEXITCODE -ne 0) { throw 'emit-cs-failed' }

  $Csc = 'C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe'
  $fw = Split-Path -Parent $Csc
  $res = 'tailscale-setup.msi', 'employee.auth', 'company-tailnet.txt' | ForEach-Object { '/resource:' + (Join-Path $Vendor $_) + ',tdh-ts/' + $_ }
  $exe = Join-Path $Work 'TDHarness-Setup-remote.exe'
  & $Csc /nologo /target:winexe ('/out:' + $exe) ('/r:' + (Join-Path $fw 'System.Windows.Forms.dll')) ('/r:' + (Join-Path $fw 'System.Drawing.dll')) ('/r:' + (Join-Path $fw 'System.IO.Compression.dll')) @res (Join-Path $server 'SetupStub.cs') (Join-Path $server 'TailnetJoin.cs') $siteCs | Out-String | Write-Output
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $exe)) { throw 'csc-failed' }
  Write-Output ('REMOTE_SETUP_BYTES=' + (Get-Item -LiteralPath $exe).Length)

  $t0 = Get-Date
  $p = Start-Process -FilePath $exe -ArgumentList '--quiet' -PassThru
  if (-not $p.WaitForExit(40 * 60 * 1000)) { $p.Kill(); throw 'setup-timeout' }
  $secs = [int]((Get-Date) - $t0).TotalSeconds
  $log = Join-Path $env:USERPROFILE 'TDH\setup.log'
  if (Test-Path -LiteralPath $log) { Get-Content -LiteralPath $log | Select-String -Pattern 'ts-join|download-try|download-retry|zip-got|fail|ok$' | ForEach-Object { '  setup.log: ' + $_.Line } }
  $tsLog = Join-Path $env:TEMP 'companydesk-setup-ts.log'
  if (Test-Path -LiteralPath $tsLog) { Get-Content -LiteralPath $tsLog | ForEach-Object { '  ts.log: ' + $_ } }
  Write-Output ('SETUP_EXIT=' + $p.ExitCode + ' seconds=' + $secs)
  if ($p.ExitCode -ne 0) { throw 'remote-setup-failed' }
  $app = Get-ChildItem -Path (Join-Path $env:USERPROFILE 'TDH') -Recurse -Filter 'TDHarness.exe' -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $app) { throw 'desk-not-installed' }
  Write-Output ('INSTALLED=' + $app.FullName)

  # on the company tailnet, the site name answers with the server's tailnet address, the site is reachable
  $st = & $ts status --json | Out-String
  if ($st -notmatch '"BackendState"\s*:\s*"Running"' -or $st.IndexOf('"' + $env:SERVER_IP + '"') -lt 0) { throw 'not-on-company-tailnet' }
  $a = Resolve-DnsName -Name $site -Type A -DnsOnly -ErrorAction Stop | Where-Object { $_.IPAddress } | Select-Object -First 1
  Write-Output ('RESOLVED ' + $site + ' -> ' + $a.IPAddress)
  if ($a.IPAddress -ne $env:SERVER_IP) { throw 'site-name-not-on-tailnet' }
  $code = & curl.exe -sk -o NUL -w '%{http_code}' --max-time 30 ('https://' + $site + ':8443/client/version.json')
  Write-Output ('VERSION_JSON=' + $code)
  if ($code -ne '200') { throw 'site-not-served' }
  $path = & $ts status --peers=true 2>&1 | Select-String -Pattern $env:SERVER_IP | Select-Object -First 1
  Write-Output ('PATH_TO_SERVER ' + $path)

  # the guard: joined already, a second join must change nothing
  $before = (& $ts ip -4).Trim()
  $g = Start-Process -FilePath $exe -ArgumentList @('--ts-join', $Vendor) -Wait -PassThru
  $after = (& $ts ip -4).Trim()
  Write-Output ('GUARD exit=' + $g.ExitCode + ' ip ' + $before + ' -> ' + $after)
  if ($g.ExitCode -ne 0 -or $before -ne $after) { throw 'guard-failed' }
  Write-Output 'E2E_REMOTE_SETUP_OK=1'
} finally {
  if (Test-Path -LiteralPath $ts) { & $ts logout 2>&1 | Out-Null }
  Remove-Item -LiteralPath $Work -Recurse -Force -ErrorAction SilentlyContinue
}
