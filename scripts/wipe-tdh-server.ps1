# Remove the local TDH server and client on this Windows box. Does not delete git/node/python/Clash.
# Does not touch the GitHub repo. Administrator.
$ErrorActionPreference = 'Continue'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()

foreach ($tn in @('Autostart-PeopleApi', 'Autostart-KnowledgeSearch', 'Autostart-Gateway', 'Autostart-Caddy-8443')) {
  & schtasks.exe /End /TN $tn 2>$null | Out-Null
  & schtasks.exe /Delete /TN $tn /F 2>$null | Out-Null
  Write-Output ('TASK_DEL=' + $tn)
}
foreach ($port in @(8443, 4181, 4182, 8450)) {
  Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty OwningProcess -Unique |
    ForEach-Object { if ($_) { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue } }
}
Start-Sleep -Seconds 1

if (Test-Path -LiteralPath 'D:\dsh') {
  Remove-Item -LiteralPath 'D:\dsh' -Recurse -Force -ErrorAction SilentlyContinue
  Write-Output ('REMOVED=' + [int](-not (Test-Path -LiteralPath 'D:\dsh')))
}
$share = Get-SmbShare -Name 'dsh-company' -ErrorAction SilentlyContinue
if ($share) {
  Remove-SmbShare -Name 'dsh-company' -Force -ErrorAction SilentlyContinue
  Write-Output 'SHARE_DEL=1'
}

Get-ChildItem -Path 'C:\Users' -Directory -ErrorAction SilentlyContinue | ForEach-Object {
  $tdh = Join-Path $_.FullName 'TDH'
  if (Test-Path -LiteralPath $tdh) {
    Remove-Item -LiteralPath $tdh -Recurse -Force -ErrorAction SilentlyContinue
    Write-Output ('CLIENT_DEL=' + $tdh)
  }
  foreach ($desk in @((Join-Path $_.FullName 'Desktop'), (Join-Path $_.FullName 'Desktop'))) {
    Get-ChildItem -LiteralPath $desk -Filter '*TDHarness*' -ErrorAction SilentlyContinue |
      ForEach-Object { Remove-Item -LiteralPath $_.FullName -Force -ErrorAction SilentlyContinue; Write-Output ('SHORTCUT_DEL=' + $_.Name) }
  }
}
if (Test-Path -LiteralPath 'C:\TDHarness') {
  Remove-Item -LiteralPath 'C:\TDHarness' -Recurse -Force -ErrorAction SilentlyContinue
  Write-Output 'REMOVED_C_TDHARNESS=1'
}

Write-Output 'WIPE_OK=1'
