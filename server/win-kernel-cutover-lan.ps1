param(
  [Parameter(Mandatory = $true)][string]$Want,
  # Rehearsal only: switch a copy of a desk folder and leave the running desk alone.
  [string]$Desk = '',
  [switch]$NoStop
)
# Switch this desk to kernel $Want.
#
# The kernel the desk runs from is <desk>\prefix. The one it replaces is not
# deleted: it is renamed to prefix-<version> next to it, so going back is a
# rename, not a reinstall. A version kept that way is switched to the same way.
# After the switch the desk's own home is booted against the new kernel; if
# that self-test fails, the previous kernel is put back. Two previous kernels
# are kept.
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
if ($Want -notmatch '^[0-9]+\.[0-9]+\.[0-9]+(-[A-Za-z0-9.]+)?$') { throw 'bad-version' }
$Safe = ($Want -replace '[./]', '-')
$Source = Join-Path 'D:\dsh\runtime' ('dsh-' + $Safe)
$Keep = 2

function Get-PrefixVersion([string]$dir) {
  foreach ($rel in 'node_modules\@deepseek-ai\dsh\package.json', 'lib\node_modules\@deepseek-ai\dsh\package.json') {
    $p = Join-Path $dir $rel
    if (Test-Path -LiteralPath $p) { return (Get-Content -LiteralPath $p -Raw -Encoding UTF8 | ConvertFrom-Json).version }
  }
  return ''
}

$planted = Get-ChildItem -Path 'C:\Users' -Filter 'TDHarness.exe' -Recurse -Depth 4 -ErrorAction SilentlyContinue |
  Where-Object { $_.FullName -match '\\TDH\\CompanyDesk\\TDHarness\.exe$' } |
  Select-Object -First 1
if (-not $planted) { throw 'planted-exe-missing' }
$deskUser = Split-Path (Split-Path $planted.Directory.FullName)
$deskHome = Join-Path $deskUser ('.dsh-company-rc' + '8\desk-home')
# PowerShell names are not case-sensitive: $desk would be the -Desk parameter
# itself, and a real switch would then look like a rehearsal.
$deskDir = if ($Desk) { $Desk } else { $planted.Directory.FullName }
$node = Join-Path $deskDir 'node\node.exe'
$dest = Join-Path $deskDir 'prefix'
$staged = Join-Path $deskDir ('prefix-' + $Safe)
$current = if (Test-Path -LiteralPath $dest) { Get-PrefixVersion $dest } else { '' }
if ($current -eq $Want) { Write-Output ('PLANTED_DSH=' + $Want); Write-Output 'KERNEL_CUTOVER_OK=1'; return }
if (-not (Test-Path -LiteralPath $staged) -and -not (Test-Path -LiteralPath $Source)) { throw 'prefix-missing' }

if (-not $NoStop) {
Get-Process -Name 'TDHarness', 'CompanyDesk' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
  Where-Object {
    # The runner that started this script (ps-runner.mjs) is a desk node too;
    # stopping it would stop this script half way.
    $_.Name -match '^(node|node-real)\.exe$' -and ($_.CommandLine -notlike '*ps-runner.mjs*') -and (
      ($_.ExecutablePath -and ($_.ExecutablePath -like '*\TDH\*')) -or
      ($_.CommandLine -and ($_.CommandLine -like '*\TDH\*'))
    )
  } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Start-Sleep -Seconds 2
}

# Put the running kernel aside under its version.
$aside = ''
if (Test-Path -LiteralPath $dest) {
  $tag = if ($current) { $current -replace '[./]', '-' } else { 'unknown-' + (Get-Date -Format 'yyyyMMddHHmmss') }
  $aside = Join-Path $deskDir ('prefix-' + $tag)
  if (Test-Path -LiteralPath $aside) { Remove-Item -LiteralPath $aside -Recurse -Force }
  Rename-Item -LiteralPath $dest -NewName (Split-Path $aside -Leaf)
  # A rename keeps the old timestamp; mark when it was put aside so the
  # newest previous kernels are the ones kept.
  (Get-Item -LiteralPath $aside).LastWriteTime = Get-Date
}

function Restore-Previous {
  if (Test-Path -LiteralPath $dest) { Remove-Item -LiteralPath $dest -Recurse -Force -ErrorAction SilentlyContinue }
  if ($aside -and (Test-Path -LiteralPath $aside)) { Rename-Item -LiteralPath $aside -NewName 'prefix' }
}

try {
  if (Test-Path -LiteralPath $staged) {
    Rename-Item -LiteralPath $staged -NewName 'prefix'
    Write-Output ('SWITCH=kept ' + $Want)
  } else {
    New-Item -ItemType Directory -Force -Path $dest | Out-Null
    $rc = (Start-Process -FilePath 'robocopy.exe' -ArgumentList @($Source, $dest, '/E', '/COPY:DAT', '/R:1', '/W:1', '/NFL', '/NDL', '/NJH', '/NJS', '/XF', '._*', 'selftest.json') -Wait -PassThru).ExitCode
    if ($rc -ge 8) { throw ('plant-copy-failed=' + $rc) }
    Write-Output ('SWITCH=copied ' + $Want)
  }
  $got = Get-PrefixVersion $dest
  if ($got -ne $Want) { throw ('planted-ver-mismatch got=' + $got) }

  $selftest = Join-Path $PSScriptRoot 'kernel-selftest.mjs'
  if (-not (Test-Path -LiteralPath $selftest)) { throw 'selftest-missing' }
  $ErrorActionPreference = 'Continue'
  & $node $selftest --prefix $dest --home $deskHome --node $node 2>&1 | ForEach-Object { [string]$_ }
  $st = $LASTEXITCODE
  $ErrorActionPreference = 'Stop'
  if ($st -ne 0) { throw 'selftest-failed' }
} catch {
  $why = $_.Exception.Message
  Restore-Previous
  Write-Output ('KERNEL_CUTOVER_REVERTED=' + $current)
  throw ('cutover-failed, previous kernel put back: ' + $why)
}

# Keep the newest $Keep previous kernels.
Get-ChildItem -LiteralPath $deskDir -Directory -Filter 'prefix-*' -ErrorAction SilentlyContinue |
  Sort-Object LastWriteTime -Descending | Select-Object -Skip $Keep |
  ForEach-Object { Remove-Item -LiteralPath $_.FullName -Recurse -Force -ErrorAction SilentlyContinue }
# Record what runs now. The desk's own kernel asked for this switch and has
# been stopped by it, so it cannot write the record afterwards; this script does.
if (-not $Desk) {
  $yml = 'D:\dsh\runtime\dsh-kernel.yml'
  $back = if ($current) { $current } else { '' }
  $backPrefix = if ($current) { Join-Path 'D:\dsh\runtime' ('dsh-' + ($current -replace '[./]', '-')) } else { '' }
  $text = "id: $Want`npackage: `"@deepseek-ai/dsh`"`ncandidate: $Want`nrollback_id: $back`nrollback_prefix: $backPrefix`n"
  [IO.File]::WriteAllText($yml, $text, (New-Object System.Text.UTF8Encoding($false)))
}
Write-Output ('PREVIOUS=' + $current)
Write-Output ('PLANTED_DSH=' + $Want)
Write-Output 'KERNEL_CUTOVER_OK=1'
