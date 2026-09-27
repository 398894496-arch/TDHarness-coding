# Official models plugin asks for API keys and shows the beta notice.
# Put the look-only company page back. Does not stop TDHarness.
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()

$shellSrc = 'C:\Users\tdhssh\src\tdh-plugin-017\company-shell\lib\client.js'
if (-not (Test-Path -LiteralPath $shellSrc)) { throw 'shell-src-missing' }
$shell = [IO.File]::ReadAllText($shellSrc)
if ($shell -notmatch 'company-models-look-v1') { throw 'shell-no-look' }
if ($shell -notmatch 'hideBetaNotice') { throw 'shell-no-beta-hide' }

$exe = Get-Item -Path 'C:\Users\*\TDH\CompanyDesk\TDHarness.exe' | Select-Object -First 1
$desk = $exe.Directory.FullName
$rc = Join-Path $exe.Directory.Parent.Parent.FullName ('.dsh-company-rc' + '8')
$deskHome = Join-Path $rc 'desk-home'
$bases = @($desk, (Join-Path $desk 'home'), $deskHome)

$shellN = 0
foreach ($base in $bases) {
  foreach ($dir in @(
    (Join-Path $base 'plugins\company-shell\lib'),
    (Join-Path $base 'profiles\web\node_modules\company-shell\lib')
  )) {
    if (-not (Test-Path -LiteralPath $dir)) { continue }
    Copy-Item -Force -LiteralPath $shellSrc -Destination (Join-Path $dir 'client.js')
    $shellN += 1
  }
}
Write-Output ('SHELL_LOOK=' + $shellN)
if ($shellN -lt 2) { throw 'shell-dest-missing' }

$block = "- id: ui-settings-models`r`n  disabled: true`r`n"
$ovN = 0
foreach ($base in $bases) {
  foreach ($rel in @('profiles\web\overlay.yml', 'home\profiles\web\overlay.yml')) {
    $ov = Join-Path $base $rel
    if (-not (Test-Path -LiteralPath $ov)) { continue }
    $t = [IO.File]::ReadAllText($ov)
    if ($t -notmatch 'ui-settings-models') {
      $t = $t.Replace('- id: ui-settings-plugin-inventory', $block + '- id: ui-settings-plugin-inventory')
      [IO.File]::WriteAllText($ov, $t)
    }
    $got = [IO.File]::ReadAllText($ov)
    if ($got -notmatch 'ui-settings-models') { throw ('overlay-models-still-on=' + $ov) }
    if ($got -notmatch 'disabled: true') { throw ('overlay-models-not-disabled=' + $ov) }
    $ovN += 1
  }
}
Write-Output ('OVERLAY_MODELS_OFF=' + $ovN)
if ($ovN -lt 1) { throw 'overlay-missing' }
Write-Output 'MODELS_LOOK_OK=1'
