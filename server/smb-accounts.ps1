# Company share accounts: report, reconcile, and retire the shared dshshare password.
# Each person gets smb-<login> at sign-in (people-api.py). Until everyone has signed in once,
# some desks still mount as dshshare, whose password is on every desk that ever signed in.
#   -Report        who has an own account, which accounts are on, who is connected
#   -Reconcile     switch off every smb-* account whose person is not active on the roster
#   -RotateShared  new dshshare password (only when every active person has an own account,
#                  or with -Force); desks still on dshshare must sign in again
# Keep this file ASCII: Windows PowerShell 5.1 reads BOM-less UTF-8 as the ANSI code page.
param([switch]$Report, [switch]$Reconcile, [switch]$RotateShared, [switch]$Force)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new()

$Runtime = 'D:\dsh\runtime'
$roster = Get-Content -LiteralPath (Join-Path $Runtime 'roster.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$active = @{}
foreach ($p in @($roster.people)) { if ((-not $p.status) -or $p.status -eq 'active') { $active[[string]$p.login] = $true } }
$accounts = @{}
foreach ($a in @(Get-LocalUser -Name 'smb-*' -ErrorAction SilentlyContinue)) { $accounts[$a.Name.Substring(4)] = $a }
$missing = @($active.Keys | Where-Object { -not $accounts.ContainsKey($_) } | Sort-Object)

if ($Report -or -not ($Reconcile -or $RotateShared)) {
  Write-Output ('ACTIVE_PEOPLE=' + $active.Count)
  Write-Output ('OWN_ACCOUNT=' + ($active.Count - $missing.Count))
  Write-Output ('NO_OWN_ACCOUNT_YET=' + ($missing -join ','))
  foreach ($k in ($accounts.Keys | Sort-Object)) {
    $state = if ($active.ContainsKey($k)) { 'active' } else { 'not-active' }
    Write-Output ('ACCOUNT smb-' + $k + ' enabled=' + $accounts[$k].Enabled + ' person=' + $state)
  }
  Get-SmbSession -ErrorAction SilentlyContinue | Group-Object ClientUserName | ForEach-Object { Write-Output ('SESSION ' + $_.Name + ' x' + $_.Count) }
}

if ($Reconcile) {
  $off = 0
  foreach ($k in $accounts.Keys) {
    if ($active.ContainsKey($k) -or -not $accounts[$k].Enabled) { continue }
    Disable-LocalUser -Name ('smb-' + $k)
    $who = $env:COMPUTERNAME + '\smb-' + $k
    Get-SmbSession -ErrorAction SilentlyContinue | Where-Object { $_.ClientUserName -eq $who } | ForEach-Object { Close-SmbSession -SessionId $_.SessionId -Force }
    Write-Output ('DISABLED=smb-' + $k)
    $off++
  }
  Write-Output ('RECONCILE_DISABLED=' + $off)
}

if ($RotateShared) {
  if ($missing.Count -gt 0 -and -not $Force) {
    throw ('people-without-own-account: ' + ($missing -join ',') + ' (they still mount as dshshare; let them sign in once, or pass -Force)')
  }
  $bytes = New-Object 'System.Byte[]' 24
  [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  $pw = (([Convert]::ToBase64String($bytes)) -replace '[^A-Za-z0-9]', '') + 'Aa1!'
  $pf = Join-Path $Runtime 'dshshare.pass'
  [IO.File]::WriteAllText($pf, $pw + "`n", [Text.UTF8Encoding]::new($false))
  Set-LocalUser -Name dshshare -Password (ConvertTo-SecureString $pw -AsPlainText -Force)
  $who = $env:COMPUTERNAME + '\dshshare'
  Get-SmbSession -ErrorAction SilentlyContinue | Where-Object { $_.ClientUserName -eq $who } | ForEach-Object { Close-SmbSession -SessionId $_.SessionId -Force }
  Write-Output 'SHARED_PASSWORD_ROTATED=1'
}
