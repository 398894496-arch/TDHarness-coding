# Restore shipped presets and the official models page. Does not stop TDHarness.
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()

$drop = 'C:\Users\tdhssh\src\tdh-plugin-017'
$presets = Join-Path $drop 'presets'
foreach ($name in @('cordis.patch.yml', 'minimal.patch.yml')) {
  $p = Join-Path $presets $name
  if (-not (Test-Path -LiteralPath $p)) { throw ('preset-src-missing=' + $name) }
  $t = [IO.File]::ReadAllText($p)
  if ($t -notmatch 'dsh-agent-preset') { throw ('preset-not-original=' + $name) }
  if ($t -match 'company-strip-keep-bundle-v1') { throw ('preset-still-empty=' + $name) }
}
$patchJs = 'C:\Users\tdhssh\src\tdh-kernel-patch\apply-kernel-patches.js'
if (-not (Test-Path -LiteralPath $patchJs)) { throw 'patch-js-missing' }
$shellSrc = Join-Path $drop 'company-shell\lib\client.js'
if (-not (Test-Path -LiteralPath $shellSrc)) { throw 'shell-src-missing' }
if ([IO.File]::ReadAllText($shellSrc) -notmatch 'company-sub-quota-v1') { throw 'shell-src-no-quota' }

function Find-Dsh([string]$root) {
  foreach ($rel in @(
    'lib\node_modules\@deepseek-ai\dsh',
    'node_modules\@deepseek-ai\dsh',
    'prefix\lib\node_modules\@deepseek-ai\dsh',
    'prefix\node_modules\@deepseek-ai\dsh'
  )) {
    $p = Join-Path $root $rel
    if (Test-Path -LiteralPath (Join-Path $p 'package.json')) { return $p }
  }
  return $null
}

$planted = Get-Item -Path 'C:\Users\*\TDH\CompanyDesk\TDHarness.exe' -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $planted) { throw 'planted-exe-missing' }
$desk = $planted.Directory.FullName
$roots = @('D:\dsh\runtime\dsh-0-1-7-rc-2', $desk)
$node = Join-Path $desk 'node\node-real.exe'
if (-not (Test-Path -LiteralPath $node)) { $node = Join-Path $desk 'node\node.exe' }
if (-not (Test-Path -LiteralPath $node)) { throw 'node-missing' }

$nPreset = 0
$nHeader = 0
foreach ($root in $roots) {
  $dsh = Find-Dsh $root
  if (-not $dsh) { throw ('dsh-missing=' + $root) }
  $dir = Join-Path $dsh 'node_modules\@deepseek-ai\dsh-web-app\presets'
  if (-not (Test-Path -LiteralPath $dir)) { throw ('presets-dir-missing=' + $dir) }
  foreach ($name in @('cordis.patch.yml', 'minimal.patch.yml')) {
    Copy-Item -Force -LiteralPath (Join-Path $presets $name) -Destination (Join-Path $dir $name)
    $nPreset += 1
  }
  $prefix = $root
  if ($dsh.StartsWith((Join-Path $desk 'prefix'))) { $prefix = Join-Path $desk 'prefix' }
  & $node $patchJs $prefix --only company-models-header-v1
  if ($LASTEXITCODE -ne 0) { throw ('models-patch-failed=' + $prefix) }
  $models = Join-Path $dsh 'node_modules\@deepseek-ai\dsh-client-ui-settings-models\lib\client.js'
  $mt = [IO.File]::ReadAllText($models)
  if ($mt -notmatch 'settings\.models\.header') { throw ('header-slot-missing=' + $models) }
  $nHeader += 1
  $cordis = [IO.File]::ReadAllText((Join-Path $dir 'cordis.patch.yml'))
  if ($cordis -notmatch 'dsh-agent-preset') { throw 'cordis-not-original' }
  if ($cordis -match 'company-strip-keep-bundle-v1') { throw 'cordis-still-empty' }
}
Write-Output ('PRESETS_ORIGINAL=' + $nPreset)
Write-Output ('MODELS_HEADER=' + $nHeader)

$rc = Join-Path $planted.Directory.Parent.Parent.FullName ('.dsh-company-rc' + '8')
$bases = @($desk, (Join-Path $desk 'home'), (Join-Path $rc 'desk-home'))
$shellN = 0
foreach ($base in $bases) {
  foreach ($dir in @(
    (Join-Path $base 'plugins\company-shell\lib'),
    (Join-Path $base 'profiles\web\node_modules\company-shell\lib')
  )) {
    if (-not (Test-Path -LiteralPath $dir)) { continue }
    Copy-Item -Force -LiteralPath $shellSrc -Destination (Join-Path $dir 'client.js')
    $got = [IO.File]::ReadAllText((Join-Path $dir 'client.js'))
    if ($got -notmatch 'company-sub-quota-v1') { throw ('shell-quota-missing=' + $dir) }
    if ($got -match 'id: "company-subscriptions"') { throw ('shell-still-replaces-models=' + $dir) }
    $shellN += 1
  }
}
Write-Output ('SHELL_QUOTA=' + $shellN)
if ($shellN -lt 2) { throw 'shell-dest-missing' }
Write-Output 'PRESETS_MODELS_OK=1'
