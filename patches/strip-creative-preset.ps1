# Shape an employee or director kernel prefix: drop the shipped creative (cordis) preset. Windows.
# Admin desks skip this. Never touch roaming npm or the live dsh-node tree.
param(
  [Parameter(Mandatory = $true)][string]$Prefix,
  [string]$Role = 'employee'
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()

Write-Output ('PREFIX=' + $Prefix)
Write-Output ('ROLE=' + $Role)
if ($Role -eq 'admin') {
  Write-Output 'STRIP_SKIPPED=admin-desk-keeps-creative-mode'
  exit 0
}

$Pkg = Join-Path $Prefix 'lib\node_modules\@deepseek-ai\dsh'
if (-not (Test-Path -LiteralPath (Join-Path $Pkg 'package.json'))) {
  $Pkg = Join-Path $Prefix 'node_modules\@deepseek-ai\dsh'
}
if (-not (Test-Path -LiteralPath (Join-Path $Pkg 'package.json'))) { throw 'no-dsh-in-prefix' }
# 0.1.1: config/agent-presets. 0.1.2 to 0.1.5: dsh-agent-presets/presets.
# 0.1.7+: dsh-web-app/presets/<id>.patch.yml
$Shipped = $null
foreach ($cand in @(
  (Join-Path $Pkg 'config\agent-presets'),
  (Join-Path $Pkg 'node_modules\@deepseek-ai\dsh-agent-presets\presets')
)) {
  if (Test-Path -LiteralPath (Join-Path $cand 'standard')) { $Shipped = $cand; break }
}
if (-not $Shipped) {
  $web = Join-Path $Pkg 'node_modules\@deepseek-ai\dsh-web-app\presets'
  if (Test-Path -LiteralPath (Join-Path $web 'standard.patch.yml')) { $Shipped = $web }
}
if (-not $Shipped) { throw 'shipped-presets-missing' }

# The machine's own global npm (whoever runs this): never strip a live tree.
$LiveRoam = Join-Path $env:APPDATA 'npm'
$full = [IO.Path]::GetFullPath($Prefix).TrimEnd('\')
$roam = [IO.Path]::GetFullPath($LiveRoam).TrimEnd('\')
if ($full -ieq $roam -or $full.StartsWith($roam + '\', [StringComparison]::OrdinalIgnoreCase)) {
  throw 'refuse-roaming-npm-prefix'
}

Write-Output ('SHIPPED=' + $Shipped)
Write-Output ('BEFORE=' + ((Get-ChildItem -LiteralPath $Shipped -Force).Name -join ','))
foreach ($id in @('cordis', 'minimal')) {
  $dir = Join-Path $Shipped $id
  $patch = Join-Path $Shipped ($id + '.patch.yml')
  if (Test-Path -LiteralPath $dir) {
    Remove-Item -LiteralPath $dir -Recurse -Force
    Write-Output ('DROPPED=' + $id)
  } elseif (Test-Path -LiteralPath $patch) {
    # 0.1.7 ships these as the preset cards. Leave the file.
    Write-Output ('KEEP_ORIGINAL=' + $id + '.patch.yml')
  } else {
    Write-Output ('ALREADY_ABSENT=' + $id)
  }
}
Write-Output ('AFTER=' + ((Get-ChildItem -LiteralPath $Shipped -Force).Name -join ','))
$hasStandard = (Test-Path -LiteralPath (Join-Path $Shipped 'standard')) -or (Test-Path -LiteralPath (Join-Path $Shipped 'standard.patch.yml'))
if (-not $hasStandard) { throw 'standard-missing' }
if (Test-Path -LiteralPath (Join-Path $Shipped 'cordis')) { throw 'cordis-still-present' }
$cordisPatch = Join-Path $Shipped 'cordis.patch.yml'
if (Test-Path -LiteralPath $cordisPatch) {
  $raw = [IO.File]::ReadAllText($cordisPatch)
  if ($raw -match 'company-strip-keep-bundle-v1') { throw 'cordis-patch-still-empty' }
  if ($raw -notmatch 'dsh-agent-preset') { throw 'cordis-patch-not-original' }
}
Write-Output 'STRIP_OK=1'
