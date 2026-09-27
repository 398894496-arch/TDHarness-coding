# Compile AppHost + this machine's Site.cs and put TDHarness.exe into the LAN zip.
# Text rewrite of {{TDH_HOST}} cannot change the compiled LoginUrl.
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new()

$Repo = Split-Path -Parent $PSScriptRoot
if ($env:TDH_REPO) { $Repo = $env:TDH_REPO }
$Server = Join-Path $Repo 'server'
$Dist = 'D:\dsh\client-dist'
$SiteYml = if ($env:TDH_SITE) { $env:TDH_SITE } else { 'D:\dsh\site.yml' }
$Zip = Join-Path $Dist 'CompanyDesk-win.zip'
$AppCs = Join-Path $Server 'AppHost.cs'
$Ico = Join-Path $Server 'the-diva.ico'
$SitePy = Join-Path $Server 'site-cs.py'
$Utf8NoBom = [Text.UTF8Encoding]::new($false)

$Csc = 'C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path -LiteralPath $Csc)) { $Csc = 'C:\Windows\Microsoft.NET\Framework\v4.0.30319\csc.exe' }
if (-not (Test-Path -LiteralPath $Csc)) { throw 'csc-missing' }
if (-not (Test-Path -LiteralPath $AppCs)) { throw 'apphost-cs-missing' }
if (-not (Test-Path -LiteralPath $Ico)) { throw 'ico-missing' }
if (-not (Test-Path -LiteralPath $SiteYml)) { throw 'site-yml-missing' }
if (-not (Test-Path -LiteralPath $Zip)) { throw 'client-zip-missing' }
if ((Get-Item -LiteralPath $Zip).Length -lt 20MB) { throw 'client-zip-too-small' }

$py = $null
foreach ($n in @('python3', 'python', 'py')) {
  $c = Get-Command $n -ErrorAction SilentlyContinue
  if ($c -and $c.Source -and ($c.Source -notmatch 'WindowsApps')) { $py = $c.Source; break }
}
if (-not $py) { throw 'python-missing' }

$stage = Join-Path $env:TEMP ('tdh-apphost-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Force -Path $stage | Out-Null
& $py $SitePy --site $SiteYml extract-zip --src $Zip --out $stage --names 'CompanyDesk/Microsoft.Web.WebView2.Core.dll,CompanyDesk/Microsoft.Web.WebView2.WinForms.dll,CompanyDesk/WebView2Loader.dll,CompanyDesk/BUILD.json'
if ($LASTEXITCODE -ne 0) { throw 'extract-webview2-failed' }

$coreDll = Join-Path $stage 'Microsoft.Web.WebView2.Core.dll'
$formsDll = Join-Path $stage 'Microsoft.Web.WebView2.WinForms.dll'
$buildJson = Join-Path $stage 'BUILD.json'
foreach ($p in @($coreDll, $formsDll, (Join-Path $stage 'WebView2Loader.dll'), $buildJson)) {
  if (-not (Test-Path -LiteralPath $p)) { throw ('extract-missing-' + (Split-Path $p -Leaf)) }
}

$SiteCs = Join-Path $stage 'Site.generated.cs'
& $py $SitePy --site $SiteYml emit-cs --out $SiteCs
if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $SiteCs)) { throw 'site-emit-cs-failed' }
$csText = [IO.File]::ReadAllText($SiteCs)
$office = (192,168,1,15) -join '.'
if ($csText.Contains($office)) { throw 'generated-site-has-office-ip' }
$appText = [IO.File]::ReadAllText($AppCs)
$gate = [regex]::Match($appText, 'internal static void GateProductTree\(\)[\s\S]{0,400}?internal static void RelaunchSelf')
if (-not $gate.Success) { throw 'apphost-gate-block-missing' }
if ($gate.Value.Contains('CheckProductTree')) { throw 'apphost-login-still-hashes-tree' }
if ($appText -notmatch 'tree-check skip-on-login') { throw 'apphost-missing-skip-on-login' }
if ($appText -notmatch 'junction-skip-no-ensuresymlink') { throw 'apphost-missing-017-junction-skip' }
if ($appText -notmatch 'function ensureSymlink') { throw 'apphost-junction-still-string-only' }

$StampCs = Join-Path $stage 'BuildStamp.cs'
& $py $SitePy --site $SiteYml emit-stamp --src $buildJson --out $StampCs
if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $StampCs)) { throw 'stamp-emit-failed' }

$fw = Split-Path -Parent $Csc
$winforms = Join-Path $fw 'System.Windows.Forms.dll'
$drawing = Join-Path $fw 'System.Drawing.dll'
$AppExe = Join-Path $stage 'TDHarness.exe'
$prev = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
& $Csc /nologo /platform:x64 /target:winexe /out:$AppExe /win32icon:$Ico /r:$winforms /r:$drawing /r:$coreDll /r:$formsDll $AppCs $StampCs $SiteCs
$rc = $LASTEXITCODE
$ErrorActionPreference = $prev
if ($rc -ne 0 -or -not (Test-Path -LiteralPath $AppExe)) { throw 'apphost-csc-failed' }
if ((Get-Item -LiteralPath $AppExe).Length -lt 20KB) { throw 'apphost-exe-too-small' }

& $py $SitePy --site $SiteYml replace-zip --src $Zip --out $Zip --name 'CompanyDesk/TDHarness.exe' --file $AppExe
if ($LASTEXITCODE -ne 0) { throw 'zip-replace-exe-failed' }

$hostName = ''
foreach ($raw in [IO.File]::ReadAllLines($SiteYml)) {
  $line = ($raw -split '#', 2)[0].Trim()
  if ($line -match '^host:\s*(.+)$') { $hostName = $Matches[1].Trim().Trim('"').Trim("'") }
}
$exeBytes = [IO.File]::ReadAllBytes($AppExe)
$hostU16 = [Text.Encoding]::Unicode.GetBytes($hostName)
$officeU16 = [Text.Encoding]::Unicode.GetBytes($office)
$hostU16Text = [Text.Encoding]::Unicode.GetString($hostU16)
$hay = [Text.Encoding]::Unicode.GetString($exeBytes)
if ($hay.IndexOf($hostName) -lt 0) { throw 'compiled-exe-missing-lan-host' }
if ($hay.IndexOf($office) -ge 0) { throw 'compiled-exe-still-has-office-ip' }
$loginNeedle = 'https://' + $hostName + ':8443/company/login'
if ($hay.IndexOf($loginNeedle) -lt 0) { throw 'compiled-exe-missing-login-url' }

Write-Output ('APP_BYTES=' + (Get-Item -LiteralPath $AppExe).Length)
Write-Output ('LOGIN_URL=' + $loginNeedle)
Write-Output 'COMPILE_APPHOST_OK=1'
