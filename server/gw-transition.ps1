# End the gateway's upgrade bridges once every desk has updated.
# While desks installed before 2026.10.09.4 / 2026.10.10.2 are out, gateway.env may carry
#   GW_ALLOW_TOKENLESS=1  (requests with no token at all are let through)
#   GW_PLAIN_LAN=1        (plaintext straight to 8450 from the LAN is let through)
# and the firewall keeps 8450 open to the LAN. The gateway records what each bridge still
# lets through, by desk address, in runtime\gw-legacy.json.
#   -Status          what is on, and who used a bridge when
#   -Finish          drop both lines and the LAN firewall rule for 8450; refused while a
#                    bridge was used in the last -QuietHours (default 72), unless -Force
# The gateway reads the bridges from gateway.env on every request. -Finish also sets
# GW_LISTEN=local (only this machine can connect to 8450) and restarts the gateway for it.
# Desks reach it through Caddy (8443/gw) from 127.0.0.1, which neither change affects.
# Keep this file ASCII: Windows PowerShell 5.1 reads BOM-less UTF-8 as the ANSI code page.
param([switch]$Status, [switch]$Finish, [int]$QuietHours = 72, [switch]$Force)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new()

$Runtime = 'D:\dsh\runtime'
$envFile = Join-Path $Runtime 'gateway.env'
$ledger = Join-Path $Runtime 'gw-legacy.json'
$lines = @(Get-Content -LiteralPath $envFile)
$on = @{}
foreach ($k in 'GW_ALLOW_TOKENLESS', 'GW_PLAIN_LAN') { $on[$k] = [bool]($lines | Where-Object { $_ -match ('^' + $k + '\s*=\s*1\s*$') }) }
$rule = Get-NetFirewallRule -DisplayName 'tdh-lan-8450' -ErrorAction SilentlyContinue
$tls = Test-Path -LiteralPath (Join-Path $Runtime 'company-ca.crt')

$recent = @()
$since = $null
if (Test-Path -LiteralPath $ledger) {
  $j = Get-Content -LiteralPath $ledger -Raw | ConvertFrom-Json
  if ($j.since) { $since = [DateTime]::Parse($j.since).ToUniversalTime() }
  foreach ($kind in 'plain', 'tokenless') {
    $bag = $j.$kind
    if (-not $bag) { continue }
    foreach ($p in $bag.PSObject.Properties) {
      $last = [DateTime]::Parse($p.Value.last).ToUniversalTime()
      $row = [pscustomobject]@{ kind = $kind; desk = $p.Name; login = [string]$p.Value.login; count = [int]$p.Value.count; last = $last }
      if (((Get-Date).ToUniversalTime() - $last).TotalHours -lt $QuietHours) { $recent += $row }
      if ($Status -or -not $Finish) { Write-Output ('SEEN ' + $kind + ' desk=' + $p.Name + ' login=' + $row.login + ' count=' + $row.count + ' last=' + $last.ToString('s') + 'Z') }
    }
  }
}

if ($Status -or -not $Finish) {
  Write-Output ('TLS_READY=' + [int]$tls)
  Write-Output ('GW_ALLOW_TOKENLESS=' + [int]$on['GW_ALLOW_TOKENLESS'])
  Write-Output ('GW_PLAIN_LAN=' + [int]$on['GW_PLAIN_LAN'])
  Write-Output ('FIREWALL_8450_LAN=' + [int][bool]$rule)
  Write-Output ('USED_LAST_' + $QuietHours + 'H=' + $recent.Count)
  $watched = if ($since) { ((Get-Date).ToUniversalTime() - $since).TotalHours } else { 0 }
  Write-Output ('RECORDING_SINCE=' + $(if ($since) { $since.ToString('s') + 'Z' } else { 'not-started' }) + ' HOURS=' + [math]::Floor($watched))
  if ($recent.Count -eq 0 -and $watched -ge $QuietHours -and ($on['GW_ALLOW_TOKENLESS'] -or $on['GW_PLAIN_LAN'] -or $rule)) { Write-Output 'READY_TO_FINISH=1' }
  elseif ($watched -lt $QuietHours) { Write-Output ('READY_TO_FINISH=0 (the record is younger than ' + $QuietHours + 'h)') }
}

if ($Finish) {
  if (-not $tls) { throw 'tls-not-ready: export-ca.ps1 and a publish first, or desks lose the gateway' }
  $watched = if ($since) { ((Get-Date).ToUniversalTime() - $since).TotalHours } else { 0 }
  if ($watched -lt $QuietHours -and -not $Force) {
    throw ('too-early: the record of bridge use is ' + [math]::Floor($watched) + 'h old; wait until it covers ' + $QuietHours + 'h, or pass -Force')
  }
  if ($recent.Count -gt 0 -and -not $Force) {
    $who = ($recent | ForEach-Object { $_.kind + ':' + $_.desk + $(if ($_.login) { '(' + $_.login + ')' } else { '' }) }) -join ', '
    throw ('bridges-still-used: ' + $who + ' (have them reopen TDHarness and take the update, or pass -Force)')
  }
  $keep = @($lines | Where-Object { $_ -notmatch '^\s*GW_(ALLOW_TOKENLESS|PLAIN_LAN|LISTEN)\s*=' -and $_ -notmatch '^#.*(still use plain 8450|Remove once every desk has updated|Remove once all have updated)' })
  # Nothing reaches 8450 from the LAN any more: listen on this machine only (defence in depth
  # when the firewall is off). Desks come through Caddy's /gw on 127.0.0.1.
  $keep += 'GW_LISTEN=local'
  [IO.File]::WriteAllLines($envFile, $keep, [Text.UTF8Encoding]::new($false))
  Write-Output 'BRIDGES_REMOVED=1'
  if ($rule) { Remove-NetFirewallRule -DisplayName 'tdh-lan-8450'; Write-Output 'FIREWALL_8450_LAN=closed' }
  Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'gw-lite\.js' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
  Start-Sleep -Seconds 1
  Start-ScheduledTask -TaskName 'Autostart-Gateway'
  for ($i = 0; $i -lt 20; $i++) { Start-Sleep -Milliseconds 500; if (Get-NetTCPConnection -LocalAddress 127.0.0.1 -LocalPort 8450 -State Listen -ErrorAction SilentlyContinue) { break } }
  $wide = @(Get-NetTCPConnection -LocalPort 8450 -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.LocalAddress -ne '127.0.0.1' })
  Write-Output ('GW_LISTEN_LOCAL_ONLY=' + [int]($wide.Count -eq 0))
  Write-Output 'GW_TRANSITION_DONE=1'
}
