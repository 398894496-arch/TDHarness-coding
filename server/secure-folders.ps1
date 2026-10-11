# Who can open what on the company share, and who can read the server's own folders.
# The knowledge search already answers each person by role and department; this makes the
# files themselves agree, so nobody reads around the search (or writes into the handbook
# that everyone's agent trusts).
#
# Company share (D:\dsh\company), from the roster, one Windows account per person (smb-<login>):
#   root, _skills, _control, content    everyone reads, admins change
#   _handbook (and _handbook\_company)  everyone reads, admins change
#   _handbook\<dept>                    that department reads, its director and admins change
#   _shared (company memory)            everyone reads, admins and directors change
#   _office                             admins
#   each person's folder (personal) and content\emp-<login>: the person changes, the
#     director of their department reads, admins change. Raw conversations (.dsh-desk),
#     personal memory (_memory) and task deliverables (tasks\) live there.
# Folders get SYSTEM and Administrators full control and no inherited entries; what is
# below them inherits. Access-based enumeration hides folders a person cannot open.
# Until a person has signed in once with their own account their desk still mounts as
# dshshare. dshshare stands in for those people as themselves only (their own folder, what
# everyone reads), never for a role: an admin or director still on dshshare does not lend
# it their reach, so each person who moves to their own account is shut off from dshshare
# at once. dshshare loses everything when every active person has an own account
# (smb-accounts.ps1 -RotateShared then retires its password).
#
# Server folders D:\dsh\runtime (keys, tokens, passwords) and D:\dsh\brain (raw
# conversations): SYSTEM, Administrators and each local administrator by name (an
# administrator's unelevated programs do not carry the Administrators group).
#
#   -Report   what would change (default)
#   -Apply    change it; the first change of a run saves the share's current ACLs to
#             runtime\acl-backup-<time>.txt (icacls D:\dsh\company /restore <file> undoes it)
# people-api.py runs -Apply after sign-ins that create an account and after people changes;
# setup-server.ps1 runs it at install; the task TDH-Secure-Folders runs it every night.
# Keep this file ASCII: Windows PowerShell 5.1 reads BOM-less UTF-8 as the ANSI code page.
param([string]$Root = 'D:\dsh', [switch]$Report, [switch]$Apply, [switch]$ServerOnly)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new()
$Company = Join-Path $Root 'company'
$Runtime = Join-Path $Root 'runtime'
$SID_SYSTEM = 'S-1-5-18'
$SID_ADMINS = 'S-1-5-32-544'
$RIGHTS = @{ 'F' = 0x1F01FF; 'M' = 0x1301BF; 'R' = 0x1200A9 }
$RANK = @{ 'R' = 1; 'M' = 2; 'F' = 3 }

function Sid-Of([string]$name) {
  $u = Get-LocalUser -Name $name -ErrorAction SilentlyContinue
  if ($u -and $u.Enabled) { return $u.SID.Value }
  return $null
}

# path -> @{ sid -> letter }
$rules = [ordered]@{}
function Grant([string]$path, [string]$sid, [string]$letter) {
  if (-not $sid) { return }
  $key = [IO.Path]::GetFullPath($path).TrimEnd('\')
  if (-not $rules.Contains($key)) { $rules[$key] = @{} }
  $have = $rules[$key][$sid]
  if (-not $have -or $RANK[$letter] -gt $RANK[$have]) { $rules[$key][$sid] = $letter }
}

# ---- who ----
$changed = 0
if (-not $ServerOnly) {
  $roster = Get-Content -LiteralPath (Join-Path $Runtime 'roster.json') -Raw -Encoding UTF8 | ConvertFrom-Json
  $people = @($roster.people | Where-Object { $_ -and $_.login -and ((-not $_.status) -or $_.status -eq 'active') })
  $stand = Sid-Of 'dshshare'
  $own = @{}    # login -> their own account, for anything their role gives
  $seat = @{}   # login -> what their desk mounts as today, for their own folder and reading
  $missing = @()
  foreach ($p in $people) {
    $s = Sid-Of ('smb-' + $p.login)
    if (-not $s) { $missing += [string]$p.login }
    $own[[string]$p.login] = $s
    $seat[[string]$p.login] = $(if ($s) { $s } else { $stand })
  }
  $staff = @($seat.Values | Where-Object { $_ } | Select-Object -Unique)
  $admins = @($people | Where-Object { $_.role -eq 'admin' } | ForEach-Object { $own[[string]$_.login] } | Where-Object { $_ } | Select-Object -Unique)
  $directors = @($people | Where-Object { $_.role -eq 'director' } | ForEach-Object { $own[[string]$_.login] } | Where-Object { $_ } | Select-Object -Unique)
  $depts = @(@($roster.depts | ForEach-Object { [string]$_.id }) + @($people | ForEach-Object { [string]$_.dept }) | Where-Object { $_ -and $_ -ne 'company' -and $_ -ne '*' -and $_ -match '^[A-Za-z0-9._-]+$' } | Select-Object -Unique)
  Write-Output ('PEOPLE=' + $people.Count + ' OWN_ACCOUNT=' + ($people.Count - $missing.Count) + ' VIA_DSHSHARE=' + ($missing -join ','))

  # ---- what ----
  foreach ($d in @($Company, (Join-Path $Company '_skills'), (Join-Path $Company '_control'), (Join-Path $Company 'content'), (Join-Path $Company '_handbook'))) {
    foreach ($s in $staff) { Grant $d $s 'R' }
    foreach ($s in $admins) { Grant $d $s 'M' }
  }
  $shared = Join-Path $Company '_shared'
  foreach ($s in $staff) { Grant $shared $s 'R' }
  foreach ($s in @($admins + $directors)) { Grant $shared $s 'M' }
  foreach ($s in $admins) { Grant (Join-Path $Company '_office') $s 'M' }
  foreach ($d in $depts) {
    $hb = Join-Path $Company ('_handbook\' + $d)
    foreach ($p in ($people | Where-Object { $_.dept -eq $d })) {
      Grant $hb $seat[[string]$p.login] 'R'
      if ($p.role -eq 'director') { Grant $hb $own[[string]$p.login] 'M' }
    }
    foreach ($s in $admins) { Grant $hb $s 'M' }
  }
  $companyFull = [IO.Path]::GetFullPath($Company).TrimEnd('\')
  foreach ($p in $people) {
    $login = [string]$p.login
    $mine = $seat[$login]
    $dirs = @()
    $personal = [string]$p.personal
    if ($personal) {
      $full = [IO.Path]::GetFullPath($personal.Replace('/', '\')).TrimEnd('\')
      if ($full.StartsWith($companyFull + '\', [StringComparison]::OrdinalIgnoreCase) -and ($full.Substring($companyFull.Length + 1) -notmatch '^(_shared|_handbook|_skills|_control|content)$')) { $dirs += $full }
    } else {
      $dirs += (Join-Path $Company ('emp-' + $login))
    }
    $dirs += (Join-Path $Company ('content\emp-' + $login))
    $bosses = @($people | Where-Object { $_.role -eq 'director' -and $_.dept -eq $p.dept -and $_.login -ne $login } | ForEach-Object { $own[[string]$_.login] } | Where-Object { $_ })
    foreach ($d in $dirs) {
      Grant $d $mine 'M'
      foreach ($s in $bosses) { Grant $d $s 'R' }
      foreach ($s in $admins) { Grant $d $s 'M' }
    }
  }
}

# ---- server folders ----
$localAdmins = @(Get-LocalGroupMember -SID $SID_ADMINS -ErrorAction SilentlyContinue | Where-Object { $_.PrincipalSource -eq 'Local' -and $_.ObjectClass -eq 'User' } | ForEach-Object { $_.SID.Value })
$serverDirs = @($Runtime, (Join-Path $Root 'brain'))
foreach ($d in $serverDirs) { foreach ($s in $localAdmins) { Grant $d $s 'F' } }
foreach ($d in $serverDirs) { if (-not $rules.Contains([IO.Path]::GetFullPath($d).TrimEnd('\'))) { $rules[[IO.Path]::GetFullPath($d).TrimEnd('\')] = @{} } }

# ---- compare and apply ----
function Current([string]$path) {
  $acl = Get-Acl -LiteralPath $path
  $set = @{}
  foreach ($r in $acl.Access) {
    if ($r.IsInherited) { continue }
    $sid = try { $r.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value } catch { [string]$r.IdentityReference }
    if ($r.AccessControlType -ne 'Allow' -or $r.InheritanceFlags -ne 'ContainerInherit, ObjectInherit' -or $r.PropagationFlags -ne 'None') { $set[$sid + ':?'] = 1; continue }
    $mask = [int]$r.FileSystemRights
    $letter = ($RIGHTS.Keys | Where-Object { $RIGHTS[$_] -eq $mask } | Select-Object -First 1)
    if (-not $letter) { $letter = '?' }
    $set[$sid + ':' + $letter] = 1
  }
  return @{ protected = $acl.AreAccessRulesProtected; set = (@($set.Keys | Sort-Object) -join ',') }
}

$backedUp = $false
$sorted = @($rules.Keys | Sort-Object { $_.Length })
foreach ($path in $sorted) {
  $want = @{}
  $want[$SID_SYSTEM + ':F'] = 1
  $want[$SID_ADMINS + ':F'] = 1
  foreach ($k in $rules[$path].Keys) { if ($k -ne $SID_SYSTEM -and $k -ne $SID_ADMINS) { $want[$k + ':' + $rules[$path][$k]] = 1 } }
  $wantSet = (@($want.Keys | Sort-Object) -join ',')
  $exists = Test-Path -LiteralPath $path
  $cur = if ($exists) { Current $path } else { @{ protected = $false; set = '' } }
  if ($exists -and $cur.protected -and $cur.set -eq $wantSet) { continue }
  $changed++
  $label = $path.Replace($Root, '<root>')
  Write-Output ('CHANGE ' + $label + $(if (-not $exists) { ' (create)' } elseif (-not $cur.protected) { ' (stop inheriting, reset what is below)' } else { '' }) + ' -> ' + (@($rules[$path].Keys | ForEach-Object { $rules[$path][$_] + ':' + $_ }) -join ' '))
  if (-not $Apply) { continue }
  if (-not $backedUp -and $path.StartsWith($Company, [StringComparison]::OrdinalIgnoreCase) -and (Test-Path -LiteralPath $Company)) {
    $bak = Join-Path $Runtime ('acl-backup-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.txt')
    & icacls.exe $Company /save $bak /T /C /Q | Out-Null
    Write-Output ('ACL_BACKUP=' + $bak)
    $backedUp = $true
  }
  if (-not $exists) { New-Item -ItemType Directory -Force -Path $path | Out-Null }
  # Parentheses: in PowerShell the comma binds tighter than +.
  $grants = @(('*' + $SID_SYSTEM + ':(OI)(CI)F'), ('*' + $SID_ADMINS + ':(OI)(CI)F'))
  foreach ($k in $rules[$path].Keys) { if ($k -ne $SID_SYSTEM -and $k -ne $SID_ADMINS) { $grants += ('*' + $k + ':(OI)(CI)' + $rules[$path][$k]) } }
  $grants = @($grants | ForEach-Object { $_ -replace ':\(OI\)\(CI\)R$', ':(OI)(CI)RX' })
  # One grant per call: Windows PowerShell 5.1 hands an array to icacls as one argument.
  & icacls.exe $path /reset /Q | Out-Null
  foreach ($g in $grants) {
    & icacls.exe $path /grant:r $g /Q | Out-Null
    if ($LASTEXITCODE) { throw ('icacls-failed ' + $label + ' ' + $g) }
  }
  & icacls.exe $path /inheritance:r /Q | Out-Null
  if ($LASTEXITCODE) { throw ('icacls-failed ' + $label + ' inheritance') }
  # The first time a folder is taken over, what is below it may still carry entries of its
  # own (an older install granted Everyone file by file): make it all inherit again. Folders
  # with their own rule further down lose theirs here and get it back on their turn: the
  # list runs shortest path first, and each is compared when its turn comes.
  if (-not $cur.protected -and $exists) {
    & icacls.exe (Join-Path $path '*') /reset /T /C /Q 2>&1 | Out-Null
  }
}

if (-not $ServerOnly) {
  $share = Get-SmbShare -Name 'dsh-company' -ErrorAction SilentlyContinue
  if ($share -and $share.FolderEnumerationMode -ne 'AccessBased') {
    $changed++
    Write-Output 'CHANGE share dsh-company: hide folders a person cannot open (access-based enumeration)'
    if ($Apply) { Set-SmbShare -Name 'dsh-company' -FolderEnumerationMode AccessBased -Force }
  }
}
Write-Output ('CHANGES=' + $changed)
if ($Apply) { Write-Output 'SECURE_FOLDERS_OK=1' } else { Write-Output 'REPORT_ONLY=1 (pass -Apply to change)' }
