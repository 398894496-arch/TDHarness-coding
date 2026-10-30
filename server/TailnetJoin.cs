using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Net.Sockets;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;

// 公司加密网络（Tailscale）入网。员工电脑装好 Tailscale、用站点的员工入网密钥加入公司 tailnet 后，
// 在家也能连 Site.Host（站点名经 tailnet 的分域 DNS 解析到服务器，见 docs/SERVER.md「远程使用」）。
// 站点的三样东西由发布脚本放进 Windows 包的 vendor\（安装器的远程版里作为内嵌资源）：
//   company-tailnet.txt  ip=<服务器的 tailnet 地址>、node=<服务器的设备名>
//   employee.auth        员工入网密钥（tskey-auth-…）
//   tailscale-setup.msi  官方安装包
// 安装和 `tailscale up` 都要管理员权限：由 TDHarness.exe / 安装器以 --ts-join 自己提权运行一次。
// 已经在公司 tailnet 里的电脑绝不再 up --reset（那会换掉它的地址；服务器自己也装着客户端）。
// AppHost.cs、SetupStub.cs 和 scripts/prove-tailnet-join.ps1 共用这份代码。
internal static class TailnetJoin
{
    internal sealed class Facts
    {
        public string Ip = "";
        public string Node = "";
        public bool Valid { get { return Regex.IsMatch(Ip ?? "", @"^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d{1,3}\.\d{1,3}$"); } }
    }

    internal static Facts ParseFacts(string text)
    {
        var f = new Facts();
        foreach (var raw in (text ?? "").Replace("\r", "").Split('\n'))
        {
            var line = raw.Trim();
            var eq = line.IndexOf('=');
            if (line.Length == 0 || line[0] == '#' || eq <= 0) continue;
            var k = line.Substring(0, eq).Trim().ToLowerInvariant();
            var v = line.Substring(eq + 1).Trim();
            if (k == "ip") f.Ip = v;
            else if (k == "node") f.Node = v;
        }
        return f;
    }

    internal static Facts ReadFacts(string path)
    {
        try { return File.Exists(path) ? ParseFacts(File.ReadAllText(path)) : new Facts(); }
        catch { return new Facts(); }
    }

    internal static string ReadKey(string path)
    {
        try
        {
            if (!File.Exists(path)) return "";
            var line = File.ReadAllText(path).Trim();
            var nl = line.IndexOf('\n');
            if (nl >= 0) line = line.Substring(0, nl).Trim();
            return line.StartsWith("tskey-", StringComparison.Ordinal) ? line : "";
        }
        catch { return ""; }
    }

    internal static string FindTailscale()
    {
        foreach (var root in new[] { Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), Environment.GetEnvironmentVariable("ProgramW6432"), Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86) })
        {
            if (string.IsNullOrEmpty(root)) continue;
            var p = Path.Combine(root, "Tailscale", "tailscale.exe");
            if (File.Exists(p)) return p;
        }
        return null;
    }

    // `tailscale status --json` 的输出里：后端在跑，且公司服务器的地址出现（是自己或在对端里），就算在公司网络里。
    internal static bool StatusOnCompany(string json, Facts f)
    {
        if (string.IsNullOrEmpty(json) || f == null || !f.Valid) return false;
        if (!Regex.IsMatch(json, "\"BackendState\"\\s*:\\s*\"Running\"")) return false;
        return json.IndexOf("\"" + f.Ip + "\"", StringComparison.Ordinal) >= 0;
    }

    internal static bool OnCompany(string ts, Facts f)
    {
        if (ts == null || f == null || !f.Valid) return false;
        string so, se;
        if (Run(ts, "status --json", 15000, out so, out se) < 0) return false;
        return StatusOnCompany(so, f);
    }

    internal static bool SiteReachable(string host, int port, int ms)
    {
        try
        {
            using (var c = new TcpClient())
            {
                var ar = c.BeginConnect(host, port, null, null);
                return ar.AsyncWaitHandle.WaitOne(ms) && c.Connected;
            }
        }
        catch { return false; }
    }

    // 设备名：计算机名里的字母数字和 -，小写，最多 40 个字。
    internal static string HostName(string computer)
    {
        var s = Regex.Replace((computer ?? "").ToLowerInvariant(), "[^a-z0-9-]+", "-").Trim('-');
        if (s.Length > 40) s = s.Substring(0, 40).Trim('-');
        return s.Length == 0 ? "tdh-desk" : s;
    }

    // 以管理员身份执行（需要已经是管理员）：没装就装，已在公司网络就什么都不做，否则入网并等到连上。
    // 返回 0 = 已在公司网络；其他 = 失败（日志里有原因）。
    internal static int Join(string msi, string keyFile, Facts f, Action<string> log)
    {
        if (log == null) log = delegate { };
        if (f == null || !f.Valid) { log("ts-join no-facts"); return 2; }
        var ts = FindTailscale();
        if (ts == null)
        {
            if (string.IsNullOrEmpty(msi) || !File.Exists(msi)) { log("ts-join no-msi"); return 3; }
            string o, e;
            var rc = Run(Path.Combine(Environment.SystemDirectory, "msiexec.exe"), "/i \"" + msi + "\" /qn /norestart TS_UNATTENDEDMODE=always TS_NOLAUNCH=yes", 300000, out o, out e);
            log("ts-join msi rc=" + rc);
            for (var i = 0; i < 30 && ts == null; i++) { Thread.Sleep(1000); ts = FindTailscale(); }
            if (ts == null) { log("ts-join msi-no-cli"); return 4; }
            // 服务刚装好要几秒才能接命令
            for (var i = 0; i < 20; i++) { string a, b; if (Run(ts, "version", 8000, out a, out b) == 0) break; Thread.Sleep(1000); }
        }
        if (OnCompany(ts, f)) { log("ts-join already-company"); return 0; }
        var key = ReadKey(keyFile);
        if (key.Length == 0) { log("ts-join no-key"); return 5; }
        var tmp = Path.Combine(Path.GetTempPath(), "tdh-ts-" + Guid.NewGuid().ToString("N").Substring(0, 8) + ".key");
        try
        {
            File.WriteAllText(tmp, key);
            string o, e;
            var rc = Run(ts, "up --auth-key=file:\"" + tmp + "\" --unattended --accept-dns=true --accept-routes=false --hostname=" + HostName(Environment.MachineName) + " --reset --timeout=90s", 120000, out o, out e);
            log("ts-join up rc=" + rc + " " + Tail(e));
        }
        finally
        {
            try { if (File.Exists(tmp)) File.Delete(tmp); } catch { }
        }
        for (var i = 0; i < 30; i++)
        {
            if (OnCompany(ts, f)) { log("ts-join ok"); return 0; }
            Thread.Sleep(1000);
        }
        log("ts-join not-on-company");
        return 6;
    }

    // 以管理员身份启动自己（弹 Windows 的「是否允许」）。员工点「否」返回 -1223。
    internal static int RunElevated(string exe, string args, int waitMs, Action<string> log)
    {
        var psi = new ProcessStartInfo();
        psi.FileName = exe;
        psi.Arguments = args;
        psi.UseShellExecute = true;
        psi.Verb = "runas";
        psi.WindowStyle = ProcessWindowStyle.Hidden;
        try
        {
            using (var p = Process.Start(psi))
            {
                if (p == null) return -1;
                if (!p.WaitForExit(waitMs)) { if (log != null) log("ts-elevated timeout"); return -2; }
                return p.ExitCode;
            }
        }
        catch (Win32Exception ex)
        {
            if (log != null) log("ts-elevated " + ex.NativeErrorCode);
            return ex.NativeErrorCode == 1223 ? -1223 : -1;
        }
        catch (Exception ex)
        {
            if (log != null) log("ts-elevated " + ex.Message);
            return -1;
        }
    }

    private static string Tail(string s)
    {
        s = (s ?? "").Replace("\r", " ").Replace("\n", " ").Trim();
        // 输出里不会有密钥（走的是文件），保险起见再遮一下
        s = Regex.Replace(s, "tskey-[A-Za-z0-9-]+", "tskey-***");
        return s.Length > 200 ? s.Substring(s.Length - 200) : s;
    }

    internal static int Run(string file, string args, int ms, out string stdout, out string stderr)
    {
        stdout = "";
        stderr = "";
        var psi = new ProcessStartInfo();
        psi.FileName = file;
        psi.Arguments = args;
        psi.UseShellExecute = false;
        psi.CreateNoWindow = true;
        psi.RedirectStandardInput = true;
        psi.RedirectStandardOutput = true;
        psi.RedirectStandardError = true;
        psi.StandardOutputEncoding = Encoding.UTF8;
        psi.StandardErrorEncoding = Encoding.UTF8;
        var so = new StringBuilder();
        var se = new StringBuilder();
        try
        {
            using (var p = new Process())
            {
                p.StartInfo = psi;
                p.OutputDataReceived += delegate(object s, DataReceivedEventArgs e) { if (e.Data != null) lock (so) so.AppendLine(e.Data); };
                p.ErrorDataReceived += delegate(object s, DataReceivedEventArgs e) { if (e.Data != null) lock (se) se.AppendLine(e.Data); };
                if (!p.Start()) return -1;
                try { p.StandardInput.Close(); } catch { }
                p.BeginOutputReadLine();
                p.BeginErrorReadLine();
                if (!p.WaitForExit(ms)) { try { p.Kill(); } catch { } return -2; }
                p.WaitForExit();
                lock (so) stdout = so.ToString();
                lock (se) stderr = se.ToString();
                return p.ExitCode;
            }
        }
        catch { return -1; }
    }
}
