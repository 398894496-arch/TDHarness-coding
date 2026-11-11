# Compile the LAN Setup.exe for the site.yml sitting on this machine.
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()

$Repo = Split-Path -Parent $PSScriptRoot
if ($env:TDH_REPO) { $Repo = $env:TDH_REPO }
$Server = Join-Path $Repo 'server'
$Dist = 'D:\dsh\client-dist'
$SiteYml = if ($env:TDH_SITE) { $env:TDH_SITE } else { 'D:\dsh\site.yml' }
$StubCs = Join-Path $Server 'SetupStub.cs'
$TailnetCs = Join-Path $Server 'TailnetJoin.cs'
$Ico = Join-Path $Server 'tdharness.ico'
$SitePy = Join-Path $Server 'site-cs.py'
$Out = Join-Path $Dist 'TDHarness-Setup.exe'
$Csc = 'C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path -LiteralPath $Csc)) { $Csc = 'C:\Windows\Microsoft.NET\Framework\v4.0.30319\csc.exe' }
if (-not (Test-Path -LiteralPath $Csc)) { throw 'csc-missing' }
if (-not (Test-Path -LiteralPath $StubCs)) { throw 'stub-cs-missing' }
if (-not (Test-Path -LiteralPath $TailnetCs)) { throw 'tailnetjoin-cs-missing' }
if (-not (Test-Path -LiteralPath $Ico)) { throw 'ico-missing' }
if (-not (Test-Path -LiteralPath $SiteYml)) { throw 'site-yml-missing' }

$py = $null
foreach ($n in 'python3', 'python', 'py') {
  $c = Get-Command $n -ErrorAction SilentlyContinue
  if ($c) { $py = $c.Source; break }
}
if (-not $py) { throw 'python-missing' }

New-Item -ItemType Directory -Force -Path $Dist | Out-Null
$SiteCs = Join-Path $env:TEMP 'Site.generated.cs'
& $py $SitePy --site $SiteYml emit-cs --out $SiteCs
if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $SiteCs)) { throw 'site-emit-cs-failed' }
$csText = Get-Content -LiteralPath $SiteCs -Raw
if ($csText -match '192\.168\.1\.15') { throw 'generated-site-has-office-ip' }

$fw = Split-Path -Parent $Csc
$winforms = Join-Path $fw 'System.Windows.Forms.dll'
$drawing = Join-Path $fw 'System.Drawing.dll'
$zipDll = Join-Path $fw 'System.IO.Compression.dll'
$stubExe = Join-Path $env:TEMP 'tdh-setup-stub.exe'
$ErrorActionPreference = 'Continue'
& $Csc /nologo /target:winexe /out:$stubExe /win32icon:$Ico /r:$winforms /r:$drawing /r:$zipDll $StubCs $TailnetCs $SiteCs
$rc = $LASTEXITCODE
$ErrorActionPreference = 'Stop'
if ($rc -ne 0 -or -not (Test-Path -LiteralPath $stubExe)) { throw 'csc-failed' }
Copy-Item -Force -LiteralPath $stubExe -Destination $Out
Write-Output ('SETUP_BYTES=' + (Get-Item -LiteralPath $Out).Length)

# The remote Setup: the same program carrying Tailscale's MSI, the employee join key and the server's tailnet
# address (tailnet-site.ps1). Away from the office it joins the company tailnet first, then installs over it.
$Vendor = 'D:\dsh\runtime\tailscale\vendor'
$RemoteOut = Join-Path $Dist 'TDHarness-Setup-remote.exe'
$parts = @('tailscale-setup.msi', 'employee.auth', 'company-tailnet.txt') | ForEach-Object { Join-Path $Vendor $_ }
if (@($parts | Where-Object { -not (Test-Path -LiteralPath $_) }).Count -eq 0) {
  $res = $parts | ForEach-Object { '/resource:' + $_ + ',tdh-ts/' + (Split-Path -Leaf $_) }
  $remoteExe = Join-Path $env:TEMP 'tdh-setup-remote.exe'
  $ErrorActionPreference = 'Continue'
  & $Csc /nologo /target:winexe /out:$remoteExe /win32icon:$Ico /r:$winforms /r:$drawing /r:$zipDll @res $StubCs $TailnetCs $SiteCs
  $rc = $LASTEXITCODE
  $ErrorActionPreference = 'Stop'
  if ($rc -ne 0 -or -not (Test-Path -LiteralPath $remoteExe)) { throw 'csc-remote-failed' }
  Copy-Item -Force -LiteralPath $remoteExe -Destination $RemoteOut
  Write-Output ('SETUP_REMOTE_BYTES=' + (Get-Item -LiteralPath $RemoteOut).Length)
} else {
  if (Test-Path -LiteralPath $RemoteOut) { Remove-Item -Force -LiteralPath $RemoteOut }
  Write-Output 'SETUP_REMOTE_SKIP=no-tailnet-vendor'
}
Write-Output 'PACK_SETUP_OK=1'
