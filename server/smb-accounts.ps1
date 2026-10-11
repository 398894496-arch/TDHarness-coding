# Company share accounts: report, reconcile, and retire the shared dshshare password.
# Each person gets smb-<login> at sign-in (people-api.py). Until everyone has signed in once,
# some desks still mount as dshshare, whose password is on every desk that ever signed in.
#   -Report        who has an own account, which accounts are on, who is connected
#   -Reconcile     switch off every smb-* account whose person is not active on the roster
#   -RotateShared  new dshshare password (only when every active person has an own account,
#                  or with -Force); desks still on dshshare must sign in again
#   -Status        who is still on dshshare: people with no own account yet, and every desk
#                  seen connected as dshshare (runtime\dshshare-seen.json, written by
#                  secure-folders.ps1 each run, i.e. on every roster change and nightly)
#   -Finish        retire dshshare: refused while someone has no own account, or a desk was seen
#                  on it in the last -QuietHours (default 72), or the record is younger than
#                  that, unless -Force. Then a new password nobody has, the account switched off,
#                  its connections closed. (secure-folders.ps1 already took its folder rights
#                  away once everyone had an own account.)
# Keep this file ASCII: Windows PowerShell 5.1 reads BOM-less UTF-8 as the ANSI code page.
param([switch]$Report, [switch]$Reconcile, [switch]$RotateShared, [switch]$Status, [switch]$Finish, [int]$QuietHours = 72, [switch]$Force)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new()

$Runtime = 'D:\dsh\runtime'
$roster = Get-Content -LiteralPath (Join-Path $Runtime 'roster.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$active = @{}
foreach ($p in @($roster.people)) { if ((-not $p.status) -or $p.status -eq 'active') { $active[[string]$p.login] = $true } }
$accounts = @{}
foreach ($a in @(Get-LocalUser -Name 'smb-*' -ErrorAction SilentlyContinue)) { $accounts[$a.Name.Substring(4)] = $a }
$missing = @($active.Keys | Where-Object { -not $accounts.ContainsKey($_) } | Sort-Object)

$seenFile = Join-Path $Runtime 'dshshare-seen.json'
$seen = $null
if (Test-Path -LiteralPath $seenFile) { $seen = Get-Content -LiteralPath $seenFile -Raw | ConvertFrom-Json }
$now = (Get-Date).ToUniversalTime()
$recent = @()
$since = $null
if ($seen) {
  if ($seen.since) { $since = [DateTime]::Parse($seen.since).ToUniversalTime() }
  foreach ($p in @($seen.clients.PSObject.Properties)) {
    $last = [DateTime]::Parse($p.Value).ToUniversalTime()
    if (($now - $last).TotalHours -lt $QuietHours) { $recent += ($p.Name + '@' + $last.ToString('s') + 'Z') }
  }
}
$watched = if ($since) { [math]::Floor(($now - $since).TotalHours) } else { 0 }
$shared = Get-LocalUser -Name 'dshshare' -ErrorAction SilentlyContinue

if ($Status) {
  Write-Output ('ACTIVE_PEOPLE=' + $active.Count + ' OWN_ACCOUNT=' + ($active.Count - $missing.Count))
  Write-Output ('STILL_ON_DSHSHARE=' + ($missing -join ','))
  Write-Output ('DSHSHARE_ACCOUNT=' + $(if (-not $shared) { 'none' } elseif ($shared.Enabled) { 'on' } else { 'off' }))
  Write-Output ('DSHSHARE_SEEN_LAST_' + $QuietHours + 'H=' + ($recent -join ','))
  Write-Output ('RECORDING_SINCE=' + $(if ($since) { $since.ToString('s') + 'Z' } else { 'not-started' }) + ' HOURS=' + $watched)
  if ($shared -and $shared.Enabled -and $missing.Count -eq 0 -and $recent.Count -eq 0 -and $watched -ge $QuietHours) { Write-Output 'READY_TO_FINISH=1' }
  else { Write-Output 'READY_TO_FINISH=0' }
}

if ($Finish) {
  if ($missing.Count -gt 0 -and -not $Force) { throw ('people-without-own-account: ' + ($missing -join ',') + ' (they sign in once and get one; or pass -Force)') }
  if ($watched -lt $QuietHours -and -not $Force) { throw ('too-early: dshshare use has been recorded for ' + $watched + 'h; wait until ' + $QuietHours + 'h, or pass -Force') }
  if ($recent.Count -gt 0 -and -not $Force) { throw ('dshshare-still-used: ' + ($recent -join ', ') + ' (have those desks reopen TDHarness, or pass -Force)') }
  $RotateShared = $true
  $Force = $true
}

if ($Report -or -not ($Reconcile -or $RotateShared -or $Status)) {
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
  if ($Finish) {
    Disable-LocalUser -Name dshshare
    Write-Output 'DSHSHARE_RETIRED=1'
  }
}
