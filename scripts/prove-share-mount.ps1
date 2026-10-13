# Windows (administrator, Server service running): the desk mounts the company share with the
# person's own account even when this logon session is still connected to the server as
# somebody else -- the 2026-10-13 TDH case: the desk had an IPC$ connection as dshshare, `net use`
# with smb-<login> failed with system error 1219 without ever reaching the server, the old code
# ignored the result, the share root still opened through dshshare and the person's own folder
# (granted to smb-<login> only) did not: company-workspace-missing.
#
# Compiles server\ShareMount.cs (the file TDHarness.exe is built from) with the .NET 4 csc the
# server uses, then on a throwaway share and two throwaway local accounts A and B:
#   0. parsing: `net use` listings (English and Chinese), system error numbers
#   1. a stale connection as A to the server name (IPC$ plus a drive letter)
#   2. the old mount (drop Z: and the share UNC, net use as B, ignore the result) must FAIL
#      to open B's folder: the case reproduces
#   3. ShareMount.Mount as B: net use succeeds, B's folder opens, A's stale connections are gone
#   4. a wrong password fails at once with its own error, without the 1219 retries
# Removes its share, folders and accounts at the end. Prints SHARE_MOUNT_PROVE_OK=1.
# -ParseOnly compiles and checks parsing only (for a live server: no accounts, no share).
# Keep this file ASCII: Windows PowerShell 5.1 reads BOM-less UTF-8 as the ANSI code page.
param([switch]$ParseOnly)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new()
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$server = Join-Path (Split-Path -Parent $here) 'server'
$tmpBase = if ($env:RUNNER_TEMP) { $env:RUNNER_TEMP } else { $env:TEMP }
$tag = [guid]::NewGuid().ToString('N').Substring(0, 6)
$Work = Join-Path $tmpBase ('tdh-mount-' + $tag)
New-Item -ItemType Directory -Force -Path $Work | Out-Null

$Csc = 'C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path -LiteralPath $Csc)) { $Csc = 'C:\Windows\Microsoft.NET\Framework\v4.0.30319\csc.exe' }
if (-not (Test-Path -LiteralPath $Csc)) { throw 'csc-missing' }

$driver = @'
using System;
using System.IO;
internal static class Prove
{
    private static int Fail(string why) { Console.WriteLine("FAIL " + why); return 1; }
    private static string Pass(string file) { return File.ReadAllText(file).Trim(); }
    private static int Main(string[] a)
    {
        if (a[0] == "parse")
        {
            var en = "New connections will be remembered.\r\n\r\nStatus       Local     Remote                    Network\r\n"
                + "-------------------------------------------------------------------------------\r\n"
                + "OK           Z:        \\\\tdh.local\\dsh-company      Microsoft Windows Network\r\n"
                + "Unavailable  Y:        \\\\TDH.LOCAL\\other           Microsoft Windows Network\r\n"
                + "OK                     \\\\tdh.local\\IPC$             Microsoft Windows Network\r\n"
                + "OK                     \\\\tdh.local\\a-very-long-share-name-that-wraps\r\n"
                + "                                                Microsoft Windows Network\r\n"
                + "OK           X:        \\\\otherhost\\dsh-company     Microsoft Windows Network\r\n"
                + "OK                     \\\\tdh.local.evil\\x        Microsoft Windows Network\r\n"
                + "The command completed successfully.\r\n";
            var got = string.Join(",", ShareMount.ParseConnections(en, "tdh.local").ToArray());
            var want = "Z:,Y:,\\\\tdh.local\\IPC$,\\\\tdh.local\\a-very-long-share-name-that-wraps";
            if (got != want) return Fail("parse-en got=" + got);
            var zh = "\u4f1a\u8bb0\u5f55\u65b0\u7684\u7f51\u7edc\u8fde\u63a5\u3002\r\n\r\n\u72b6\u6001       \u672c\u5730        \u8fdc\u7a0b                      \u7f51\u7edc\r\n"
                + "OK           Z:        \\\\tdh.local\\dsh-company      Microsoft Windows Network\r\n"
                + "\u5df2\u65ad\u5f00                 \\\\tdh.local\\IPC$             Microsoft Windows Network\r\n";
            got = string.Join(",", ShareMount.ParseConnections(zh, "tdh.local").ToArray());
            if (got != "Z:,\\\\tdh.local\\IPC$") return Fail("parse-zh got=" + got);
            if (ShareMount.ParseConnections("", "tdh.local").Count != 0) return Fail("parse-empty");
            if (ShareMount.SystemError("System error 1219 has occurred.\r\n\r\nMultiple connections ...") != 1219) return Fail("err-en");
            if (ShareMount.SystemError("\u53d1\u751f\u7cfb\u7edf\u9519\u8bef 1219\u3002") != 1219) return Fail("err-zh");
            if (ShareMount.SystemError("\u767c\u751f\u7cfb\u7d71\u932f\u8aa4 1326\u3002") != 1326) return Fail("err-zh-tw");
            if (ShareMount.SystemError("The network path \\\\10.1.2.3\\x was not found.") != 0) return Fail("err-no-number");
            if (ShareMount.HostOf("\\\\tdh.local\\dsh-company") != "tdh.local") return Fail("hostof");
            if (ShareMount.HostOf("//tdh.local/dsh-company") != "tdh.local") return Fail("hostof-fwd");
            Console.WriteLine("PARSE_OK=1");
            return 0;
        }
        // mount|old <unc> <user> <passfile> <folder that must open>
        var unc = a[1]; var user = a[2]; var pass = Pass(a[3]); var mine = a[4];
        if (a[0] == "old")
        {
            // AppHost.EnsureShare before 2026.10.13: drop Z: and the UNC, net use, ignore the result.
            string o, e;
            ShareMount.Run("use Z: /delete /y", 8000, out o, out e);
            ShareMount.Run("use \"" + unc + "\" /delete /y", 8000, out o, out e);
            var rc = ShareMount.Run("use \"" + unc + "\" /user:" + user + " " + pass + " /persistent:no", 20000, out o, out e);
            Console.WriteLine("OLD rc=" + rc + " err=" + ShareMount.SystemError(e) + " root=" + Directory.Exists(unc) + " mine=" + Directory.Exists(mine));
            return 0;
        }
        var r = ShareMount.Mount(unc, user, pass, "Z:", delegate(string s) { Console.WriteLine("LOG " + s); });
        Console.WriteLine("NEW rc=" + r.Rc + " err=" + r.SysErr + " tries=" + r.Attempts + " dropped=" + r.Dropped + " root=" + Directory.Exists(unc) + " mine=" + Directory.Exists(mine));
        return 0;
    }
}
'@
$driverCs = Join-Path $Work 'Prove.cs'
[IO.File]::WriteAllText($driverCs, $driver, [Text.UTF8Encoding]::new($true))
$exe = Join-Path $Work 'prove-share-mount.exe'
& $Csc /nologo /target:exe /out:$exe (Join-Path $server 'ShareMount.cs') $driverCs | Out-String | Write-Output
if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $exe)) { throw 'csc-failed' }

$parse = & $exe parse | Out-String
Write-Output $parse.Trim()
if ($parse -notmatch 'PARSE_OK=1') { throw 'parse-failed' }

$lanman = Get-Service -Name LanmanServer -ErrorAction SilentlyContinue
$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if ($ParseOnly -or -not $admin -or -not $lanman -or $lanman.Status -ne 'Running') {
  Write-Output ('SHARE_MOUNT_LIVE_SKIPPED=' + $(if ($ParseOnly) { 'parse-only' } elseif (-not $admin) { 'not-admin' } else { 'no-server-service' }))
  Remove-Item -LiteralPath $Work -Recurse -Force -ErrorAction SilentlyContinue
  Write-Output 'SHARE_MOUNT_PROVE_OK=1'
  return
}

$Host_ = $env:COMPUTERNAME
$ShareName = 'tdh-prove-' + $tag
$Root = Join-Path $Work 'company'
$userA = 'tdhpa' + $tag
$userB = 'tdhpb' + $tag
$made = @()
function New-Account([string]$name) {
  $pw = 'Pv' + [guid]::NewGuid().ToString('N').Substring(0, 16) + 'a1!'
  New-LocalUser -Name $name -Password (ConvertTo-SecureString $pw -AsPlainText -Force) -AccountNeverExpires -Description 'TDH prove throwaway' | Out-Null
  $script:made += $name
  $f = Join-Path $Work ($name + '.pass')
  [IO.File]::WriteAllText($f, $pw)
  return $f
}
function Drop-All {
  $list = ''
  try { $list = & net.exe use 2>&1 | Out-String } catch { }
  foreach ($line in ($list -split "`r?`n")) {
    if ($line -match '(?:^|\s)([A-Za-z]:)\s+\\\\' + [regex]::Escape($Host_) + '\\') { try { & net.exe use $Matches[1] /delete /y 2>&1 | Out-Null } catch { } }
    elseif ($line -match '(\\\\' + [regex]::Escape($Host_) + '\\\S+)') { try { & net.exe use $Matches[1] /delete /y 2>&1 | Out-Null } catch { } }
  }
}
function Field([string]$out, [string]$name) { return ([regex]::Match($out, '\b' + $name + '=(\S+)')).Groups[1].Value }

try {
  $passA = New-Account $userA
  $passB = New-Account $userB
  $mineB = Join-Path $Root ('emp-' + $userB)
  New-Item -ItemType Directory -Force -Path $mineB | Out-Null
  # Root: A and B read. B's folder: B only (what secure-folders.ps1 does after a move off dshshare).
  & icacls.exe $Root /inheritance:r /grant:r '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' ($userA + ':(OI)(CI)RX') ($userB + ':(OI)(CI)RX') | Out-Null
  & icacls.exe $mineB /inheritance:r /grant:r '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' ($userB + ':(OI)(CI)M') | Out-Null
  New-SmbShare -Name $ShareName -Path $Root -ChangeAccess 'Everyone' | Out-Null
  $unc = '\\' + $Host_ + '\' + $ShareName
  $mineUnc = $unc + '\emp-' + $userB
  $pwA = [IO.File]::ReadAllText($passA)

  Drop-All
  # 1. Stale connections as A: IPC$ (Explorer browsing the server) and a drive letter.
  $o = & net.exe use ('\\' + $Host_ + '\IPC$') ('/user:' + $Host_ + '\' + $userA) $pwA /persistent:no 2>&1 | Out-String
  if ($LASTEXITCODE -ne 0) { Write-Output $o; throw 'stale-ipc-failed' }
  $o = & net.exe use Y: $unc ('/user:' + $Host_ + '\' + $userA) $pwA /persistent:no 2>&1 | Out-String
  if ($LASTEXITCODE -ne 0) { Write-Output $o; throw 'stale-drive-failed' }

  # 2. The old mount must reproduce the failure.
  $old = & $exe old $unc ($Host_ + '\' + $userB) $passB $mineUnc | Out-String
  Write-Output $old.Trim()
  if ((Field $old 'err') -ne '1219') { throw 'old-mount-did-not-hit-1219 (the case did not reproduce)' }
  if ((Field $old 'mine') -ne 'False') { throw 'old-mount-opened-b-folder (the case did not reproduce)' }

  # 3. ShareMount: own account, own folder.
  # Windows PowerShell turns native stderr into a terminating error under Stop; the line may
  # report that A is still connected, which is the point.
  try { & net.exe use ('\\' + $Host_ + '\IPC$') ('/user:' + $Host_ + '\' + $userA) $pwA /persistent:no 2>&1 | Out-Null } catch { }
  $new = & $exe mount $unc ($Host_ + '\' + $userB) $passB $mineUnc | Out-String
  Write-Output $new.Trim()
  if ((Field $new 'rc') -ne '0') { throw 'new-mount-net-use-failed' }
  if ((Field $new 'mine') -ne 'True') { throw 'new-mount-cannot-open-own-folder' }
  $left = (& net.exe use) | Out-String
  if ($left -match ('Y:\s+\\\\' + [regex]::Escape($Host_) + '\\')) { throw 'stale-drive-left' }
  if ($left -match ([regex]::Escape('\\' + $Host_ + '\IPC$'))) { throw 'stale-ipc-left' }
  $who = Get-SmbSession -ErrorAction SilentlyContinue | Where-Object { $_.ClientUserName -like ('*\' + $userA) }
  Write-Output ('SESSIONS_AS_A=' + @($who).Count)

  # 4. Wrong password: its own error, one try.
  $bad = Join-Path $Work 'bad.pass'
  [IO.File]::WriteAllText($bad, 'Wrong' + $tag + 'a1!')
  Drop-All
  $wrong = & $exe mount $unc ($Host_ + '\' + $userB) $bad $mineUnc | Out-String
  Write-Output $wrong.Trim()
  if ((Field $wrong 'rc') -eq '0') { throw 'wrong-password-mounted' }
  if ((Field $wrong 'err') -eq '1219' -or (Field $wrong 'err') -eq '0') { throw 'wrong-password-error-missing' }
  if ((Field $wrong 'tries') -ne '1') { throw 'wrong-password-retried' }
  Write-Output 'SHARE_MOUNT_LIVE_OK=1'
} finally {
  try { Drop-All } catch { }
  try { Remove-SmbShare -Name $ShareName -Force -ErrorAction SilentlyContinue } catch { }
  foreach ($u in $made) { try { Remove-LocalUser -Name $u -ErrorAction SilentlyContinue } catch { } }
  try { Remove-Item -LiteralPath $Work -Recurse -Force -ErrorAction SilentlyContinue } catch { }
}
Write-Output 'SHARE_MOUNT_PROVE_OK=1'
