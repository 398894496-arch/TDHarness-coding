# Remove the local TDH server and client on this Windows box. Does not delete git/node/python/Clash.
# Does not touch the GitHub repo. Administrator.
#   powershell -ExecutionPolicy Bypass -File scripts\wipe-tdh-server.ps1          list what would go
#   powershell -ExecutionPolicy Bypass -File scripts\wipe-tdh-server.ps1 -Yes     remove it
# This deletes D:\dsh whole: the company share, the knowledge base, the roster, the keys and
# the update-signing key. Back up first (docs/SERVER.md, "Back up").
param([switch]$Yes)
$ErrorActionPreference = 'Continue'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()

$tasks = @('Autostart-PeopleApi', 'Autostart-KnowledgeSearch', 'Autostart-Gateway', 'Autostart-Caddy-8443', 'TDH-Brain-Daily', 'TDH-Secure-Folders')
# Share accounts setup and sign-in made: dshshare and one smb-<login> per person.
$accounts = @(Get-LocalUser -ErrorAction SilentlyContinue | Where-Object { $_.Name -eq 'dshshare' -or $_.Name -like 'smb-*' } | ForEach-Object { $_.Name })
if (-not $Yes) {
  if (Test-Path -LiteralPath 'D:\dsh') {
    $n = @(Get-ChildItem -LiteralPath 'D:\dsh' -Recurse -File -Force -ErrorAction SilentlyContinue).Count
    Write-Output ('WOULD_DELETE=D:\dsh (' + $n + ' files: company share, knowledge base, roster, keys, signing key)')
  }
  Write-Output ('WOULD_DELETE_TASKS=' + (($tasks | Where-Object { Get-ScheduledTask -TaskName $_ -ErrorAction SilentlyContinue }) -join ','))
  Write-Output ('WOULD_DELETE_ACCOUNTS=' + ($accounts -join ','))
  Write-Output 'WOULD_DELETE_SHARE=dsh-company, the TDH client folders and shortcuts of every user on this PC'
  Write-Output 'NOT_DONE=1 (back up D:\dsh first, then run again with -Yes)'
  exit 0
}

foreach ($tn in $tasks) {
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
foreach ($a in $accounts) {
  Remove-LocalUser -Name $a -ErrorAction SilentlyContinue
  Write-Output ('ACCOUNT_DEL=' + $a)
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
