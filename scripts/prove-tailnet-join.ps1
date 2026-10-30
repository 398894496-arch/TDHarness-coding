# Windows CI: the company-tailnet join logic shared by TDHarness.exe and Setup.exe (server\TailnetJoin.cs),
# compiled with the .NET 4 csc the server uses, without a network or Tailscale:
#   site facts (ip/node) and which addresses count as a tailnet address; the join key file
#   "on the company tailnet" from `tailscale status --json`: running AND the server's address listed,
#     never a prefix match (100.101.102.10 is not 100.101.102.103), never when stopped
#   the device name taken from the computer name
# The real join is proved end to end by scripts\e2e-remote-setup.ps1 (workflow tailnet-e2e).
# Prints TAILNET_JOIN_PROVE_OK=1.
# Keep this file ASCII: Windows PowerShell 5.1 reads BOM-less UTF-8 as the ANSI code page.
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$server = Join-Path (Split-Path -Parent $here) 'server'
$tmpBase = if ($env:RUNNER_TEMP) { $env:RUNNER_TEMP } else { $env:TEMP }
$Work = Join-Path $tmpBase ('tdh-tsprove-' + [guid]::NewGuid().ToString('N').Substring(0, 6))
New-Item -ItemType Directory -Force -Path $Work | Out-Null
$Csc = 'C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path -LiteralPath $Csc)) { $Csc = 'C:\Windows\Microsoft.NET\Framework\v4.0.30319\csc.exe' }

$driver = @'
using System;
using System.IO;
internal static class Prove
{
    private static int fails;
    private static void Is(bool ok, string what) { if (!ok) { fails++; Console.WriteLine("FAIL " + what); } }
    private static int Main(string[] a)
    {
        var f = TailnetJoin.ParseFacts("# site\r\nip=100.101.102.103\r\nnode=site-server\r\nother=x\r\n");
        Is(f.Ip == "100.101.102.103" && f.Node == "site-server" && f.Valid, "facts parse");
        Is(!TailnetJoin.ParseFacts("ip=192.168.1.5").Valid, "LAN address is not a tailnet address");
        Is(!TailnetJoin.ParseFacts("ip=100.128.0.1").Valid, "outside 100.64.0.0/10");
        Is(TailnetJoin.ParseFacts("ip=100.64.0.1").Valid && TailnetJoin.ParseFacts("ip=100.127.255.254").Valid, "edges of 100.64.0.0/10");
        Is(!TailnetJoin.ParseFacts("").Valid, "empty facts");

        var run = "{\"Version\":\"1.90\",\"BackendState\": \"Running\",\"Self\":{\"TailscaleIPs\":[\"100.90.1.2\"]},\"Peer\":{\"n\":{\"TailscaleIPs\":[\"100.101.102.103\",\"fd7a::1\"]}}}";
        Is(TailnetJoin.StatusOnCompany(run, f), "server listed as a peer");
        Is(TailnetJoin.StatusOnCompany(run.Replace("100.90.1.2", "100.101.102.103").Replace("\"100.101.102.103\",\"fd7a::1\"", "\"100.1.2.3\""), f), "this machine is the server");
        Is(!TailnetJoin.StatusOnCompany(run.Replace("Running", "Stopped"), f), "stopped is not on the tailnet");
        Is(!TailnetJoin.StatusOnCompany(run.Replace("Running", "NeedsLogin"), f), "logged out is not on the tailnet");
        Is(!TailnetJoin.StatusOnCompany(run.Replace("100.101.102.103", "100.101.102.10"), f), "no prefix match");
        Is(!TailnetJoin.StatusOnCompany(run.Replace("100.101.102.103", "100.101.102.1030"), f), "no longer-number match");
        Is(!TailnetJoin.StatusOnCompany("", f) && !TailnetJoin.StatusOnCompany(run, new TailnetJoin.Facts()), "no status or no facts");

        Is(TailnetJoin.HostName("DESKTOP-AB12CD") == "desktop-ab12cd", "host name lower");
        Is(TailnetJoin.HostName("Zhang San's PC") == "zhang-san-s-pc", "host name cleaned");
        Is(TailnetJoin.HostName("\u5f20\u4e09") == "tdh-desk", "non-ASCII name falls back");
        Is(TailnetJoin.HostName(new string('a', 60)).Length == 40, "host name capped");

        var k = Path.Combine(a[0], "k.auth");
        File.WriteAllText(k, "tskey-auth-abc123-XYZ\r\n");
        Is(TailnetJoin.ReadKey(k) == "tskey-auth-abc123-XYZ", "key read");
        File.WriteAllText(k, "not-a-key");
        Is(TailnetJoin.ReadKey(k) == "", "non-key refused");
        Is(TailnetJoin.ReadKey(Path.Combine(a[0], "missing")) == "", "missing key");
        Is(TailnetJoin.ReadFacts(Path.Combine(a[0], "missing")).Valid == false, "missing facts file");

        // Join without facts never touches Tailscale
        Is(TailnetJoin.Join(null, null, new TailnetJoin.Facts(), null) == 2, "join without facts refuses");
        Console.WriteLine(fails == 0 ? "UNIT_OK=1" : "UNIT_FAILS=" + fails);
        return fails == 0 ? 0 : 1;
    }
}
'@
$drv = Join-Path $Work 'Prove.cs'
[IO.File]::WriteAllText($drv, $driver, (New-Object Text.UTF8Encoding($true)))
$exe = Join-Path $Work 'prove-tailnet.exe'
& $Csc /nologo /target:exe ('/out:' + $exe) (Join-Path $server 'TailnetJoin.cs') $drv | Out-String | Write-Output
if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $exe)) { throw 'csc-failed' }
$out = & $exe $Work | Out-String
Write-Output $out.Trim()
Remove-Item -LiteralPath $Work -Recurse -Force -ErrorAction SilentlyContinue
if ($out -notmatch 'UNIT_OK=1') { throw 'tailnet-join-unit-failed' }
Write-Output 'TAILNET_JOIN_PROVE_OK=1'
