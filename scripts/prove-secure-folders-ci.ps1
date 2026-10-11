# CI (Windows runner, administrator): the company-share rights end to end, on a throwaway
# root with throwaway local accounts, so a change that opens the share again fails the build.
#   1. a share left the way old installs left it (Everyone granted file by file), runtime
#      inheriting Authenticated Users: prove-secure-folders.ps1 must FAIL on it
#   2. secure-folders.ps1 -Apply, then prove-secure-folders.ps1 must pass, and a second
#      -Apply must change nothing
#   3. someone grants Everyone again (the line an old setup had): the proof must FAIL again
#   4. people move from dshshare to their own account: their folders close to dshshare
# Removes its accounts and folders at the end. Prints SECURE_FOLDERS_CI_OK=1.
# Keep this file ASCII: Windows PowerShell 5.1 reads BOM-less UTF-8 as the ANSI code page.
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new()
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$server = Join-Path (Split-Path -Parent $here) 'server'
$Root = Join-Path $env:RUNNER_TEMP ('tdh-acl-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
if (-not $env:RUNNER_TEMP) { $Root = Join-Path $env:TEMP ('tdh-acl-' + [guid]::NewGuid().ToString('N').Substring(0, 8)) }
$Company = Join-Path $Root 'company'
$people = @(
  @{ login = 'amy'; role = 'employee'; dept = 'ops' },
  @{ login = 'ann'; role = 'employee'; dept = 'ops' },
  @{ login = 'dan'; role = 'director'; dept = 'ops' },
  @{ login = 'eve'; role = 'employee'; dept = 'sales' },
  @{ login = 'adm'; role = 'admin'; dept = 'company' },
  @{ login = 'bob'; role = 'employee'; dept = 'sales' }   # no own account yet: still on dshshare
)
$made = @()
function New-Account([string]$name) {
  $pw = ConvertTo-SecureString ('Ci' + [guid]::NewGuid().ToString('N') + 'a1!') -AsPlainText -Force
  if (Get-LocalUser -Name $name -ErrorAction SilentlyContinue) { Remove-LocalUser -Name $name }
  New-LocalUser -Name $name -Password $pw -AccountNeverExpires -Description 'TDH CI throwaway' | Out-Null
  $script:made += $name
}
function Prove([bool]$wantOk, [string]$why) {
  $out = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $server 'prove-secure-folders.ps1') -Root $Root 2>&1 | Out-String
  $ok = $LASTEXITCODE -eq 0 -and $out -match 'SECURE_FOLDERS_PROVE_OK=1'
  if ($ok -ne $wantOk) { Write-Output $out; throw ('expected ' + $(if ($wantOk) { 'pass' } else { 'failure' }) + ': ' + $why) }
  Write-Output ('PROVE_' + $(if ($ok) { 'PASS' } else { 'FAIL' }) + ' as expected: ' + $why + ' (' + (($out -split "`n" | Where-Object { $_ -match '^CHECKS=' }) -join '').Trim() + ')')
}
function Apply([string]$why) {
  $out = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $server 'secure-folders.ps1') -Root $Root -Apply 2>&1 | Out-String
  if ($LASTEXITCODE -ne 0 -or $out -notmatch 'SECURE_FOLDERS_OK=1') { Write-Output $out; throw ('apply failed: ' + $why) }
  return [int](([regex]::Match($out, 'CHANGES=(\d+)')).Groups[1].Value)
}

try {
  foreach ($p in $people) { if ($p.login -ne 'bob') { New-Account ('smb-' + $p.login) } }
  New-Account 'dshshare'
  # The layout an install makes, with something in every folder that matters.
  foreach ($d in 'runtime', 'brain\10-l0', 'company\_handbook\_company', 'company\_shared\_memory', 'company\_office', 'company\_skills', 'company\content') {
    New-Item -ItemType Directory -Force -Path (Join-Path $Root $d) | Out-Null
  }
  Set-Content -LiteralPath (Join-Path $Root 'runtime\gateway.env') -Value 'XAI_API_KEY=not-a-key'
  Set-Content -LiteralPath (Join-Path $Root 'brain\10-l0\day.md') -Value 'raw'
  Set-Content -LiteralPath (Join-Path $Company '_handbook\_company\rules.md') -Value 'rules'
  $roster = @{ people = @() ; depts = @(@{ id = 'ops' }, @{ id = 'sales' }) }
  foreach ($p in $people) {
    $personal = Join-Path $Company ('emp-' + $p.login)
    New-Item -ItemType Directory -Force -Path (Join-Path $personal '.dsh-desk\sessions') | Out-Null
    Set-Content -LiteralPath (Join-Path $personal '.dsh-desk\sessions\s1.jsonl') -Value 'conversation'
    $roster.people += @{ login = $p.login; role = $p.role; dept = $p.dept; status = 'active'; personal = $personal }
  }
  [IO.File]::WriteAllText((Join-Path $Root 'runtime\roster.json'), ($roster | ConvertTo-Json -Depth 5), [Text.UTF8Encoding]::new($false))
  # 1. As old installs left it.
  & icacls.exe $Company /grant '*S-1-1-0:(OI)(CI)M' /T /C /Q | Out-Null
  & icacls.exe (Join-Path $Root 'runtime') /grant '*S-1-5-11:(OI)(CI)M' /T /C /Q | Out-Null
  Prove $false 'a share open to Everyone, runtime open to Authenticated Users'

  # 2. Taken over, proven, and stable.
  $n = Apply 'first'
  if ($n -lt 1) { throw 'first apply changed nothing' }
  Prove $true 'after secure-folders'
  $n = Apply 'second'
  if ($n -ne 0) { throw ('second apply changed ' + $n + ' things') }
  Write-Output 'SECOND_APPLY_CHANGES=0'

  # 3. The regression this guards against.
  & icacls.exe $Company /grant '*S-1-1-0:(OI)(CI)M' /T /C /Q | Out-Null
  Prove $false 'someone granted Everyone again'
  Apply 'repair' | Out-Null
  Prove $true 'repaired'

  # 4. bob signs in once: his own account exists, dshshare loses his folder.
  New-Account 'smb-bob'
  Apply 'bob moved' | Out-Null
  Prove $true 'everyone on an own account'

  # 5. As SYSTEM, the way people-api and the nightly task run it: same answer, nothing to change.
  # (Run as SYSTEM, an older version saw no local administrators and took them off runtime.)
  $task = 'tdh-ci-secure-folders'
  $log = Join-Path $Root 'system-run.log'
  $act = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ('-NoProfile -ExecutionPolicy Bypass -Command "& ''' + (Join-Path $server 'secure-folders.ps1') + ''' -Root ''' + $Root + ''' -Apply *> ''' + $log + '''"')
  Register-ScheduledTask -TaskName $task -Action $act -Principal (New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest) -Force | Out-Null
  Start-ScheduledTask -TaskName $task
  for ($i = 0; $i -lt 300; $i++) { Start-Sleep 1; if ((Get-ScheduledTask -TaskName $task).State -ne 'Running') { break } }
  Unregister-ScheduledTask -TaskName $task -Confirm:$false
  $sys = Get-Content -LiteralPath $log -Raw
  if ($sys -notmatch 'SECURE_FOLDERS_OK=1' -or $sys -notmatch 'CHANGES=0') { Write-Output $sys; throw 'as SYSTEM, secure-folders wanted changes the administrator run did not' }
  Write-Output 'SYSTEM_RUN_CHANGES=0'
  Prove $true 'after the SYSTEM run'
  Write-Output 'SECURE_FOLDERS_CI_OK=1'
} finally {
  foreach ($u in $made) { Remove-LocalUser -Name $u -ErrorAction SilentlyContinue }
  if (Test-Path -LiteralPath $Root) { & icacls.exe $Root /reset /T /C /Q 2>&1 | Out-Null; Remove-Item -LiteralPath $Root -Recurse -Force -ErrorAction SilentlyContinue }
}
