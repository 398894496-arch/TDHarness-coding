# Checks, account by account, what each person can actually open and change on the company
# share and on the server's own folders. It asks Windows (AuthzAccessCheck from the
# account's SID, the way a share session is judged) rather than reading the rules back, and
# it never signs in as anyone. Expectations come from roles, written out here, not from
# secure-folders.ps1:
#   everyone with an own account: reads the share root, the handbook and company memory;
#     changes their own folder; cannot read runtime or brain
#   employee: cannot change the root, the handbook or company memory; cannot open a
#     colleague's folder (raw conversations, memory, deliverables) or _office
#   director: changes company memory; reads the folders of their own department only
#   admin: changes everything on the share
#   dshshare: cannot open the folder of anyone who has an own account, nor runtime / brain
# Prints a line per failure and SECURE_FOLDERS_PROVE_OK=1 when there is none.
# Keep this file ASCII: Windows PowerShell 5.1 reads BOM-less UTF-8 as the ANSI code page.
param([string]$Root = 'D:\dsh')
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new()

Add-Type -TypeDefinition @'
using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Principal;
public static class TdhEffective {
  [StructLayout(LayoutKind.Sequential)] public struct LUID { public uint Low; public int High; }
  [StructLayout(LayoutKind.Sequential)] struct REQ { public int Desired; public IntPtr Self; public IntPtr Types; public int TypesLen; public IntPtr Opt; }
  [StructLayout(LayoutKind.Sequential)] struct REPLY { public int Len; public IntPtr Granted; public IntPtr Sacl; public IntPtr Error; }
  [DllImport("authz.dll", SetLastError = true)] static extern bool AuthzInitializeResourceManager(int f, IntPtr a, IntPtr b, IntPtr c, string n, out IntPtr rm);
  [DllImport("authz.dll", SetLastError = true)] static extern bool AuthzInitializeContextFromSid(int f, byte[] sid, IntPtr rm, IntPtr exp, LUID id, IntPtr dyn, out IntPtr ctx);
  [DllImport("authz.dll", SetLastError = true)] static extern bool AuthzAccessCheck(int f, IntPtr ctx, ref REQ req, IntPtr audit, byte[] sd, IntPtr[] opt, int optN, ref REPLY reply, IntPtr cache);
  [DllImport("authz.dll")] static extern bool AuthzFreeContext(IntPtr ctx);
  static IntPtr rm = IntPtr.Zero;
  public static int Granted(string sid, string path) {
    if (rm == IntPtr.Zero && !AuthzInitializeResourceManager(1, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, "tdh", out rm)) throw new Exception("rm " + Marshal.GetLastWin32Error());
    var s = new SecurityIdentifier(sid);
    var sb = new byte[s.BinaryLength]; s.GetBinaryForm(sb, 0);
    IntPtr ctx;
    if (!AuthzInitializeContextFromSid(0, sb, rm, IntPtr.Zero, new LUID(), IntPtr.Zero, out ctx)) throw new Exception("ctx " + Marshal.GetLastWin32Error());
    try {
      var parts = AccessControlSections.Access | AccessControlSections.Owner | AccessControlSections.Group;
      byte[] sd = Directory.Exists(path) ? new DirectorySecurity(path, parts).GetSecurityDescriptorBinaryForm() : new FileSecurity(path, parts).GetSecurityDescriptorBinaryForm();
      var req = new REQ(); req.Desired = 0x02000000;
      var reply = new REPLY(); reply.Len = 1; reply.Granted = Marshal.AllocHGlobal(4); reply.Error = Marshal.AllocHGlobal(4);
      try {
        if (!AuthzAccessCheck(0, ctx, ref req, IntPtr.Zero, sd, null, 0, ref reply, IntPtr.Zero)) throw new Exception("check " + Marshal.GetLastWin32Error());
        return Marshal.ReadInt32(reply.Granted);
      } finally { Marshal.FreeHGlobal(reply.Granted); Marshal.FreeHGlobal(reply.Error); }
    } finally { AuthzFreeContext(ctx); }
  }
}
'@

$Company = Join-Path $Root 'company'
$roster = Get-Content -LiteralPath (Join-Path $Root 'runtime\roster.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$people = @($roster.people | Where-Object { $_ -and $_.login -and ((-not $_.status) -or $_.status -eq 'active') })
function Sid-Of([string]$n) { $u = Get-LocalUser -Name $n -ErrorAction SilentlyContinue; if ($u -and $u.Enabled) { $u.SID.Value } }
function Folder($p) {
  $personal = [string]$p.personal
  if ($personal) { return [IO.Path]::GetFullPath($personal.Replace('/', '\')) }
  return (Join-Path $Company ('emp-' + $p.login))
}
$fails = 0
$checks = 0
function Expect([string]$who, [string]$sid, [string]$path, [string]$what, [bool]$want) {
  if (-not (Test-Path -LiteralPath $path)) { return }
  $script:checks++
  $g = [TdhEffective]::Granted($sid, $path)
  $bit = if ($what -eq 'read') { 0x1 } else { 0x2 }
  $have = [bool]($g -band $bit)
  if ($have -ne $want) {
    $script:fails++
    Write-Output ('FAIL ' + $who + ' ' + $(if ($want) { 'cannot' } else { 'CAN' }) + ' ' + $what + ' ' + $path.Replace($Root, '<root>') + ' (granted 0x' + $g.ToString('X') + ')')
  }
}

$withOwn = @($people | Where-Object { Sid-Of ('smb-' + $_.login) })
foreach ($p in $withOwn) {
  $sid = Sid-Of ('smb-' + $p.login)
  $who = 'smb-' + $p.login + '(' + $p.role + ')'
  $admin = $p.role -eq 'admin'
  Expect $who $sid $Company 'read' $true
  Expect $who $sid $Company 'write' $admin
  Expect $who $sid (Join-Path $Company '_handbook') 'read' $true
  Expect $who $sid (Join-Path $Company '_handbook') 'write' $admin
  Expect $who $sid (Join-Path $Company '_shared') 'read' $true
  Expect $who $sid (Join-Path $Company '_shared') 'write' ($admin -or $p.role -eq 'director')
  Expect $who $sid (Join-Path $Company '_skills') 'write' $admin
  Expect $who $sid (Folder $p) 'write' $true
  Expect $who $sid (Join-Path $Company '_office') 'read' $admin
  Expect $who $sid (Join-Path $Root 'runtime') 'read' $false
  Expect $who $sid (Join-Path $Root 'runtime\gateway.env') 'read' $false
  Expect $who $sid (Join-Path $Root 'brain') 'read' $false
  foreach ($q in $people) {
    if ($q.login -eq $p.login) { continue }
    $f = Folder $q
    if ($f.TrimEnd('\') -eq (Join-Path $Company '_office')) { continue }
    $sameDeptDirector = $p.role -eq 'director' -and $p.dept -eq $q.dept
    Expect $who $sid $f 'read' ($admin -or $sameDeptDirector)
    Expect $who $sid (Join-Path $f '.dsh-desk') 'read' ($admin -or $sameDeptDirector)
    Expect $who $sid (Join-Path $Company ('content\emp-' + $q.login)) 'read' ($admin -or $sameDeptDirector)
    Expect $who $sid $f 'write' $admin
  }
  foreach ($d in @($people | ForEach-Object { [string]$_.dept } | Where-Object { $_ -and $_ -ne 'company' } | Select-Object -Unique)) {
    Expect $who $sid (Join-Path $Company ('_handbook\' + $d)) 'read' ($admin -or $p.dept -eq $d)
  }
}
# Each local administrator by name on runtime and brain: their unelevated programs (the
# desk on this PC) do not carry the Administrators group, so Authz above cannot see this.
try {
  $users = @{}; foreach ($u in @(Get-LocalUser)) { $users[$u.SID.Value] = $u.Name }
  $gname = (New-Object Security.Principal.SecurityIdentifier 'S-1-5-32-544').Translate([Security.Principal.NTAccount]).Value.Split('\')[-1]
  $group = [ADSI]('WinNT://' + $env:COMPUTERNAME + '/' + $gname + ',group')
  $adminSids = @(@($group.psbase.Invoke('Members')) | ForEach-Object { (New-Object Security.Principal.SecurityIdentifier($_.GetType().InvokeMember('objectSid', 'GetProperty', $null, $_, $null), 0)).Value } | Where-Object { $users.ContainsKey($_) })
  foreach ($d in @((Join-Path $Root 'runtime'), (Join-Path $Root 'brain'))) {
    if (-not (Test-Path -LiteralPath $d)) { continue }
    $named = @((Get-Acl -LiteralPath $d).Access | Where-Object { -not $_.IsInherited } | ForEach-Object { try { $_.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value } catch { '' } })
    foreach ($s in $adminSids) {
      $checks++
      if ($named -notcontains $s) { $fails++; Write-Output ('FAIL local administrator ' + $users[$s] + ' is not named on ' + $d.Replace($Root, '<root>')) }
    }
  }
} catch { Write-Output ('NOTE local administrators not checked: ' + $_.Exception.Message) }

$ds = Sid-Of 'dshshare'
if ($ds) {
  foreach ($p in $withOwn) {
    $f = Folder $p
    if ($f.TrimEnd('\') -eq (Join-Path $Company '_office')) { $f = Join-Path $Company '_office' }
    Expect 'dshshare' $ds $f 'read' $false
  }
  # Desks still mounting as dshshare keep working on their own folder until they sign in again.
  foreach ($p in ($people | Where-Object { -not (Sid-Of ('smb-' + $_.login)) })) {
    $f = Folder $p
    if ($f.TrimEnd('\') -eq (Join-Path $Company '_office')) { continue }
    Expect ('dshshare-for-' + $p.login) $ds $f 'write' $true
    Expect ('dshshare-for-' + $p.login) $ds (Join-Path $f '.dsh-desk') 'write' $true
  }
  # dshshare reads what everyone reads only while someone still mounts as it; then nothing.
  $stillOn = @($people | Where-Object { -not (Sid-Of ('smb-' + $_.login)) }).Count -gt 0
  Expect 'dshshare' $ds (Join-Path $Company '_handbook') 'read' $stillOn
  Expect 'dshshare' $ds $Company 'read' $stillOn
  Expect 'dshshare' $ds (Join-Path $Root 'runtime') 'read' $false
  Expect 'dshshare' $ds (Join-Path $Root 'brain') 'read' $false
  Expect 'dshshare' $ds $Company 'write' $false
  Expect 'dshshare' $ds (Join-Path $Company '_handbook') 'write' $false
  Expect 'dshshare' $ds (Join-Path $Company '_shared') 'write' $false
}
Write-Output ('CHECKS=' + $checks + ' FAILS=' + $fails + ' PEOPLE_WITH_OWN_ACCOUNT=' + $withOwn.Count)
if ($fails -eq 0) { Write-Output 'SECURE_FOLDERS_PROVE_OK=1' } else { exit 1 }
