$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
$shellSrc = 'C:\Users\tdhssh\src\tdh-shell-lib'
if (-not (Test-Path -LiteralPath (Join-Path $shellSrc 'kernel-watch.js'))) { throw 'shell-src-missing' }
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
  New-Item -ItemType Directory -Force -Path $d | Out-Null
  Get-ChildItem -LiteralPath $shellSrc -File | ForEach-Object {
    Copy-Item -Force -LiteralPath $_.FullName -Destination (Join-Path $d $_.Name)
  }
  Write-Output ('PLANTED_LIB=' + $d)
}
$hit = 0
foreach ($d in $dests) {
  $p = Join-Path $d 'client.js'
  if (-not (Test-Path -LiteralPath $p)) { continue }
  $txt = [IO.File]::ReadAllText($p)
  if ($txt -match 'KernelWatchSection') { $hit += 1 }
}
if ($hit -lt 1) { throw 'shell-copy-no-kernel-section' }
Write-Output ('SHELL_HITS=' + $hit)
Write-Output 'PLANT_SHELL_017=1'
