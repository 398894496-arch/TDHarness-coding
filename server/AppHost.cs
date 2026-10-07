using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Reflection;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

[assembly: AssemblyTitle("TDHarness")]
[assembly: AssemblyDescription("The Diva local Agent")]
[assembly: AssemblyCompany("The Diva")]
[assembly: AssemblyProduct("TDHarness")]
[assembly: AssemblyVersion("1.0.0.0")]
[assembly: AssemblyFileVersion("1.0.0.0")]

internal static class AppHost
{
    internal const int DeskPort = 17803;
    internal const string ShareDrive = "Z:";

    [STAThread]
    private static int Main()
    {
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        try
        {
            ServicePointManager.ServerCertificateValidationCallback = delegate { return true; };
            try { ServicePointManager.SecurityProtocol |= (SecurityProtocolType)3072; }
            catch { }
            Application.Run(new ShellForm());
            return 0;
        }
        catch (Exception ex)
        {
            MessageBox.Show(ex.Message, "TDHarness");
            return 1;
        }
    }

    internal static string Root
    {
        get { return Path.GetDirectoryName(Application.ExecutablePath); }
    }

    // Setup 1.0.11 replaced node.exe with a wrapper that set NODE_OPTIONS
    // --require (quoted). That made `node desk-lease.js acquire` exit
    // non-zero and the login line only showed desk-lease-acquire.
    // Prefer the real binary if the wrap is still on disk.
    internal static string NodeBin()
    {
        var real = Path.Combine(Root, "node", "node-real.exe");
        if (File.Exists(real)) return real;
        return Path.Combine(Root, "node", "node.exe");
    }

    internal static void ClearChildNodeOptions(ProcessStartInfo psi)
    {
        try { psi.EnvironmentVariables.Remove("NODE_OPTIONS"); }
        catch
        {
            try { psi.EnvironmentVariables["NODE_OPTIONS"] = ""; }
            catch { }
        }
    }

    internal static string DeskHome
    {
        get
        {
            var overrideHome = Environment.GetEnvironmentVariable("DSH_DESK_HOME");
            if (!string.IsNullOrEmpty(overrideHome)) return overrideHome;
            return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), (".dsh-company-rc" + "8"), "desk-home");
        }
    }

    internal static string DeskNavigateUrl()
    {
        var bare = "http://127.0.0.1:" + DeskPort;
        var log = Path.Combine(DeskHome, "web-runtime.out");
        try
        {
            if (!File.Exists(log)) return bare;
            var lines = File.ReadAllLines(log);
            for (var i = lines.Length - 1; i >= 0; i--)
            {
                var s = lines[i];
                if (s == null || s.IndexOf("dsh web: http://127.0.0.1:") != 0) continue;
                var rest = s.Substring("dsh web: ".Length);
                var sp = rest.IndexOf(' ');
                var first = sp < 0 ? rest : rest.Substring(0, sp);
                if (first.IndexOf("http://127.0.0.1:") == 0) return first;
            }
        }
        catch { }
        return bare;
    }

    // 0.1.2 prints the token after listen. Kernel skip lets bare loopback in;
    // still wait so WebView2 can use the printed URL when it is already there.
    // The desk's own pages: this machine's loopback on the desk port.
    internal static bool IsDeskUrl(string uri)
    {
        if (string.IsNullOrEmpty(uri)) return false;
        if (uri.StartsWith("about:", StringComparison.OrdinalIgnoreCase)) return true;
        Uri u;
        if (!Uri.TryCreate(uri, UriKind.Absolute, out u)) return false;
        if (u.Scheme != Uri.UriSchemeHttp && u.Scheme != Uri.UriSchemeHttps) return false;
        var host = u.Host.ToLowerInvariant();
        return (host == "127.0.0.1" || host == "localhost") && u.Port == DeskPort;
    }

    // Web and mail links go to the system's default browser; anything else is
    // dropped (and logged) rather than handed to the shell.
    internal static void OpenOutside(string uri, string why)
    {
        Uri u;
        if (!Uri.TryCreate(uri ?? "", UriKind.Absolute, out u) ||
            (u.Scheme != Uri.UriSchemeHttp && u.Scheme != Uri.UriSchemeHttps && u.Scheme != Uri.UriSchemeMailto))
        {
            Log("open-outside-refused " + why + " " + (u != null ? u.Scheme : "bad-uri"));
            return;
        }
        try
        {
            var psi = new ProcessStartInfo(u.AbsoluteUri);
            psi.UseShellExecute = true;
            Process.Start(psi);
            Log("open-outside " + why + " " + u.Host);
        }
        catch (Exception ex) { Log("open-outside-failed " + ex.Message); }
    }

    internal static string WaitDeskNavigateUrl(int timeoutMs)
    {
        var deadline = Environment.TickCount + Math.Max(0, timeoutMs);
        var url = DeskNavigateUrl();
        // This host never writes web-runtime.out (StartDesk drains the kernel's
        // output only when it exits), so the tokened URL cannot appear. Waiting
        // for it held a blank window for the whole timeout on every open.
        if (!File.Exists(Path.Combine(DeskHome, "web-runtime.out")))
        {
            Log("desk-nav bare");
            return url;
        }
        while (url.IndexOf("?token=") < 0 && unchecked(deadline - Environment.TickCount) > 0)
        {
            Thread.Sleep(200);
            url = DeskNavigateUrl();
        }
        Log("desk-nav " + (url.IndexOf("?token=") >= 0 ? "token" : "bare"));
        return url;
    }

    internal static void CopyTree(string src, string dst)
    {
        Directory.CreateDirectory(dst);
        foreach (var dir in Directory.GetDirectories(src))
            CopyTree(dir, Path.Combine(dst, Path.GetFileName(dir)));
        foreach (var file in Directory.GetFiles(src))
        {
            var target = Path.Combine(dst, Path.GetFileName(file));
            Directory.CreateDirectory(Path.GetDirectoryName(target));
            File.Copy(file, target, true);
        }
    }

    internal static string SyncDeskHome()
    {
        var src = Path.Combine(Root, "home");
        var dest = DeskHome;
        Directory.CreateDirectory(Path.Combine(dest, "profiles", "web"));
        Directory.CreateDirectory(Path.Combine(dest, "work"));
        foreach (var name in new[] { "ext-bridge-token" })
        {
            var from = Path.Combine(src, name);
            var to = Path.Combine(dest, name);
            if (Directory.Exists(from) && !Directory.Exists(to) && !File.Exists(to))
            {
                CopyTree(from, to);
                Log("desk-home-migrate " + name);
            }
            else if (File.Exists(from) && !File.Exists(to))
            {
                File.Copy(from, to, false);
                Log("desk-home-migrate " + name);
            }
        }
        var settings = Path.Combine(src, "settings.yaml");
        if (File.Exists(settings)) File.Copy(settings, Path.Combine(dest, "settings.yaml"), true);
        var ov = Path.Combine(src, "profiles", "web", "overlay.yml");
        if (File.Exists(ov)) File.Copy(ov, Path.Combine(dest, "profiles", "web", "overlay.yml"), true);
        var pkg = Path.Combine(src, "profiles", "web", "package.json");
        if (File.Exists(pkg)) File.Copy(pkg, Path.Combine(dest, "profiles", "web", "package.json"), true);
        var nmSrc = Path.Combine(src, "profiles", "web", "node_modules");
        var nmDst = Path.Combine(dest, "profiles", "web", "node_modules");
        if (Directory.Exists(nmSrc))
        {
            if (PortUp() && Directory.Exists(nmDst))
            {
                Log("desk-home-nm-skip desk-up");
            }
            else
            {
                if (Directory.Exists(nmDst))
                {
                    try { Directory.Delete(nmDst, true); }
                    catch { }
                }
                CopyTree(nmSrc, nmDst);
            }
        }
        Log("desk-home-sync " + dest);
        return dest;
    }

    internal static void Log(string line)
    {
        try
        {
            var home = DeskHome;
            Directory.CreateDirectory(home);
            File.AppendAllText(Path.Combine(home, "app-start.log"), DateTime.Now.ToString("o") + " " + line + "\r\n");
        }
        catch
        {
            try
            {
                var home = Path.Combine(Root, "home");
                Directory.CreateDirectory(home);
                File.AppendAllText(Path.Combine(home, "app-start.log"), DateTime.Now.ToString("o") + " " + line + "\r\n");
            }
            catch { }
        }
    }

    internal static bool PortUp()
    {
        try
        {
            using (var c = new TcpClient())
            {
                var ar = c.BeginConnect("127.0.0.1", DeskPort, null, null);
                return ar.AsyncWaitHandle.WaitOne(400) && c.Connected;
            }
        }
        catch { return false; }
    }

    internal static string JsonField(string json, string key)
    {
        if (string.IsNullOrEmpty(json) || string.IsNullOrEmpty(key)) return "";
        var needle = "\"" + key + "\"";
        var i = json.IndexOf(needle);
        if (i < 0) return "";
        i = json.IndexOf(':', i + needle.Length);
        if (i < 0) return "";
        var p = i + 1;
        while (p < json.Length && char.IsWhiteSpace(json[p])) p++;
        if (p >= json.Length) return "";
        if (json[p] == '"')
        {
            p++;
            var sb = new StringBuilder();
            while (p < json.Length)
            {
                var ch = json[p++];
                if (ch == '\\' && p < json.Length)
                {
                    sb.Append(json[p++]);
                    continue;
                }
                if (ch == '"') break;
                sb.Append(ch);
            }
            return sb.ToString();
        }
        var q = p;
        while (q < json.Length && json[q] != ',' && json[q] != '}' && json[q] != ']') q++;
        return json.Substring(p, q - p).Trim();
    }

    internal static string JsonEscape(string s)
    {
        if (s == null) return "";
        return s.Replace("\\", "\\\\").Replace("\"", "\\\"");
    }

    internal static string ToSharePath(string companyPath)
    {
        if (string.IsNullOrEmpty(companyPath)) return "";
        var n = companyPath.Replace('\\', '/');
        if (n.StartsWith("Z:", StringComparison.OrdinalIgnoreCase))
        {
            var rest = n.Substring(2).TrimStart('/');
            if (rest.Length == 0) return Site.ShareUnc;
            return Site.ShareUnc + "\\" + rest.Replace('/', '\\');
        }
        var fwd = Site.ShareUncFwd;
        if (n.StartsWith(fwd, StringComparison.OrdinalIgnoreCase))
        {
            var rest = n.Substring(fwd.Length).TrimStart('/');
            if (rest.Length == 0) return Site.ShareUnc;
            return Site.ShareUnc + "\\" + rest.Replace('/', '\\');
        }
        var prefix = Site.CompanyPath;
        if (n.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
        {
            var rest = n.Substring(prefix.Length).TrimStart('/');
            if (rest.Length == 0) return Site.ShareUnc;
            return Site.ShareUnc + "\\" + rest.Replace('/', '\\');
        }
        return "";
    }

    // Same box as the share: use the local drive. Loopback UNC is the
    // path that made first-open wait on SMB and left the workspace picker empty.
    internal static string ChairPath(string companyPath)
    {
        if (string.IsNullOrEmpty(companyPath)) return "";
        var n = companyPath.Replace('/', Path.DirectorySeparatorChar);
        try
        {
            if (Directory.Exists(n)) return Path.GetFullPath(n);
        }
        catch { }
        var prefix = Site.CompanyPath;
        if (!string.IsNullOrEmpty(prefix))
        {
            var localPrefix = prefix.Replace('/', Path.DirectorySeparatorChar).TrimEnd(Path.DirectorySeparatorChar);
            if (n.StartsWith(localPrefix, StringComparison.OrdinalIgnoreCase))
            {
                try
                {
                    if (Directory.Exists(n)) return Path.GetFullPath(n);
                }
                catch { }
            }
        }
        return ToSharePath(companyPath);
    }

    internal static void EnsureShare(string smbUser, string smbPass)
    {
        for (var i = 0; i < 15; i++)
        {
            if (TcpUp(Site.Host, 445, 800)) break;
            Application.DoEvents();
            System.Threading.Thread.Sleep(1000);
        }
        var user = smbUser;
        if (!string.IsNullOrEmpty(user) && user.IndexOf('\\') < 0) user = Site.Host + "\\" + user;
        var pass = smbPass;
        if (string.IsNullOrEmpty(pass))
        {
            var passFile = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".dsh-company", ".smb-dshshare");
            if (File.Exists(passFile))
            {
                pass = File.ReadAllText(passFile).Trim();
                var nl = pass.IndexOf('\n');
                if (nl >= 0) pass = pass.Substring(0, nl).Trim();
                if (string.IsNullOrEmpty(user)) user = Site.Host + "\\" + Site.SmbUserFallback;
            }
        }
        DropDrive();
        DropShare();
        RunNetUse(Site.ShareUnc, user, pass);
        if (Directory.Exists(Site.ShareUnc))
        {
            Log("share-ok unc");
            return;
        }
        throw new Exception("company-disk-not-mounted");
    }

    private static bool TcpUp(string host, int port, int ms)
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

    private static void DropShare()
    {
        RunNetUseDelete(Site.ShareUnc);
    }

    private static void DropDrive()
    {
        RunNetUseDelete(ShareDrive);
    }

    private static void RunNetUseDrive(string drive, string unc, string user, string pass)
    {
        var psi = new ProcessStartInfo();
        psi.FileName = Path.Combine(Environment.SystemDirectory, "net.exe");
        if (string.IsNullOrEmpty(user))
            psi.Arguments = "use " + drive + " \"" + unc + "\" /persistent:yes";
        else
            psi.Arguments = "use " + drive + " \"" + unc + "\" /user:" + user + " " + pass + " /persistent:yes";
        psi.UseShellExecute = false;
        psi.CreateNoWindow = true;
        psi.RedirectStandardOutput = true;
        psi.RedirectStandardError = true;
        try
        {
            using (var p = Process.Start(psi))
            {
                if (p == null) return;
                p.WaitForExit(20000);
            }
        }
        catch { }
    }

    private static void RunNetUseDelete(string unc)
    {
        var psi = new ProcessStartInfo();
        psi.FileName = Path.Combine(Environment.SystemDirectory, "net.exe");
        psi.Arguments = "use \"" + unc + "\" /delete /y";
        psi.UseShellExecute = false;
        psi.CreateNoWindow = true;
        psi.RedirectStandardOutput = true;
        psi.RedirectStandardError = true;
        try
        {
            using (var p = Process.Start(psi))
            {
                if (p == null) return;
                p.WaitForExit(8000);
            }
        }
        catch { }
    }

    private static void RunNetUse(string unc, string user, string pass)
    {
        var psi = new ProcessStartInfo();
        psi.FileName = Path.Combine(Environment.SystemDirectory, "net.exe");
        if (string.IsNullOrEmpty(user))
            psi.Arguments = "use \"" + unc + "\" /persistent:yes";
        else
            psi.Arguments = "use \"" + unc + "\" /user:" + user + " " + pass + " /persistent:yes";
        psi.UseShellExecute = false;
        psi.CreateNoWindow = true;
        psi.RedirectStandardOutput = true;
        psi.RedirectStandardError = true;
        try
        {
            using (var p = Process.Start(psi))
            {
                if (p == null) return;
                p.WaitForExit(20000);
            }
        }
        catch { }
    }

    internal static LoginHit CheckLogin(string user, string pass)
    {
        var body = "{\"username\":\"" + JsonEscape(user) + "\",\"password\":\"" + JsonEscape(pass) + "\"}";
        var req = (HttpWebRequest)WebRequest.Create(Site.LoginUrl);
        req.Method = "POST";
        req.ContentType = "application/json; charset=utf-8";
        req.Timeout = 12000;
        var raw = Encoding.UTF8.GetBytes(body);
        req.ContentLength = raw.Length;
        using (var s = req.GetRequestStream()) s.Write(raw, 0, raw.Length);
        using (var resp = (HttpWebResponse)req.GetResponse())
        using (var sr = new StreamReader(resp.GetResponseStream(), Encoding.UTF8))
        {
            var text = sr.ReadToEnd();
            var code = (int)resp.StatusCode;
            if (code < 200 || code >= 300 || text.IndexOf("\"ok\": true") < 0)
                return null;
            var hit = new LoginHit();
            hit.Login = JsonField(text, "login");
            if (hit.Login.Length == 0) hit.Login = user;
            hit.Role = JsonField(text, "role");
            hit.Dept = JsonField(text, "dept");
            hit.Personal = ChairPath(JsonField(text, "personal"));
            hit.Org = ChairPath(JsonField(text, "org"));
            hit.TsAuth = JsonField(text, "ts_auth");
            hit.GwToken = JsonField(text, "gw_token");
            hit.SmbUser = JsonField(text, "smb_user");
            hit.SmbPass = JsonField(text, "smb_pass");
            return hit;
        }
    }

    // The sandbox mode is a function of where the workspace lives, not a constant.
    //
    // workspace-write confines the shell with a WRITE_RESTRICTED token. That token
    // cannot reach a network path AT ALL -- stat, list, read and write all return
    // EPERM. Measured on this product, with controls, across raw UNC, a mapped
    // letter, loopback and a genuinely remote share, and with extra SIDs
    // (Authenticated Users, the user's own account) added to the restricting list.
    // Nothing changed the outcome; the primitive and the SMB redirector are
    // incompatible. So on a share-hosted workspace, workspace-write does not mean
    // "confined", it means the employee has no shell at all -- that is the bug
    // where PowerShell would not start.
    //
    // danger-full-access returns before confine() is ever called
    // (dsh-pwsh-sandbox/lib/index.js:154,187), so the shell is an ordinary process
    // and the share is writable. What still bounds it is not the sandbox: SMB and
    // NTFS ACLs bound the share per person and per department, and the product
    // tree stays read-only by roster authority plus integrity check.
    //
    // Company Full Access: write the client PC and the person's chair.
    // Shared trees are read-only (NTFS + permission-rules). Employees must
    // not rewrite the sandbox. workspace-write cannot reach SMB at all.
    //
    // Two knobs have to agree, and setting only one is why this looked fixed when
    // it was not. Measured in the composed tree (dsh --dump-config):
    //   sandbox-policy.mode = !!js process.env.DSH_PERMISSION_MODE  -- deployment default
    //   permission.defaultPreset                                    -- per-session override
    // permission-presets applies its default preset on session/created as a
    // sandbox/mode event, and a session override outranks the deployment default.
    // So DSH_PERMISSION_MODE alone gets overwritten back to the preset on every new
    // session. The env var still matters: the same expression also decides the
    // approval policy. Hence both, from one value. See RewriteDefaultPreset.
    internal static string SandboxModeFor(string work)
    {
        // work is kept so launchers and prove scripts still pass the path.
        if (work == null) return "danger-full-access";
        return "danger-full-access";
    }

    // company-login-screen-update-v1
    // Already-installed: popup on the login form, BEFORE CheckLogin.
    // Do not hash the 30k-file tree here: that ran on the UI thread and
    // froze first-open for minutes. Dirty-tree is log-only anyway.
    // Newer pack on 8443 still one-click updates via version.json.
    internal static void GateProductTree()
    {
        Log("tree-check skip-on-login");
        GateServedUpdate();
    }

    internal static void RelaunchSelf()
    {
        try { Process.Start(Application.ExecutablePath); }
        catch (Exception ex) { Log("relaunch " + ex.Message); }
        Environment.Exit(0);
    }

    internal static bool BootLacksWinJunction()
    {
        var a = Path.Combine(Root, "prefix", "node_modules", "@deepseek-ai", "dsh", "node_modules", "@deepseek-ai", "dsh-app-boot", "lib", "index.js");
        var b = Path.Combine(Root, "prefix", "lib", "node_modules", "@deepseek-ai", "dsh", "node_modules", "@deepseek-ai", "dsh-app-boot", "lib", "index.js");
        var p = File.Exists(a) ? a : b;
        if (!File.Exists(p)) return false;
        try
        {
            var t = File.ReadAllText(p);
            // 0.1.7 dropped ensureSymlink. Missing "win-junction-failed"
            // is not a reason to RestoreProduct the whole zip.
            if (t.IndexOf("function ensureSymlink") < 0)
            {
                Log("junction-skip-no-ensuresymlink");
                return false;
            }
            return t.IndexOf("win-junction-failed") < 0;
        }
        catch { return false; }
    }

    internal static void GateServedUpdate()
    {
        if (BootLacksWinJunction())
        {
            Log("update-force-junction");
            try
            {
                RestoreProduct();
                RelaunchSelf();
                return;
            }
            catch (Exception ex)
            {
                Log("update-force-junction-fail " + ex.Message);
                return;
            }
        }
        var so = CheckServedUpdate();
        if (so.IndexOf("UPDATE_AVAILABLE=1") < 0) return;
        var served = "";
        var m = Regex.Match(so, @"SERVED_MARK=([0-9a-f]{32})");
        if (m.Success) served = m.Groups[1].Value;
        var dr = MessageBox.Show(
            "公司已发新版。\n\n点「是」一键更新，不用打开下载页。\n\n是 = 现在更新\n否 = 稍后再说\n取消 = 退出",
            "TDHarness",
            MessageBoxButtons.YesNoCancel,
            MessageBoxIcon.Information,
            MessageBoxDefaultButton.Button1);
        if (dr == DialogResult.Cancel) throw new Exception("update-abort");
        if (dr == DialogResult.No)
        {
            if (served.Length == 32) DeferServedUpdate(served);
            Log("update-later");
            return;
        }
        MessageBox.Show("正在下载并安装新版。", "TDHarness",
            MessageBoxButtons.OK, MessageBoxIcon.Information);
        try
        {
            RestoreProduct();
        }
        catch (Exception ex)
        {
            Log("update-restore-fail " + ex.Message);
            MessageBox.Show("更新没完成，先用现在这版登录。", "TDHarness",
                MessageBoxButtons.OK, MessageBoxIcon.Warning);
            return;
        }
        MessageBox.Show("更新完成。请重新登录。", "TDHarness",
            MessageBoxButtons.OK, MessageBoxIcon.Information);
        RelaunchSelf();
    }

    internal static string CheckServedUpdate()
    {
        var root = Root;
        var checker = Path.Combine(root, "pack-update-check.js");
        var node = NodeBin();
        var man = Path.Combine(root, "BUILD.json");
        if (!File.Exists(checker) || !File.Exists(node) || !File.Exists(man))
        {
            Log("update-skip no-checker");
            return "UPDATE_SKIP=1";
        }
        var url = Site.ZipUrl;
        var slash = url.LastIndexOf('/');
        if (slash < 0)
        {
            Log("update-skip bad-zipurl");
            return "UPDATE_SKIP=1";
        }
        url = url.Substring(0, slash + 1) + "version.json";
        var psi = new ProcessStartInfo();
        psi.FileName = node;
        psi.Arguments = "\"" + checker + "\" --root \"" + root + "\" --url \"" + url + "\"";
        psi.UseShellExecute = false;
        psi.CreateNoWindow = true;
        psi.RedirectStandardOutput = true;
        psi.RedirectStandardError = true;
        ClearChildNodeOptions(psi);
        // Read asynchronously: ReadToEnd() would wait for the child to exit and
        // the timeout below would never fire.
        var buf = new StringBuilder();
        var p = new Process();
        p.StartInfo = psi;
        p.OutputDataReceived += delegate(object sender, DataReceivedEventArgs e)
        {
            if (e.Data != null) lock (buf) { buf.AppendLine(e.Data); }
        };
        p.ErrorDataReceived += delegate(object sender, DataReceivedEventArgs e) { };
        if (!p.Start()) return "UPDATE_SKIP=1";
        p.BeginOutputReadLine();
        p.BeginErrorReadLine();
        if (!p.WaitForExit(20000))
        {
            try { p.Kill(); } catch { }
            Log("update-timeout");
            return "UPDATE_SKIP=1";
        }
        p.WaitForExit();
        string so;
        lock (buf) { so = buf.ToString(); }
        Log("pack-update " + so.Replace("\r", " ").Replace("\n", " | "));
        return so;
    }

    // "incomplete:windows-mcp,skills" when this install lacks parts its own
    // BUILD.json lists (an older updater did not copy them); "" otherwise.
    internal static string UpdateReason(string so)
    {
        var m = Regex.Match(so ?? "", @"UPDATE_REASON=(incomplete:[A-Za-z0-9_,-]+)");
        return m.Success ? m.Groups[1].Value : "";
    }

    // TREE_PROGRESS=<phase> <done> <total> from tree-restore.ps1, as a line
    // for the login window.
    internal static string ProgressText(string line)
    {
        var m = Regex.Match(line ?? "", @"^TREE_PROGRESS=(\w+) (\d+) (-?\d+)");
        if (!m.Success) return "";
        var phase = m.Groups[1].Value;
        var done = long.Parse(m.Groups[2].Value);
        var total = long.Parse(m.Groups[3].Value);
        if (phase == "download")
        {
            var mb = (done / 1048576).ToString();
            if (total <= 0) return "正在下载新版 " + mb + " MB…";
            return "正在下载新版 " + mb + " / " + (total / 1048576) + " MB（" + (done * 100 / total) + "%）";
        }
        if (phase == "install")
        {
            if (total <= 0) return "正在安装新版…";
            return "正在安装新版 " + done + " / " + total + " 个文件（" + (done * 100 / total) + "%）";
        }
        return "";
    }

    internal static void DeferServedUpdate(string mark)
    {
        var node = NodeBin();
        var checker = Path.Combine(Root, "pack-update-check.js");
        if (!File.Exists(node) || !File.Exists(checker)) return;
        try
        {
            var psi = new ProcessStartInfo();
            psi.FileName = node;
            psi.Arguments = "\"" + checker + "\" --defer \"" + mark + "\"";
            psi.UseShellExecute = false;
            psi.CreateNoWindow = true;
            ClearChildNodeOptions(psi);
            var p = Process.Start(psi);
            if (p != null) p.WaitForExit(5000);
        }
        catch { }
    }

    internal static string CheckProductTree()
    {
        var root = Root;
        var checker = Path.Combine(root, "tree-check.js");
        var node = NodeBin();
        var man = Path.Combine(root, "BUILD.json");
        if (!File.Exists(checker) || !File.Exists(node))
        {
            Log("tree-skip no-checker");
            return "skip";
        }
        if (!File.Exists(man))
        {
            Log("tree-fail manifest-missing");
            return "fail";
        }
        var psi = new ProcessStartInfo();
        psi.FileName = node;
        psi.Arguments = "\"" + checker + "\" --root \"" + root + "\"";
        psi.UseShellExecute = false;
        psi.CreateNoWindow = true;
        psi.RedirectStandardOutput = true;
        psi.RedirectStandardError = true;
        ClearChildNodeOptions(psi);
        var p = Process.Start(psi);
        if (p == null) return "fail";
        var so = p.StandardOutput.ReadToEnd();
        p.StandardError.ReadToEnd();
        if (!p.WaitForExit(180000))
        {
            try { p.Kill(); } catch { }
            Log("tree-timeout");
            return "fail";
        }
        Log("tree-check " + so.Replace("\r", " ").Replace("\n", " | "));
        if (p.ExitCode == 0 && so.IndexOf("TREE_OK=1") >= 0) return "ok";
        if (so.IndexOf("TREE_SKIP=1") >= 0) return "skip";
        return "fail";
    }

    internal static void RestoreProduct()
    {
        RestoreProduct(null);
    }

    internal static void RestoreProduct(Action<string> onProgress)
    {
        StopDeskNode();
        var restore = Path.Combine(Root, "tree-restore.ps1");
        if (!File.Exists(restore)) throw new Exception("tree-restore-missing");
        var psi = new ProcessStartInfo();
        psi.FileName = Path.Combine(Environment.GetEnvironmentVariable("SystemRoot") ?? @"C:\Windows", @"System32\WindowsPowerShell\v1.0\powershell.exe");
        psi.Arguments = "-NoProfile -ExecutionPolicy Bypass -File \"" + restore + "\" -Root \"" + Root + "\" -ZipUrl \"" + Site.ZipUrl + "\"";
        psi.UseShellExecute = false;
        psi.CreateNoWindow = true;
        psi.RedirectStandardOutput = true;
        psi.RedirectStandardError = true;
        var outBuf = new StringBuilder();
        var errBuf = new StringBuilder();
        var p = new Process();
        p.StartInfo = psi;
        p.OutputDataReceived += delegate(object sender, DataReceivedEventArgs e)
        {
            if (e.Data == null) return;
            if (e.Data.StartsWith("TREE_PROGRESS="))
            {
                if (onProgress != null)
                {
                    try { onProgress(e.Data); } catch { }
                }
                return;
            }
            lock (outBuf) { outBuf.AppendLine(e.Data); }
        };
        p.ErrorDataReceived += delegate(object sender, DataReceivedEventArgs e)
        {
            if (e.Data != null) lock (errBuf) { errBuf.AppendLine(e.Data); }
        };
        if (!p.Start()) throw new Exception("tree-restore-start-failed");
        p.BeginOutputReadLine();
        p.BeginErrorReadLine();
        // A 400 MB package over a slow office link can take a while; the
        // window shows progress meanwhile, so give it room.
        if (!p.WaitForExit(1800000))
        {
            try { p.Kill(); } catch { }
            throw new Exception("tree-restore-timeout");
        }
        p.WaitForExit();
        string so, se;
        lock (outBuf) { so = outBuf.ToString(); }
        lock (errBuf) { se = errBuf.ToString(); }
        Log("tree-restore " + so.Replace("\r", " ").Replace("\n", " | ") + " " + se);
        if (p.ExitCode != 0 || so.IndexOf("TREE_RESTORE_OK=1") < 0)
            throw new Exception("tree-restore-failed");
        SyncDeskHome();
    }

    internal static void StopDeskNode()
    {
        // The scan below reads each node process's module path, and that read
        // fails often enough that the old kernel survived a new login. A kernel
        // that survives keeps the plugin code and the identity it started with.
        // Kill the one this host started by the pid it wrote down.
        try
        {
            var pidFile = Path.Combine(Rc8Dir(), "desk.pid");
            if (File.Exists(pidFile))
            {
                int pid;
                if (int.TryParse(File.ReadAllText(pidFile).Trim(), out pid))
                {
                    var old = Process.GetProcessById(pid);
                    if (old.ProcessName.IndexOf("node", StringComparison.OrdinalIgnoreCase) == 0)
                    {
                        old.Kill();
                        old.WaitForExit(3000);
                        Log("pid-kill-node " + pid);
                    }
                }
            }
        }
        catch { }
        var root = Root;
        foreach (var name in new[] { "node", "node-real" })
        {
            foreach (var p in Process.GetProcessesByName(name))
            {
                try
                {
                    string fn = null;
                    try { fn = p.MainModule.FileName; } catch { continue; }
                    if (string.IsNullOrEmpty(fn)) continue;
                    if (fn.IndexOf(root, StringComparison.OrdinalIgnoreCase) < 0) continue;
                    p.Kill();
                    Log("tree-kill-node " + p.Id);
                }
                catch { }
            }
        }
        Thread.Sleep(500);
    }

    internal static string Rc8Dir()
    {
        return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), (".dsh-company-rc" + "8"));
    }

    internal static void PersistLogin(LoginHit hit)
    {
        var rc = Rc8Dir();
        Directory.CreateDirectory(rc);
        if (!string.IsNullOrEmpty(hit.GwToken))
            File.WriteAllText(Path.Combine(rc, "gw.token"), hit.GwToken.Trim() + "\n");
        if (!string.IsNullOrEmpty(hit.SmbUser))
            File.WriteAllText(Path.Combine(rc, "smb.user"), hit.SmbUser.Trim() + "\n");
        if (!string.IsNullOrEmpty(hit.SmbPass))
            File.WriteAllText(Path.Combine(rc, "smb.pass"), hit.SmbPass.Trim() + "\n");
        if (!string.IsNullOrEmpty(hit.Personal))
            File.WriteAllText(Path.Combine(rc, "work.personal"), hit.Personal + "\n");
        if (!string.IsNullOrEmpty(hit.Org))
            File.WriteAllText(Path.Combine(rc, "work.org"), hit.Org + "\n");
        if (!string.IsNullOrEmpty(hit.Role))
            File.WriteAllText(Path.Combine(rc, "login.role"), hit.Role.Trim() + "\n");
        if (!string.IsNullOrEmpty(hit.Login))
            File.WriteAllText(Path.Combine(rc, "login.name"), hit.Login.Trim() + "\n");
        var site = LeaseSite();
        if (!string.IsNullOrEmpty(site))
            File.WriteAllText(Path.Combine(rc, "site.login"), site.Trim() + "\n");
    }

    // Close and logout both land here. Next launch must type the password
    // again. Do not keep gw.token as a skip-login file.
    internal static void ClearLogin()
    {
        var rc = Rc8Dir();
        foreach (var name in new[] { "gw.token", "smb.pass", "smb.user", "login.role", "login.name" })
        {
            try
            {
                var p = Path.Combine(rc, name);
                if (File.Exists(p)) File.Delete(p);
            }
            catch { }
        }
        Log("login-cleared");
    }

    internal static string LeaseSite()
    {
        var login = Site.LoginUrl ?? "";
        if (login.EndsWith("/company/login", StringComparison.OrdinalIgnoreCase))
            return login.Substring(0, login.Length - "/company/login".Length);
        return login;
    }

    internal static int RunLease(string verb, string personal, string org)
    {
        var node = NodeBin();
        var js = Path.Combine(Root, "desk-lease.js");
        if (!File.Exists(js) || !File.Exists(node))
        {
            Log("lease-skip missing");
            return 0;
        }
        var psi = new ProcessStartInfo();
        psi.FileName = node;
        psi.Arguments = "\"" + js + "\" " + verb
            + " --personal \"" + personal + "\""
            + " --org \"" + (org ?? "") + "\""
            + " --home \"" + DeskHome + "\""
            + " --site \"" + LeaseSite() + "\"";
        psi.UseShellExecute = false;
        psi.CreateNoWindow = true;
        psi.RedirectStandardOutput = true;
        psi.RedirectStandardError = true;
        ClearChildNodeOptions(psi);
        var p = Process.Start(psi);
        if (p == null) throw new Exception("desk-lease-start-failed");
        var so = p.StandardOutput.ReadToEnd();
        var se = p.StandardError.ReadToEnd();
        if (!p.WaitForExit(90000))
        {
            try { p.Kill(); } catch { }
            throw new Exception("desk-lease-timeout");
        }
        Log("lease-" + verb + " " + so.Replace("\r", " ").Replace("\n", " | ") + " " + se);
        if (p.ExitCode != 0 && verb == "acquire")
        {
            var hint = (se ?? "") + " " + (so ?? "");
            hint = hint.Replace("\r", " ").Replace("\n", " ").Trim();
            if (hint.Length > 200) hint = hint.Substring(0, 200);
            throw new Exception("desk-lease-acquire" + (hint.Length > 0 ? " " + hint : ""));
        }
        return p.ExitCode;
    }

    internal static void AcquireLease(string personal, string org)
    {
        var js = Path.Combine(Root, "desk-lease.js");
        if (!File.Exists(js)) return;
        RunLease("acquire", personal, org);
    }

    internal static Process StartLeaseWatch(string personal, string org)
    {
        var node = NodeBin();
        var js = Path.Combine(Root, "desk-lease.js");
        if (!File.Exists(js) || !File.Exists(node)) return null;
        var psi = new ProcessStartInfo();
        psi.FileName = node;
        psi.Arguments = "\"" + js + "\" watch --personal \"" + personal + "\" --org \"" + (org ?? "") + "\" --home \"" + DeskHome + "\" --site \"" + LeaseSite() + "\"";
        psi.UseShellExecute = false;
        psi.CreateNoWindow = true;
        psi.RedirectStandardOutput = true;
        psi.RedirectStandardError = true;
        ClearChildNodeOptions(psi);
        var p = Process.Start(psi);
        if (p != null) Log("lease-watch " + p.Id);
        return p;
    }

    internal static void QuitLease(string personal, string org, Process watch)
    {
        try
        {
            if (watch != null && !watch.HasExited) watch.Kill();
        }
        catch { }
        try { RunLease("quit", personal ?? "", org ?? ""); }
        catch (Exception ex) { Log("lease-quit " + ex.Message); }
    }

    internal static void StartDesk(string work, string gwToken)
    {
        var home = SyncDeskHome();
        try
        {
            var org = "";
            try { org = File.ReadAllText(Path.Combine(Rc8Dir(), "work.org")).Trim(); } catch { }
            RunLease("pin-overlay", work, org);
        }
        catch (Exception pinEx) { Log("pin-overlay " + pinEx.Message); }
        if (PortUp()) return;
        var root = Root;
        var node = NodeBin();
        var bin = Path.Combine(root, "prefix", "lib", "node_modules", "@deepseek-ai", "dsh", "lib", "bin.js");
        if (!File.Exists(bin)) bin = Path.Combine(root, "prefix", "node_modules", "@deepseek-ai", "dsh", "lib", "bin.js");
        var overlay = Path.Combine(home, "profiles", "web", "overlay.yml");
        RewriteSkillDir(overlay);
        RewriteSearchDoor(overlay);
        RewriteBrowserBridge(overlay);
        if (string.IsNullOrEmpty(work) || !Directory.Exists(work))
            throw new Exception("company-workspace-missing");
        if (!File.Exists(node)) throw new Exception("bundled-node-missing");
        if (!File.Exists(bin)) throw new Exception("bundled-prefix-missing");
        if (!File.Exists(overlay)) throw new Exception("bundled-overlay-missing");
        HealProfileFallback(home);
        HealMissingProfileBundles(home, root);

        var psi = new ProcessStartInfo();
        psi.FileName = node;
        var shim = Path.Combine(root, "win-junction-shim.cjs");
        var args = "\"" + bin + "\" --profile web --patch \"" + overlay + "\" --host 127.0.0.1 --port " + DeskPort + " --no-open --trusted-host 127.0.0.1 --trusted-host localhost";
        if (File.Exists(shim)) args = "--require \"" + shim + "\" " + args;
        psi.Arguments = args;
        psi.WorkingDirectory = work;
        psi.UseShellExecute = false;
        psi.CreateNoWindow = true;
        ClearChildNodeOptions(psi);
        psi.EnvironmentVariables["DSH_HOME"] = home;
        var extDir = Path.Combine(root, "browser-extension");
        if (Directory.Exists(extDir))
        {
            psi.EnvironmentVariables["COMPANY_BRIDGE_EXT"] = extDir;
            try
            {
                Directory.CreateDirectory(Rc8Dir());
                File.WriteAllText(Path.Combine(Rc8Dir(), "bridge-ext.path"), extDir + "\n");
            }
            catch { }
        }
        var sandboxMode = SandboxModeFor(work);
        // Deployment default plus the per-session preset that would otherwise
        // override it back. Both, or the shell is confined on a share anyway.
        psi.EnvironmentVariables["DSH_PERMISSION_MODE"] = sandboxMode;
        RewriteDefaultPreset(overlay, sandboxMode);
        // Do not export DEEPSEEK_BASE_URL. The overlay cannot name the official
        // host, and this env would send DeepSeek at the gateway instead.
        // The provider then uses its built-in endpoint and the key saved
        // on the Models page (DEEPSEEK_OFFICIAL_KEY).
        // Gateway token must not occupy DEEPSEEK_API_KEY. That name is the
        // Models page key, and an inherited env value is read-only, so the
        // key box never appears. Grok uses GROK_API_KEY instead.
        if (string.IsNullOrEmpty(gwToken) || gwToken == "company-gateway")
            throw new Exception("login-missing-gw-token");
        psi.EnvironmentVariables["GROK_API_KEY"] = gwToken;
        // Media tools every desk ships with (ffmpeg, ffprobe). Put them on PATH
        // for the kernel, so the agent's shell finds them by name and "this
        // machine has no ffmpeg" stops being an answer.
        var ffBin = Path.Combine(root, "ffmpeg", "bin");
        if (File.Exists(Path.Combine(ffBin, "ffmpeg.exe")))
        {
            var curPath = psi.EnvironmentVariables["PATH"];
            if (string.IsNullOrEmpty(curPath)) curPath = Environment.GetEnvironmentVariable("PATH") ?? "";
            psi.EnvironmentVariables["PATH"] = ffBin + ";" + curPath;
            Log("ffmpeg-on-path");
        }
        else Log("ffmpeg-missing " + ffBin);
        try { psi.EnvironmentVariables.Remove("DEEPSEEK_API_KEY"); } catch { }
        psi.EnvironmentVariables["NO_PROXY"] = Site.NoProxy;
        psi.EnvironmentVariables["NODE_USE_ENV_PROXY"] = "0";
        foreach (var key in new[] { "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy" })
        {
            try { psi.EnvironmentVariables.Remove(key); }
            catch { }
        }
        // Also the reason the watermark constant is referenced rather than
        // sitting unused in metadata, and it puts the build id in the log of
        // any machine we are asked to diagnose.
        Log("build " + BuildStamp.Mark + " site=" + BuildStamp.Site + " keyed=" + BuildStamp.Keyed);
        Log("start work=" + work + " sandbox=" + sandboxMode);
        Log("open-fix-local-chair");
        psi.RedirectStandardOutput = true;
        psi.RedirectStandardError = true;
        var bootLog = Path.Combine(home, "desk-boot.log");
        var p = Process.Start(psi);
        if (p == null) throw new Exception("desk-start-failed");
        try { File.WriteAllText(Path.Combine(Rc8Dir(), "desk.pid"), p.Id.ToString()); } catch { }
        var drain = new System.Threading.Thread(new System.Threading.ThreadStart(delegate
        {
            try
            {
                var so = p.StandardOutput.ReadToEnd();
                var se = p.StandardError.ReadToEnd();
                File.AppendAllText(bootLog, so + se);
            }
            catch { }
        }));
        drain.IsBackground = true;
        drain.Start();
        for (var i = 0; i < 450; i++)
        {
            Application.DoEvents();
            System.Threading.Thread.Sleep(200);
            if (PortUp()) return;
            if (p.HasExited)
                throw new Exception("desk-exit " + p.ExitCode + HeadError(bootLog));
        }
        throw new Exception("desk-not-up" + HeadError(bootLog));
    }

    private static void HealProfileFallback(string home)
    {
        var poisoned = Path.Combine(home, "profiles", "node_modules", "@deepseek-ai");
        if (!Directory.Exists(poisoned) && !File.Exists(poisoned)) return;
        try
        {
            if (Directory.Exists(poisoned))
            {
                var attrs = File.GetAttributes(poisoned);
                if ((attrs & FileAttributes.ReparsePoint) != 0) return;
                Directory.Delete(poisoned, true);
            }
            else File.Delete(poisoned);
            Log("heal-stripped-profile-dsh");
        }
        catch (Exception ex)
        {
            Log("heal-skip " + ex.Message);
        }
    }

    private static readonly string[] CompanyProfileBundles = new[]
    {
        "company-edit-pos",
        "company-edit-pos-ui"
    };

    private static void HealMissingProfileBundles(string home, string root)
    {
        try
        {
            var nm = Path.Combine(home, "profiles", "web", "node_modules");
            Directory.CreateDirectory(nm);
            foreach (var name in CompanyProfileBundles)
            {
                var destPkg = Path.Combine(nm, name, "package.json");
                if (File.Exists(destPkg)) continue;
                var src = Path.Combine(root, "plugins", name);
                if (!Directory.Exists(src) || !File.Exists(Path.Combine(src, "package.json"))) continue;
                CopyTree(src, Path.Combine(nm, name));
                Log("heal-copy-bundle " + name);
            }
            var pkg = Path.Combine(home, "profiles", "web", "package.json");
            if (!File.Exists(pkg)) return;
            var text = File.ReadAllText(pkg);
            var orig = text;
            foreach (var name in CompanyProfileBundles)
            {
                if (File.Exists(Path.Combine(nm, name, "package.json"))) continue;
                text = Regex.Replace(text, @"[ \t]*""" + Regex.Escape(name) + @"""\s*:\s*""[^""]+""\s*,?\s*\r?\n", "");
                text = Regex.Replace(text, @",[ \t]*\r?\n[ \t]*""" + Regex.Escape(name) + @"""", "");
                text = Regex.Replace(text, @"[ \t]*""" + Regex.Escape(name) + @"""\s*,\s*\r?\n", "");
                Log("heal-drop-bundle " + name);
            }
            if (text != orig)
            {
                text = Regex.Replace(text, @",(\s*[,}\]])", "$1");
                File.WriteAllText(pkg, text);
            }
        }
        catch (Exception ex)
        {
            Log("heal-bundle-skip " + ex.Message);
        }
    }

    private static string HeadError(string path)
    {
        try
        {
            if (!File.Exists(path)) return "";
            var text = File.ReadAllText(path);
            var m = System.Text.RegularExpressions.Regex.Match(text, @"(?m)^Error: .+$");
            var line = m.Success ? m.Value : text;
            line = line.Replace("\r", " ").Replace("\n", " ").Trim();
            if (line.Length > 240) line = line.Substring(0, 240);
            if (line.Length == 0) return "";
            return " " + line;
        }
        catch { return ""; }
    }

    internal static void PinWorkspaces(string personal, string org)
    {
        // Official DSH only commits UUID workspaces. Planted w-* rows
        // show in the picker but selecting them never sticks.
        try
        {
            NameWorkspace(Rpc("workspace.create", "{\"path\":\"" + JsonEscape(personal) + "\"}"), "个人");
            if (!string.IsNullOrEmpty(org) && !string.Equals(org, personal, StringComparison.OrdinalIgnoreCase))
                NameWorkspace(Rpc("workspace.create", "{\"path\":\"" + JsonEscape(org) + "\"}"), "团队");
        }
        catch (Exception ex) { Log("pin-create " + ex.Message); }
        try { RunLease("collapse-seats", personal, org); }
        catch (Exception ex) { Log("pin " + ex.Message); }
        Log("pin-uuid-seats");
    }

    private static void NameWorkspace(string raw, string title)
    {
        var id = JsonField(raw, "workspaceId");
        if (id.Length == 0) return;
        Rpc("workspace.rename", "{\"workspaceId\":\"" + JsonEscape(id) + "\",\"title\":\"" + JsonEscape(title) + "\"}");
    }

    internal static string ResolveTsAuth(string fromLogin)
    {
        if (!string.IsNullOrEmpty(fromLogin) && fromLogin.IndexOf(("ts" + "key-")) == 0)
            return fromLogin;
        try
        {
            var p = Path.Combine(Root, "vendor", "employee.auth");
            if (!File.Exists(p)) return "";
            var line = File.ReadAllText(p).Trim();
            var nl = line.IndexOf('\n');
            if (nl >= 0) line = line.Substring(0, nl).Trim();
            if (line.IndexOf(("ts" + "key-")) == 0) return line;
        }
        catch { }
        return "";
    }

    internal static void JoinOffLan(string authKey)
    {
        authKey = ResolveTsAuth(authKey);
        if (string.IsNullOrEmpty(authKey) || authKey.IndexOf(("ts" + "key-")) != 0)
        {
            Log("ts-skip-no-auth");
            return;
        }
        var ts = FindTailscale();
        if (ts == null) ts = InstallTailscale();
        if (ts == null)
        {
            Log("ts-missing");
            return;
        }
        if (TailscaleOnCompany(ts))
        {
            Log("ts-already-company");
            return;
        }
        var keyFile = Path.Combine(Path.GetTempPath(), "td-ts.auth");
        try
        {
            File.WriteAllText(keyFile, authKey);
            RunHidden(ts, "up --auth-key=file:" + keyFile + " --accept-routes --reset --unattended", 90000);
            Log("ts-up");
        }
        finally
        {
            try { if (File.Exists(keyFile)) File.Delete(keyFile); } catch { }
        }
    }

    // company-ts-join-before-login-v1
    // Off-LAN boxes must be on 100.x before CheckLogin hits the office login URL.
    // Guangzhou office / warehouse on 192.168.1.0/24 already reach Site.Host.
    // Do not force Tailscale there: data follows the account, not the PC.
    internal static void EnsureCompanyNet()
    {
        if (OnOfficeLan())
        {
            Log("ts-skip-office-lan");
            return;
        }
        JoinOffLan("");
    }

    internal static bool OnOfficeLan()
    {
        return TcpUp(Site.Host, 8443, 1500) || TcpUp(Site.Host, 445, 800);
    }

    internal static bool OnCompanyNet()
    {
        if (OnOfficeLan()) return true;
        var ts = FindTailscale();
        if (ts == null) return false;
        return TailscaleOnCompany(ts);
    }

    private static bool TailscaleOnCompany(string ts)
    {
        try
        {
            var psi = new ProcessStartInfo();
            psi.FileName = ts;
            psi.Arguments = "status --json";
            psi.UseShellExecute = false;
            psi.CreateNoWindow = true;
            psi.RedirectStandardOutput = true;
            psi.RedirectStandardError = true;
            using (var p = Process.Start(psi))
            {
                if (p == null) return false;
                var text = p.StandardOutput.ReadToEnd();
                p.WaitForExit(8000);
                if (text.IndexOf(("100.68." + "88.100"), StringComparison.Ordinal) >= 0) return true;
                if (text.IndexOf(("desktop-" + "2698418"), StringComparison.OrdinalIgnoreCase) >= 0) return true;
                return false;
            }
        }
        catch
        {
            return false;
        }
    }

    private static bool TailscaleRunning(string ts)
    {
        try
        {
            var psi = new ProcessStartInfo();
            psi.FileName = ts;
            psi.Arguments = "status --json";
            psi.UseShellExecute = false;
            psi.CreateNoWindow = true;
            psi.RedirectStandardOutput = true;
            psi.RedirectStandardError = true;
            using (var p = Process.Start(psi))
            {
                if (p == null) return false;
                var text = p.StandardOutput.ReadToEnd();
                p.WaitForExit(8000);
                return text.IndexOf("\"BackendState\":\"Running\"", StringComparison.Ordinal) >= 0
                    || text.IndexOf("\"BackendState\": \"Running\"", StringComparison.Ordinal) >= 0;
            }
        }
        catch
        {
            return false;
        }
    }

    private static string FindTailscale()
    {
        var a = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "Tailscale", "tailscale.exe");
        var b = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), "Tailscale", "tailscale.exe");
        if (File.Exists(a)) return a;
        if (File.Exists(b)) return b;
        return null;
    }

    private static string InstallTailscale()
    {
        try
        {
            var msi = Path.Combine(Root, "vendor", "tailscale-setup.msi");
            if (!File.Exists(msi))
            {
                Log("ts-msi-missing");
                return FindTailscale();
            }
            RunHidden(Path.Combine(Environment.SystemDirectory, "msiexec.exe"), "/i \"" + msi + "\" /qn /norestart TS_NOLAUNCH=yes TS_UNATTENDEDMODE=always", 180000);
        }
        catch (Exception ex)
        {
            Log("ts-install " + ex.Message);
        }
        return FindTailscale();
    }

    // Sessions live on the person's share ($personal/.dsh-desk). Do not POST
    // them to /company/sessions. Brain ingest reads the share on Win.

    private static void RunHidden(string file, string args, int waitMs)
    {
        var psi = new ProcessStartInfo();
        psi.FileName = file;
        psi.Arguments = args;
        psi.UseShellExecute = false;
        psi.CreateNoWindow = true;
        psi.RedirectStandardOutput = true;
        psi.RedirectStandardError = true;
        try
        {
            using (var p = Process.Start(psi))
            {
                if (p == null) return;
                p.WaitForExit(waitMs);
            }
        }
        catch (Exception ex)
        {
            Log("run " + Path.GetFileName(file) + " " + ex.Message);
        }
    }

    // Point the overlay's permission preset at the mode this workspace can
    // actually run. The preset table names its entries after the modes, so the
    // value from SandboxModeFor is also the preset name.
    //
    // Unlike RewriteSkillDir this does not swallow failures: if the preset cannot
    // be set, a share-hosted desk would silently boot confined and the employee
    // would get no shell -- exactly the bug being fixed. Better to fail loudly at
    // launch than to ship a desk whose shell is dead.
    internal static string RewriteDefaultPreset(string overlay, string preset)
    {
        var text = File.ReadAllText(overlay);
        var next = Regex.Replace(
            text,
            @"(?m)^(\s*defaultPreset:\s*)\S+(\s*#\s*@@DESK_DEFAULT_PRESET\s*)$",
            "${1}" + preset + "${2}");
        if (next == text)
        {
            // Already correct is fine; a missing anchor is not.
            if (!Regex.IsMatch(text, @"(?m)^\s*defaultPreset:\s*" + Regex.Escape(preset) + @"\s*#\s*@@DESK_DEFAULT_PRESET\s*$"))
                throw new Exception("overlay-default-preset-anchor-missing");
        }
        else
        {
            File.WriteAllText(overlay, next);
        }
        if (!Regex.IsMatch(text, @"(?m)^\s*" + Regex.Escape(preset) + ":\\s*$"))
            throw new Exception("overlay-preset-row-missing-" + preset);
        return preset;
    }

    // Official DeepSeek search stays off. Employee web_search hits 8450/search.
    internal static void RewriteSearchDoor(string overlay)
    {
        if (!File.Exists(overlay)) throw new Exception("bundled-overlay-missing");
        var door = Site.GatewayBase ?? "";
        if (door.EndsWith("/v1", StringComparison.OrdinalIgnoreCase))
            door = door.Substring(0, door.Length - 3);
        door = door.TrimEnd('/');
        if (door.Length == 0) throw new Exception("search-door-missing");
        var text = File.ReadAllText(overlay);
        text = Regex.Replace(text, @"(?m)^- id: web-search-deepseek\r?\n(?:  .*\r?\n)*", "");
        text = Regex.Replace(text, @"(?m)^- id: web\r?\n(?:  .*\r?\n)*", "");
        text = Regex.Replace(text, @"(?m)^- id: tool-web\r?\n(?:  .*\r?\n)*", "");
        text = Regex.Replace(text, @"(?m)^- id: company-web-search\r?\n(?:  .*\r?\n)*", "");
        var block =
            "- id: web-search-deepseek\n  disabled: true\n" +
            "- id: web\n  config:\n    searchProvider: company\n    fetchProvider: company\n" +
            "- id: tool-web\n  config:\n    fetch: true\n    searchTimeoutMs: 60000\n    fetchTimeoutMs: 90000\n" +
            "- id: company-web-search\n  config:\n    baseURL: " + door + "\n";
        var idx = text.IndexOf("- id: ");
        if (idx < 0) throw new Exception("overlay-no-rows");
        var next = text.Substring(0, idx) + block + text.Substring(idx);
        if (next.IndexOf("api.deepseek.com", StringComparison.OrdinalIgnoreCase) >= 0)
            throw new Exception("overlay-named-upstream");
        if (next.IndexOf("/anthropic", StringComparison.OrdinalIgnoreCase) >= 0)
            throw new Exception("overlay-still-official-search-door");
        File.WriteAllText(overlay, next);
        Log("search-door company");
    }

    // company-click-one-hand-v1 — keep ego/bridge/open-browser disabled.
    // Pin the Chromium extension to this desk's loopback port. Their default
    // probe list is 3080/3081/3090 — company desks listen on DeskPort.
    internal static void RewriteBrowserBridge(string overlay)
    {
        WriteDeskBridgeFile();
        if (!File.Exists(overlay)) throw new Exception("bundled-overlay-missing");
        var text = File.ReadAllText(overlay);
        text = Regex.Replace(text, @"(?m)^- id: bridge-browser\r?\n(?:  .*\r?\n)*", "");
        text = Regex.Replace(text, @"(?m)^- id: company-open-browser\r?\n(?:  .*\r?\n)*", "");
        text = Regex.Replace(text, @"(?m)^- id: ego-browser\r?\n(?:  .*\r?\n)*", "");
        var block = "- id: bridge-browser\n  disabled: true\n  config:\n    sessionWorkspacePath: \"\"\n    deferSessionCreate: true\n- id: ego-browser\n  name: ego-browser\n  disabled: true\n- id: company-open-browser\n  disabled: true\n";
        var idx = text.IndexOf("- id: ");
        if (idx < 0) throw new Exception("overlay-no-rows");
        File.WriteAllText(overlay, text.Substring(0, idx) + block + text.Substring(idx));
        Log("browser-bridge 127.0.0.1:" + DeskPort);
    }

    internal static void WriteDeskBridgeFile()
    {
        var dir = Path.Combine(Root, "browser-extension");
        if (!Directory.Exists(dir)) return;
        File.WriteAllText(Path.Combine(dir, "desk-bridge.json"),
            "{\"http\":\"http://127.0.0.1:" + DeskPort + "\"}\n");
    }

    private static void RewriteSkillDir(string overlay)
    {
        try
        {
            var cache = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), (".dsh-company-rc" + "8"), "skills").Replace('\\', '/');
            var seed = Path.Combine(Root, "skills");
            var share = (Site.ShareUncFwd + "/_skills").Replace('/', Path.DirectorySeparatorChar);
            var js = Path.Combine(Root, "sync-skills.js");
            var node = NodeBin();
            if (File.Exists(js) && File.Exists(node))
            {
                var psi = new ProcessStartInfo();
                psi.FileName = node;
                ClearChildNodeOptions(psi);
                psi.Arguments = "\"" + js + "\" --cache \"" + cache + "\" --seed \"" + seed + "\" --overlay \"" + overlay + "\"";
                if (Directory.Exists(share)) psi.Arguments += " --share \"" + share + "\"";
                var presetJs = Path.Combine(Root, "prefix", "node_modules", "@deepseek-ai", "dsh", "config", "agent-presets", "standard", "agent.cordis.yml");
                if (!File.Exists(presetJs))
                    presetJs = Path.Combine(Root, "prefix", "lib", "node_modules", "@deepseek-ai", "dsh", "config", "agent-presets", "standard", "agent.cordis.yml");
                if (File.Exists(presetJs)) psi.Arguments += " --preset \"" + presetJs + "\"";
                psi.UseShellExecute = false;
                psi.CreateNoWindow = true;
                var p = Process.Start(psi);
                if (p != null) p.WaitForExit(20000);
            }
            RewriteSkillDirFile(overlay, cache);
            // Web disables the host skill-filesystem row. The employee catalog
            // is the standard preset row; the same token has to be rewritten
            // there or available_skills stays empty.
            var preset = Path.Combine(Root, "prefix", "node_modules", "@deepseek-ai", "dsh", "config", "agent-presets", "standard", "agent.cordis.yml");
            if (!File.Exists(preset))
                preset = Path.Combine(Root, "prefix", "lib", "node_modules", "@deepseek-ai", "dsh", "config", "agent-presets", "standard", "agent.cordis.yml");
            RewriteSkillDirFile(preset, cache);
        }
        catch { }
    }

    private static void RewriteSkillDirFile(string path, string deskSkills)
    {
        if (!File.Exists(path)) return;
        var text = File.ReadAllText(path);
        var next = text.Replace("__DESK_SKILLS__", deskSkills);
        next = Regex.Replace(next, @"(?m)^\s+- .*/_skills\s*$", "");
        next = Regex.Replace(next, @"(?m)^\s+- _skills\s*$", "");
        if (next != text) File.WriteAllText(path, next);
    }

    private static string Rpc(string method, string payloadJson)
    {
        var body = "{\"type\":\"client-request\",\"rpcId\":\"" + Guid.NewGuid().ToString() + "\",\"method\":\"" + method + "\",\"payload\":" + payloadJson + "}";
        var req = (HttpWebRequest)WebRequest.Create("http://127.0.0.1:" + DeskPort + "/api/" + method);
        req.Method = "POST";
        req.ContentType = "application/json; charset=utf-8";
        req.Timeout = 15000;
        var raw = Encoding.UTF8.GetBytes(body);
        req.ContentLength = raw.Length;
        using (var s = req.GetRequestStream()) s.Write(raw, 0, raw.Length);
        using (var resp = (HttpWebResponse)req.GetResponse())
        using (var sr = new StreamReader(resp.GetResponseStream(), Encoding.UTF8))
        {
            return sr.ReadToEnd();
        }
    }

    internal static void WaitTask(Task t)
    {
        while (!t.IsCompleted)
        {
            Application.DoEvents();
            System.Threading.Thread.Sleep(40);
        }
        if (t.Exception != null)
            throw t.Exception.InnerException ?? (Exception)t.Exception;
    }
}

internal sealed class LoginHit
{
    public string Login;
    public string Role;
    public string Dept;
    public string Personal;
    public string Org;
    public string TsAuth;
    public string SmbUser;
    public string SmbPass;
    // Per-person gateway token, issued at sign-in. Empty against a server
    // that has not been updated yet, in which case the legacy shared string
    // is used so an old server and a new client still talk.
    public string GwToken;
}

internal sealed class ShellForm : Form
{
    private readonly Panel _login = new Panel();
    private readonly TextBox _user = new TextBox();
    private readonly TextBox _pass = new TextBox();
    private readonly Button _go = new Button();
    private readonly Label _err = new Label();
    private WebView2 _web;
    private string _authUser = "";
    private string _authPass = "";
    private string _personal = "";
    private string _org = "";
    private Process _leaseWatch;
    private System.Windows.Forms.Timer _logoutWatch;

    public ShellForm()
    {
        Text = "TDHarness";
        Width = 1280;
        Height = 800;
        StartPosition = FormStartPosition.CenterScreen;
        Font = new Font("Microsoft YaHei", 10);
        MinimumSize = new Size(900, 600);
        _login.Dock = DockStyle.Fill;
        var box = new Panel();
        box.Width = 400;
        box.Height = 260;
        var title = new Label();
        title.Text = "登录本机 Agent";
        title.AutoSize = true;
        title.Font = new Font("Microsoft YaHei", 14, FontStyle.Bold);
        title.Location = new Point(24, 18);
        var uLab = new Label();
        uLab.Text = "账号";
        uLab.AutoSize = true;
        uLab.Location = new Point(24, 58);
        _user.Width = 350;
        _user.Location = new Point(24, 82);
        var pLab = new Label();
        pLab.Text = "密码";
        pLab.AutoSize = true;
        pLab.Location = new Point(24, 114);
        _pass.Width = 350;
        _pass.UseSystemPasswordChar = true;
        _pass.Location = new Point(24, 138);
        _go.Text = "登录";
        _go.Width = 350;
        _go.Height = 36;
        _go.Location = new Point(24, 178);
        var notice = new Label();
        // LOGIN_SHARE_NOT_UPLOAD
        notice.Text = "工作区和对话都在公司共享盘上，不另外上传。会操作你指定的已打开标签页；点击和导航第一次要你点头。Cookie 不上公司网关。聊天在本窗口，不要用 Chrome 侧栏再开一套对话。";
        notice.AutoSize = true;
        notice.MaximumSize = new Size(350, 0);
        notice.ForeColor = Color.FromArgb(90, 90, 90);
        notice.Location = new Point(24, 220);
        _err.AutoSize = true;
        _err.ForeColor = Color.FromArgb(217, 45, 32);
        _err.Location = new Point(24, 320);
        _err.MaximumSize = new Size(350, 0);
        box.Height = 380;
        box.Controls.Add(title);
        box.Controls.Add(uLab);
        box.Controls.Add(_user);
        box.Controls.Add(pLab);
        box.Controls.Add(_pass);
        box.Controls.Add(_go);
        box.Controls.Add(notice);
        box.Controls.Add(_err);
        _login.Controls.Add(box);
        _login.Resize += delegate
        {
            box.Left = Math.Max(0, (_login.Width - box.Width) / 2);
            box.Top = Math.Max(0, (_login.Height - box.Height) / 2);
        };
        Controls.Add(_login);
        AcceptButton = _go;
        _go.Click += delegate { SignIn(); };
        FormClosing += delegate
        {
            if (_logoutWatch != null)
            {
                try { _logoutWatch.Stop(); _logoutWatch.Dispose(); } catch { }
                _logoutWatch = null;
            }
            AppHost.ClearLogin();
            AppHost.QuitLease(_personal, _org, _leaseWatch);
            AppHost.StopDeskNode();
        };
        Shown += delegate
        {
            box.Left = Math.Max(0, (_login.Width - box.Width) / 2);
            box.Top = Math.Max(0, (_login.Height - box.Height) / 2);
            _err.ForeColor = Color.FromArgb(90, 90, 90);
            _err.Text = "正在接通公司网…";
            var boot = new Thread(new ThreadStart(delegate
            {
                try { AppHost.EnsureCompanyNet(); }
                catch (Exception ex) { AppHost.Log("ts-boot " + ex.Message); }
                try { CheckForUpdate(); }
                catch (Exception upEx) { AppHost.Log("update-check " + upEx.Message); ShowNote("", false); }
            }));
            boot.IsBackground = true;
            boot.Start();
        };
    }

    // Runs on the boot thread. Only the dialog and the label touch the UI.
    private void CheckForUpdate()
    {
        ShowNote("正在检查是否有新版…", false);
        AppHost.Log("tree-check skip-on-login");
        if (AppHost.BootLacksWinJunction())
        {
            AppHost.Log("update-force-junction");
            RunUpdate("正在修复本机安装…");
            return;
        }
        var so = AppHost.CheckServedUpdate();
        if (so.IndexOf("UPDATE_AVAILABLE=1") < 0)
        {
            ShowNote("", false);
            return;
        }
        var served = "";
        var m = Regex.Match(so, @"SERVED_MARK=([0-9a-f]{32})");
        if (m.Success) served = m.Groups[1].Value;
        var reason = AppHost.UpdateReason(so);
        var ask = reason.Length > 0
            ? "这台电脑缺少新版的部分组件（" + reason.Substring("incomplete:".Length) + "），需要补装一次。\n\n是 = 现在补装\n否 = 稍后再说\n取消 = 退出"
            : "公司已发新版。\n\n点「是」一键更新，不用打开下载页。\n\n是 = 现在更新\n否 = 稍后再说\n取消 = 退出";
        var dr = DialogResult.No;
        Invoke(new Action(delegate
        {
            dr = MessageBox.Show(this, ask, "TDHarness",
                MessageBoxButtons.YesNoCancel, MessageBoxIcon.Information, MessageBoxDefaultButton.Button1);
        }));
        if (dr == DialogResult.Cancel)
        {
            BeginInvoke(new Action(delegate { Close(); }));
            return;
        }
        if (dr == DialogResult.No)
        {
            if (served.Length == 32) AppHost.DeferServedUpdate(served);
            AppHost.Log("update-later");
            ShowNote("", false);
            return;
        }
        RunUpdate("正在准备更新…");
    }

    // Download and install with the window alive: the label shows MB / files.
    private void RunUpdate(string first)
    {
        SetLoginEnabled(false);
        ShowNote(first, false);
        try
        {
            AppHost.RestoreProduct(delegate(string line)
            {
                var text = AppHost.ProgressText(line);
                if (text.Length > 0) ShowNote(text, false);
            });
        }
        catch (Exception ex)
        {
            AppHost.Log("update-restore-fail " + ex.Message);
            ShowNote("更新没完成（" + ex.Message + "），先用现在这版登录。", true);
            SetLoginEnabled(true);
            return;
        }
        ShowNote("更新完成，正在重新打开…", false);
        Invoke(new Action(delegate
        {
            MessageBox.Show(this, "更新完成。请重新登录。", "TDHarness", MessageBoxButtons.OK, MessageBoxIcon.Information);
        }));
        AppHost.RelaunchSelf();
    }

    private void ShowNote(string text, bool error)
    {
        try
        {
            BeginInvoke(new Action(delegate
            {
                _err.ForeColor = error ? Color.FromArgb(217, 45, 32) : Color.FromArgb(90, 90, 90);
                _err.Text = text;
                if (!error && text.Length == 0) _err.ForeColor = Color.FromArgb(217, 45, 32);
            }));
        }
        catch { }
    }

    private void SetLoginEnabled(bool on)
    {
        try
        {
            BeginInvoke(new Action(delegate
            {
                _go.Enabled = on;
                _user.Enabled = on;
                _pass.Enabled = on;
            }));
        }
        catch { }
    }

    private void SignIn()
    {
        _err.ForeColor = Color.FromArgb(217, 45, 32);
        _err.Text = "";
        var user = _user.Text.Trim();
        var pass = _pass.Text;
        if (user.Length < 2 || pass.Length < 4)
        {
            _err.Text = "账号或密码不对";
            return;
        }
        _go.Enabled = false;
        Application.DoEvents();
        try
        {
            // JOIN_BEFORE_LOGIN
            _err.ForeColor = Color.FromArgb(90, 90, 90);
            _err.Text = "正在接通公司网…";
            Application.DoEvents();
            try { AppHost.EnsureCompanyNet(); }
            catch (Exception tsEx) { AppHost.Log("ts " + tsEx.Message); }
            _err.ForeColor = Color.FromArgb(217, 45, 32);
            _err.Text = "";
            Application.DoEvents();
            LoginHit hit;
            try { hit = AppHost.CheckLogin(user, pass); }
            catch (WebException)
            {
                _err.Text = "连不上公司网，请稍后再试";
                return;
            }
            catch { hit = null; }
            if (hit == null)
            {
                _err.Text = "账号或密码不对";
                return;
            }
            if (!AppHost.OnOfficeLan() && !AppHost.OnCompanyNet())
            {
                try { AppHost.JoinOffLan(hit.TsAuth); }
                catch (Exception tsEx) { AppHost.Log("ts " + tsEx.Message); }
            }
            _err.Text = "正在挂入公司盘…";
            Application.DoEvents();
            AppHost.EnsureShare(hit.SmbUser, hit.SmbPass);
            if (string.IsNullOrEmpty(hit.Personal) || !Directory.Exists(hit.Personal))
                throw new Exception("company-workspace-missing");
            _authUser = hit.Login;
            _authPass = pass;
            AppHost.PersistLogin(hit);
            _personal = hit.Personal;
            _org = hit.Org ?? "";
            _err.Text = "正在交接会话…";
            Application.DoEvents();
            AppHost.StopDeskNode();
            try { AppHost.QuitLease(hit.Personal, hit.Org, _leaseWatch); } catch { }
            AppHost.AcquireLease(hit.Personal, hit.Org);
            _err.Text = "正在打开本机 Agent…";
            Application.DoEvents();
            AppHost.StartDesk(hit.Personal, hit.GwToken);
            _leaseWatch = AppHost.StartLeaseWatch(hit.Personal, hit.Org);
            if (_leaseWatch != null)
            {
                var watch = _leaseWatch;
                var t = new Thread(new ThreadStart(delegate
                {
                    try { watch.WaitForExit(); }
                    catch { return; }
                    if (watch.ExitCode == 3)
                    {
                        try
                        {
                            BeginInvoke(new Action(delegate
                            {
                                MessageBox.Show("这个账号已在其他设备登录，本机已退出。", "TDHarness");
                                Close();
                            }));
                        }
                        catch { }
                    }
                }));
                t.IsBackground = true;
                t.Start();
            }
            try { AppHost.PinWorkspaces(hit.Personal, hit.Org); }
            catch (Exception pinEx) { AppHost.Log("pin " + pinEx.Message); }
            ShowDesk();
            WatchLogout();
        }
        catch (Exception ex)
        {
            _err.Text = "打不开本机 Agent：" + ex.Message;
            AppHost.Log(ex.ToString());
        }
        finally
        {
            _go.Enabled = true;
        }
    }

    private void WatchLogout()
    {
        if (_logoutWatch != null)
        {
            try { _logoutWatch.Stop(); _logoutWatch.Dispose(); } catch { }
        }
        _logoutWatch = new System.Windows.Forms.Timer();
        _logoutWatch.Interval = 800;
        _logoutWatch.Tick += delegate
        {
            if (File.Exists(Path.Combine(AppHost.Rc8Dir(), "gw.token"))) return;
            LogoutToLogin();
        };
        _logoutWatch.Start();
    }

    private void LogoutToLogin()
    {
        if (_logoutWatch != null)
        {
            try { _logoutWatch.Stop(); _logoutWatch.Dispose(); } catch { }
            _logoutWatch = null;
        }
        AppHost.ClearLogin();
        AppHost.QuitLease(_personal, _org, _leaseWatch);
        _leaseWatch = null;
        AppHost.StopDeskNode();
        if (_web != null)
        {
            Controls.Remove(_web);
            try { _web.Dispose(); } catch { }
            _web = null;
        }
        _personal = "";
        _org = "";
        _pass.Text = "";
        _err.Text = "";
        _login.Visible = true;
        _login.Enabled = true;
        _login.BringToFront();
        AppHost.Log("logout-to-login");
    }

    private void ShowDesk()
    {
        _login.Visible = false;
        _login.Enabled = false;
        _web = new WebView2();
        _web.Dock = DockStyle.Fill;
        Controls.Add(_web);
        _web.BringToFront();
        var data = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "TDHarness", "webview");
        Directory.CreateDirectory(data);
        try
        {
            var envTask = CoreWebView2Environment.CreateAsync(null, data);
            AppHost.WaitTask(envTask);
            var ready = _web.EnsureCoreWebView2Async(envTask.Result);
            AppHost.WaitTask(ready);
        }
        catch (Exception ex)
        {
            throw new Exception("webview2-missing " + ex.Message);
        }
        _web.CoreWebView2.Settings.AreDefaultContextMenusEnabled = false;
        _web.CoreWebView2.Settings.AreDevToolsEnabled = false;
        // The desk window shows the desk and nothing else. A page that asks for a
        // new window (an external link, the browser panel's "open outside"
        // button) used to be loaded into this window, which replaced the whole
        // desk with that page and left no way back. Such pages, and any attempt to
        // move this window off the desk, open in the system browser instead.
        _web.CoreWebView2.NewWindowRequested += delegate(object sender, CoreWebView2NewWindowRequestedEventArgs e)
        {
            e.Handled = true;
            AppHost.OpenOutside(e.Uri, "new-window");
        };
        _web.CoreWebView2.NavigationStarting += delegate(object sender, CoreWebView2NavigationStartingEventArgs e)
        {
            if (AppHost.IsDeskUrl(e.Uri)) return;
            e.Cancel = true;
            AppHost.OpenOutside(e.Uri, "navigation");
        };
        _web.CoreWebView2.Navigate(AppHost.WaitDeskNavigateUrl(8000));
    }
}
