$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
$Want = '0.1.7-rc.2'
$shellSrc = 'C:\Users\tdhssh\src\tdh-shell-lib'
$planted = Get-ChildItem -Path 'C:\Users' -Filter 'TDHarness.exe' -Recurse -ErrorAction SilentlyContinue |
  Where-Object { $_.FullName -match '\\TDH\\CompanyDesk\\TDHarness\.exe$' } |
  Select-Object -First 1
if (-not $planted) { throw 'planted-exe-missing' }
$desk = $planted.Directory.FullName
$rc = Join-Path $planted.Directory.Parent.Parent.FullName ('.dsh-company-rc' + '8')
$liveClient = Join-Path $rc 'desk-home\profiles\web\node_modules\company-shell\lib\client.js'
if (-not (Test-Path -LiteralPath $liveClient)) { $liveClient = Join-Path $desk 'home\profiles\web\node_modules\company-shell\lib\client.js' }
$txt = [IO.File]::ReadAllText($liveClient)
if ($txt -notmatch 'KernelWatchSection') { throw 'planted-shell-missing-version-page' }
if ($txt -notmatch 'company-kernel-watch') { throw 'planted-shell-missing-version-tab' }
$kw = Join-Path (Split-Path $liveClient) 'kernel-watch.js'
if (-not (Test-Path -LiteralPath $kw)) { throw 'planted-kernel-watch-missing' }
Write-Output 'SHELL_VERSION_PAGE=1'

$zip = 'D:\dsh\client-dist\CompanyDesk-win.zip'
$stageRoot = 'D:\dsh\pack-runtime'
$stage = Join-Path $stageRoot 'CompanyDesk'
New-Item -ItemType Directory -Force -Path $stageRoot | Out-Null
if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse -Force }
New-Item -ItemType Directory -Force -Path $stage | Out-Null
& tar.exe -xf $zip -C $stageRoot
if ($LASTEXITCODE -ne 0) { throw 'zip-extract-failed' }
$stagePrefix = Join-Path $stage 'prefix'
if (Test-Path -LiteralPath $stagePrefix) { Remove-Item -LiteralPath $stagePrefix -Recurse -Force }
$srcPrefix = 'D:\dsh\runtime\dsh-0-1-7-rc-2'
$rcopy = (Start-Process -FilePath 'robocopy.exe' -ArgumentList @($srcPrefix, $stagePrefix, '/E', '/COPY:DAT', '/R:1', '/W:1', '/NFL', '/NDL', '/NJH', '/NJS') -Wait -PassThru).ExitCode
if ($rcopy -ge 8) { throw ('zip-prefix-copy-failed=' + $rcopy) }
foreach ($rel in @(
  'plugins\company-shell\lib',
  'home\profiles\web\node_modules\company-shell\lib'
)) {
  $d = Join-Path $stage $rel
  if (Test-Path -LiteralPath $d) {
    Get-ChildItem -LiteralPath $shellSrc -File | ForEach-Object {
      Copy-Item -Force -LiteralPath $_.FullName -Destination (Join-Path $d $_.Name)
    }
  }
}
if (Test-Path -LiteralPath $zip) { Remove-Item -LiteralPath $zip -Force }
& tar.exe -a -c -f $zip -C $stageRoot CompanyDesk
if ($LASTEXITCODE -ne 0) { throw 'zip-failed' }
Write-Output 'ZIP_PREFIX_017=1'

$pkg = Join-Path $desk 'prefix\node_modules\@deepseek-ai\dsh\package.json'
if (-not (Test-Path -LiteralPath $pkg)) { $pkg = Join-Path $desk 'prefix\lib\node_modules\@deepseek-ai\dsh\package.json' }
$got = (Get-Content -LiteralPath $pkg -Raw -Encoding UTF8 | ConvertFrom-Json).version
if ($got -ne $Want) { throw ('landed-ver-mismatch got=' + $got) }
Write-Output ('PLANTED_DSH=' + $got)
Write-Output 'KERNEL_017_OK=1'
