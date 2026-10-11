# Install DSH 0.1.7-rc.2 into a new prefix, plant it, and put the 版本 page on the desk.
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
foreach ($k in @('HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy')) {
  Remove-Item ('Env:' + $k) -ErrorAction SilentlyContinue
}

$Want = '0.1.7-rc.2'
$Repo = Split-Path -Parent $PSScriptRoot
$env:TDH_REPO = $Repo
$PatchSrc = 'C:\Users\tdhssh\src\tdh-kernel-patch'
if (-not (Test-Path -LiteralPath (Join-Path $PatchSrc 'apply-kernel-patches.js'))) { throw 'patch-src-missing' }
$PatchRoot = 'D:\dsh\runtime\kernel-patch'
New-Item -ItemType Directory -Force -Path $PatchRoot, 'D:\dsh\runtime' | Out-Null
Get-ChildItem -LiteralPath $PatchSrc -Force | ForEach-Object {
  Copy-Item -Force -Recurse -LiteralPath $_.FullName -Destination (Join-Path $PatchRoot $_.Name)
}
Copy-Item -Force -LiteralPath (Join-Path $PSScriptRoot 'win-kernel-plug-lan.ps1') -Destination 'D:\dsh\runtime\win-kernel-plug-lan.ps1'
Copy-Item -Force -LiteralPath (Join-Path $PSScriptRoot 'win-kernel-cutover-lan.ps1') -Destination 'D:\dsh\runtime\win-kernel-cutover-lan.ps1'
$yml = @"
id: $Want
package: "@deepseek-ai/dsh"
candidate: $Want
rollback_id: 0.1.1-rc.2
rollback_prefix: D:\dsh\runtime\dsh-0-1-1-rc-2
"@
[IO.File]::WriteAllText('D:\dsh\runtime\dsh-kernel.yml', $yml, [Text.UTF8Encoding]::new($false))

& powershell.exe -NoProfile -ExecutionPolicy Bypass -File 'D:\dsh\runtime\win-kernel-plug-lan.ps1' -Want $Want
if ($LASTEXITCODE -ne 0) { throw 'plug-failed' }
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File 'D:\dsh\runtime\win-kernel-cutover-lan.ps1' -Want $Want
if ($LASTEXITCODE -ne 0) { throw 'cutover-failed' }

$shellSrc = 'C:\Users\tdhssh\src\tdh-shell-lib'
if (-not (Test-Path -LiteralPath (Join-Path $shellSrc 'kernel-watch.js'))) { throw 'shell-lib-missing' }
$planted = Get-ChildItem -Path 'C:\Users' -Filter 'TDHarness.exe' -Recurse -ErrorAction SilentlyContinue |
  Where-Object { $_.FullName -match '\\TDH\\CompanyDesk\\TDHarness\.exe$' } |
  Select-Object -First 1
if (-not $planted) { throw 'planted-exe-missing' }
$desk = $planted.Directory.FullName
$rc = Join-Path $planted.Directory.Parent.Parent.FullName ('.dsh-company-rc' + '8')
$dests = @(
  (Join-Path $desk 'plugins\company-shell\lib'),
  (Join-Path $desk 'home\profiles\web\node_modules\company-shell\lib'),
  (Join-Path $rc 'desk-home\plugins\company-shell\lib'),
  (Join-Path $rc 'desk-home\profiles\web\node_modules\company-shell\lib')
)
foreach ($d in $dests) {
  if (-not (Test-Path -LiteralPath $d)) { continue }
  Get-ChildItem -LiteralPath $shellSrc -File | ForEach-Object {
    Copy-Item -Force -LiteralPath $_.FullName -Destination (Join-Path $d $_.Name)
  }
}
$liveClient = Join-Path $rc 'desk-home\profiles\web\node_modules\company-shell\lib\client.js'
if (-not (Test-Path -LiteralPath $liveClient)) { $liveClient = Join-Path $desk 'home\profiles\web\node_modules\company-shell\lib\client.js' }
$txt = [IO.File]::ReadAllText($liveClient)
if ($txt -notmatch 'KernelWatchSection') { throw 'planted-shell-missing-version-page' }
if ($txt -notmatch 'company-kernel-watch') { throw 'planted-shell-missing-version-tab' }
$kw = Join-Path (Split-Path $liveClient) 'kernel-watch.js'
if (-not (Test-Path -LiteralPath $kw)) { throw 'planted-kernel-watch-missing' }

$zip = 'D:\dsh\client-dist\CompanyDesk-win.zip'
$stage = 'D:\dsh\pack-runtime\CompanyDesk'
New-Item -ItemType Directory -Force -Path (Split-Path $stage) | Out-Null
if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse -Force }
New-Item -ItemType Directory -Force -Path $stage | Out-Null
& tar.exe -xf $zip -C (Split-Path $stage)
if ($LASTEXITCODE -ne 0) { throw 'zip-extract-failed' }
$stagePrefix = Join-Path $stage 'prefix'
if (Test-Path -LiteralPath $stagePrefix) { Remove-Item -LiteralPath $stagePrefix -Recurse -Force }
$srcPrefix = Join-Path 'D:\dsh\runtime' ('dsh-0-1-7-rc-2')
$rcopy = (Start-Process -FilePath 'robocopy.exe' -ArgumentList @($srcPrefix, $stagePrefix, '/E', '/COPY:DAT', '/R:1', '/W:1', '/NFL', '/NDL', '/NJH', '/NJS') -Wait -PassThru).ExitCode
if ($rcopy -ge 8) { throw ('zip-prefix-copy-failed=' + $rcopy) }
foreach ($rel in @(
  'plugins\company-shell\lib',
  'home\profiles\web\node_modules\company-shell\lib'
)) {
  $d = Join-Path $stage $rel
  if (Test-Path -LiteralPath $d) { Copy-Item -Force -LiteralPath (Join-Path $shellSrc '*') -Destination $d }
}
if (Test-Path -LiteralPath $zip) { Remove-Item -LiteralPath $zip -Force }
& tar.exe -a -c -f $zip -C (Split-Path $stage) CompanyDesk
if ($LASTEXITCODE -ne 0) { throw 'zip-failed' }

$pkg = Join-Path $desk 'prefix\node_modules\@deepseek-ai\dsh\package.json'
if (-not (Test-Path -LiteralPath $pkg)) { $pkg = Join-Path $desk 'prefix\lib\node_modules\@deepseek-ai\dsh\package.json' }
$got = (Get-Content -LiteralPath $pkg -Raw -Encoding UTF8 | ConvertFrom-Json).version
if ($got -ne $Want) { throw ('landed-ver-mismatch got=' + $got) }
Write-Output ('PLANTED_DSH=' + $got)
Write-Output 'KERNEL_017_OK=1'
