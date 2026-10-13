using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;

// 挂公司盘。Windows 在一个登录会话里，对同一个服务器名只认一套账号：只要还有一条用别的账号
// 连着的连接（盘符、资源管理器留下的 IPC$ 或别的共享），用个人账号 net use 就报系统错误 1219，
// 而且根本不去服务器认证。原来不看 net use 的结果，旧连接能打开共享盘根目录就当挂好了，
// 个人目录按个人账号授权后打不开，员工看到的是 company-workspace-missing（2026-10-13 TDH 实测）。
// 这里先拆掉本会话里连到这台服务器的所有连接再挂，并把 net use 的结果交给调用方。
// AppHost.cs 和 scripts/prove-share-mount.ps1 共用这份代码。
internal static class ShareMount
{
    internal sealed class Result
    {
        public int Rc = -1;       // net.exe 的退出码，0 = 挂上了
        public int SysErr;        // net.exe 报的系统错误号（1219、1326…），没有就是 0
        public int Dropped;       // 挂之前拆掉的连接数
        public int Attempts;
    }

    internal const int ErrOtherCredentials = 1219;

    // \\host\share -> host
    internal static string HostOf(string unc)
    {
        if (string.IsNullOrEmpty(unc)) return "";
        var s = unc.Replace('/', '\\');
        if (!s.StartsWith("\\\\")) return "";
        s = s.Substring(2);
        var cut = s.IndexOf('\\');
        return cut < 0 ? s : s.Substring(0, cut);
    }

    private static readonly Regex UncToken = new Regex(@"\\\\([^\\\s]+)\\[^\s]+", RegexOptions.Compiled);
    private static readonly Regex DriveToken = new Regex(@"(?:^|\s)([A-Za-z]:)(?=\s)", RegexOptions.Compiled);

    // `net use` 的列表输出 -> 连到 host 的条目（有盘符给盘符，没有给远程路径）。
    // 列名随系统语言变，只认 \\host\share 和 X: 这两种记号。
    internal static List<string> ParseConnections(string listing, string host)
    {
        var found = new List<string>();
        if (string.IsNullOrEmpty(listing) || string.IsNullOrEmpty(host)) return found;
        foreach (var raw in listing.Replace("\r", "").Split('\n'))
        {
            var m = UncToken.Match(raw);
            if (!m.Success) continue;
            if (!string.Equals(m.Groups[1].Value, host, StringComparison.OrdinalIgnoreCase)) continue;
            var before = raw.Substring(0, m.Index);
            var d = DriveToken.Match(before + " ");
            var target = d.Success ? d.Groups[1].Value.ToUpperInvariant() : m.Value;
            var dup = false;
            foreach (var x in found) if (string.Equals(x, target, StringComparison.OrdinalIgnoreCase)) dup = true;
            if (!dup) found.Add(target);
        }
        return found;
    }

    // "System error 1219 has occurred." / "发生系统错误 1219。" / "發生系統錯誤 1219。"
    private static readonly Regex SysErrText = new Regex(@"(?:error|\u9519\u8bef|\u932f\u8aa4)\s*(\d{2,5})", RegexOptions.Compiled | RegexOptions.IgnoreCase);

    internal static int SystemError(string text)
    {
        if (string.IsNullOrEmpty(text)) return 0;
        var m = SysErrText.Match(text);
        int n;
        if (m.Success && int.TryParse(m.Groups[1].Value, out n)) return n;
        return 0;
    }

    // 挂 unc。user 为空时不带账号（沿用 Windows 已存的凭据）。password 不进日志。
    internal static Result Mount(string unc, string user, string pass, string drive, Action<string> log)
    {
        var r = new Result();
        var host = HostOf(unc);
        for (var attempt = 1; attempt <= 3; attempt++)
        {
            r.Attempts = attempt;
            r.Dropped += DropServer(host, unc, drive, log);
            string err;
            r.Rc = NetUse(unc, user, pass, out err);
            r.SysErr = r.Rc == 0 ? 0 : SystemError(err);
            if (log != null) log("share-netuse try=" + attempt + " rc=" + r.Rc + " err=" + r.SysErr + " dropped=" + r.Dropped);
            if (r.Rc == 0) return r;
            // 只有「还有别的账号连着」值得再拆一次再试：资源管理器开着窗口会马上把 IPC$ 连回来。
            // 密码错（1326）、账号停用（1331）、连不上（53/67）重试也一样。
            if (r.SysErr != ErrOtherCredentials) return r;
            Thread.Sleep(1000);
        }
        return r;
    }

    // 拆掉本会话里连到 host 的所有连接，返回拆了几条。/y 会关掉经它打开的文件，和原来拆 Z: 一样。
    internal static int DropServer(string host, string unc, string drive, Action<string> log)
    {
        var targets = new List<string>();
        string listing, err;
        if (Run("use", 15000, out listing, out err) == 0)
            targets.AddRange(ParseConnections(listing, host));
        int n = 0;
        foreach (var t in targets)
        {
            string o, e;
            if (Run("use \"" + t + "\" /delete /y", 8000, out o, out e) == 0) n++;
        }
        // 列表读不出来（net 卡住、输出编码异常）时也照原来的做法拆这几条。
        var fixedOnes = new List<string>();
        if (!string.IsNullOrEmpty(drive)) fixedOnes.Add(drive);
        if (!string.IsNullOrEmpty(unc)) fixedOnes.Add(unc);
        if (!string.IsNullOrEmpty(host)) fixedOnes.Add("\\\\" + host + "\\IPC$");
        foreach (var t in fixedOnes)
        {
            var seen = false;
            foreach (var x in targets) if (string.Equals(x, t, StringComparison.OrdinalIgnoreCase)) seen = true;
            if (seen) continue;
            string o, e;
            if (Run("use \"" + t + "\" /delete /y", 8000, out o, out e) == 0) n++;
        }
        if (log != null && targets.Count > 0) log("share-drop " + string.Join(",", targets.ToArray()));
        return n;
    }

    private static int NetUse(string unc, string user, string pass, out string err)
    {
        string args;
        if (string.IsNullOrEmpty(user))
            args = "use \"" + unc + "\" /persistent:yes";
        else
            args = "use \"" + unc + "\" /user:" + user + " " + pass + " /persistent:yes";
        string so;
        return Run(args, 20000, out so, out err);
    }

    // net.exe，读完输出（按 OEM 代码页），关掉 stdin：缺密码时 net 会停下来问，原来要等满 20 秒。
    internal static int Run(string args, int ms, out string stdout, out string stderr)
    {
        stdout = "";
        stderr = "";
        var psi = new ProcessStartInfo();
        psi.FileName = Path.Combine(Environment.SystemDirectory, "net.exe");
        psi.Arguments = args;
        psi.UseShellExecute = false;
        psi.CreateNoWindow = true;
        psi.RedirectStandardInput = true;
        psi.RedirectStandardOutput = true;
        psi.RedirectStandardError = true;
        try
        {
            var oem = Encoding.GetEncoding(CultureInfo.CurrentCulture.TextInfo.OEMCodePage);
            psi.StandardOutputEncoding = oem;
            psi.StandardErrorEncoding = oem;
        }
        catch { }
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
                if (!p.WaitForExit(ms))
                {
                    try { p.Kill(); } catch { }
                    return -2;
                }
                p.WaitForExit();
                lock (so) stdout = so.ToString();
                lock (se) stderr = se.ToString();
                return p.ExitCode;
            }
        }
        catch
        {
            return -1;
        }
    }
}
