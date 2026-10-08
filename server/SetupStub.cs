using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Net;
using System.Net.Cache;
using System.Reflection;
using System.Text;
using System.Threading;
using System.Windows.Forms;

[assembly: AssemblyTitle("TDHarness Setup")]
[assembly: AssemblyDescription("The Diva local Agent setup")]
[assembly: AssemblyCompany("The Diva")]
[assembly: AssemblyProduct("TDHarness")]
[assembly: AssemblyCopyright("Copyright The Diva")]
[assembly: AssemblyVersion("1.0.15.0")]
[assembly: AssemblyFileVersion("1.0.15.0")]

internal static class Setup
{
    private const string SetupMark = "tdh-setup-1.0.15-tsjoin-#################################################################################################################################################################################################################################################################################################################################################################################################################################################################################################################################################################################################################################################################################################################################################################################################################################################################################################################################################################################################################################################################";
    private static string LogPath;
    private static Form Splash;
    private static Label Status;
    private static volatile string Phase = "start";
    private static int Unpacked;
    private static string InstallRoot;
    private static Exception Fail;

    [STAThread]
    private static int Main()
    {
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        LogPath = Path.Combine(Path.GetTempPath(), "companydesk-setup.log");
        try { File.WriteAllText(LogPath, "start " + DateTime.Now.ToString("o") + "\r\n"); }
        catch { }

        Splash = new Form
        {
            Text = "TDHarness",
            Width = 420,
            Height = 140,
            StartPosition = FormStartPosition.CenterScreen,
            FormBorderStyle = FormBorderStyle.FixedDialog,
            MaximizeBox = false,
            MinimizeBox = false,
            ControlBox = true,
            Font = new Font("Microsoft YaHei", 10)
        };
        Status = new Label
        {
            Text = "正在安装本机 Agent…",
            AutoSize = false,
            Width = 360,
            Height = 48,
            Left = 24,
            Top = 36
        };
        Splash.Controls.Add(Status);
        var tick = new System.Windows.Forms.Timer { Interval = 250 };
        tick.Tick += delegate
        {
            if (Phase == "unpack")
                Status.Text = "正在展开文件… " + Unpacked + " 个";
        };
        tick.Start();
        Splash.Shown += delegate
        {
            var work = new Thread(new ThreadStart(RunInstall));
            work.IsBackground = true;
            work.SetApartmentState(ApartmentState.STA);
            work.Start();
        };
        Application.Run(Splash);
        tick.Stop();
        if (Fail != null)
        {
            MessageBox.Show("安装失败：" + Fail.Message + "\n" + LogPath, "TDHarness");
            return 1;
        }
        if (string.IsNullOrEmpty(InstallRoot)) return 1;
        WriteShortcuts(InstallRoot);
        var app = Path.Combine(InstallRoot, "TDHarness.exe");
        if (File.Exists(app))
        {
            Process.Start(new ProcessStartInfo
            {
                FileName = app,
                WorkingDirectory = InstallRoot,
                UseShellExecute = true
            });
        }
        return 0;
    }

    private static void RunInstall()
    {
        try
        {
            ServicePointManager.ServerCertificateValidationCallback = delegate { return true; };
            try { ServicePointManager.SecurityProtocol |= (SecurityProtocolType)3072; }
            catch { }
            var dest = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "TDH");
            if (File.Exists(dest))
            {
                Log("dest-was-file");
                File.Delete(dest);
            }
            Directory.CreateDirectory(dest);
            LogPath = Path.Combine(dest, "setup.log");
            Log(SetupMark.Substring(0, 24));
            Log("dest " + dest);
            SetStatus("正在关闭旧程序…");
            StopOldApp(dest);
            RetireOldCd();
            ClearDest(dest);
            var tmpZip = Path.Combine(Path.GetTempPath(), "dsh-p.zip");
            try { if (File.Exists(tmpZip)) File.Delete(tmpZip); } catch { }
            DownloadZip(tmpZip);
            Log("zip " + new FileInfo(tmpZip).Length);
            Phase = "unpack";
            SetStatus("正在展开文件…");
            UnpackZip(tmpZip, dest);
            Phase = "done";
            try { File.Delete(tmpZip); } catch { }
            var root = ResolveRoot(dest);
            if (root == null) throw new Exception("unpack-missing-app");
            Log("root " + root);
            WriteShim(root);
            if (!File.Exists(Path.Combine(root, "win-junction-shim.cjs")))
                throw new Exception("程序包太旧，请删掉安装包，从下载页重新下载");
            UnwrapNode(root);
            TryDelete(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".dsh-company" + "-rc8", "pack-update.skip"));
            ScrubStale();
            WriteBridge(root);
            WriteShortcuts(root);
            Log("copied");
            Phase = "ts";
            SetStatus("正在接通公司网…");
            JoinCompanyNet(root);
            InstallRoot = root;
            Log("ok");
        }
        catch (Exception ex)
        {
            Fail = ex;
            Log("fail " + ex);
        }
        try
        {
            if (Splash != null && Splash.IsHandleCreated)
                Splash.BeginInvoke(new Action(delegate { Splash.Close(); }));
        }
        catch { }
    }

    private static void SetStatus(string text)
    {
        Log(text);
        try
        {
            if (Splash != null && Splash.IsHandleCreated)
            {
                Splash.BeginInvoke(new Action(delegate
                {
                    if (Status != null && Phase != "unpack") Status.Text = text;
                }));
            }
        }
        catch { }
    }

    private static void Log(string line)
    {
        try { File.AppendAllText(LogPath, line + "\r\n"); } catch { }
    }

    private static void StopOldApp(string dest)
    {
        foreach (var p in Process.GetProcessesByName("TDHarness"))
        {
            try { p.Kill(); Log("kill-td " + p.Id); }
            catch (Exception ex) { Log("kill-td-skip " + ex.Message); }
        }
        foreach (var p in Process.GetProcessesByName("node"))
        {
            try
            {
                string fn = null;
                try { fn = p.MainModule.FileName; } catch { continue; }
                if (string.IsNullOrEmpty(fn)) continue;
                if (fn.IndexOf(dest, StringComparison.OrdinalIgnoreCase) < 0
                    && fn.IndexOf("\\TDH\\", StringComparison.OrdinalIgnoreCase) < 0
                    && fn.IndexOf("\\cd\\", StringComparison.OrdinalIgnoreCase) < 0)
                    continue;
                p.Kill();
                Log("kill-node " + p.Id);
            }
            catch { }
        }
        Thread.Sleep(1000);
        foreach (var p in Process.GetProcessesByName("TDHarness"))
        {
            try { p.Kill(); } catch { }
        }
        Thread.Sleep(400);
        foreach (var p in Process.GetProcessesByName("TDHarness"))
            throw new Exception("请先关掉登录窗口再安装"); // CLOSE_LOGIN_FIRST
    }

    private static void ClearDest(string dest)
    {
        SetStatus("正在清理旧文件…");
        for (var round = 0; round < 3; round++)
        {
            var left = 0;
            foreach (var p in Directory.GetFileSystemEntries(dest))
            {
                var name = Path.GetFileName(p);
                if (string.Equals(name, "setup.log", StringComparison.OrdinalIgnoreCase)) continue;
                try
                {
                    if (Directory.Exists(p)) Directory.Delete(p, true);
                    else File.Delete(p);
                }
                catch
                {
                    left++;
                    Log("clear-skip " + name);
                }
            }
            if (left == 0) return;
            Thread.Sleep(500);
        }
    }

    private static void DownloadZip(string zipPath)
    {
        var zipUrl = Site.ZipUrl;
        if (zipUrl.IndexOf('?') < 0) zipUrl = zipUrl + "?v=unwrap1";
        var req = (HttpWebRequest)WebRequest.Create(zipUrl);
        req.Method = "GET";
        req.Timeout = 600000;
        req.ReadWriteTimeout = 600000;
        req.CachePolicy = new RequestCachePolicy(RequestCacheLevel.BypassCache);
        using (var resp = (HttpWebResponse)req.GetResponse())
        using (var src = resp.GetResponseStream())
        using (var dst = File.Create(zipPath))
        {
            var code = (int)resp.StatusCode;
            if (code < 200 || code >= 300) throw new Exception("download-http-" + code);
            var expect = resp.ContentLength;
            Log("download-len " + expect);
            var buf = new byte[256 * 1024];
            long got = 0;
            int n;
            var lastMb = -1;
            while ((n = src.Read(buf, 0, buf.Length)) > 0)
            {
                dst.Write(buf, 0, n);
                got += n;
                var mb = (int)(got / (1024 * 1024));
                if (mb != lastMb)
                {
                    lastMb = mb;
                    if (expect > 0)
                        SetStatus("正在下载程序包… " + mb + " / " + (expect / (1024 * 1024)) + " MB");
                    else
                        SetStatus("正在下载程序包… " + mb + " MB");
                }
            }
            if (expect > 20L * 1024 * 1024 && got != expect)
                throw new Exception("下载不完整，请再试一次");
        }
        var zipLen = new FileInfo(zipPath).Length;
        Log("zip-got " + zipLen);
        if (zipLen < 162900000)
            throw new Exception("程序包太旧，请删掉安装包，从下载页重新下载");
    }

    private static void UnpackZip(string zipPath, string dest)
    {
        Unpacked = 0;
        var nEntries = 0;
        try
        {
            using (var fs = File.OpenRead(zipPath))
            using (var zip = new ZipArchive(fs, ZipArchiveMode.Read))
            {
                nEntries = zip.Entries.Count;
                Log("zip-entries " + nEntries);
                foreach (var e in zip.Entries)
                {
                    var name = e.FullName.Replace('\\', '/').TrimStart('/');
                    if (name.Length == 0) continue;
                    var slash = name.IndexOf('/');
                    var rest = name;
                    if (slash >= 0 && name.Substring(0, slash) == "CompanyDesk")
                        rest = name.Substring(slash + 1);
                    if (rest.Length == 0) continue;
                    try
                    {
                        var outPath = Path.Combine(dest, rest.Replace('/', '\\'));
                        if (rest[rest.Length - 1] == '/')
                        {
                            Directory.CreateDirectory(outPath);
                            continue;
                        }
                        var dir = Path.GetDirectoryName(outPath);
                        if (!string.IsNullOrEmpty(dir)) Directory.CreateDirectory(dir);
                        using (var src = e.Open())
                        using (var dst = File.Create(outPath))
                        {
                            var buf = new byte[256 * 1024];
                            int r;
                            while ((r = src.Read(buf, 0, buf.Length)) > 0) dst.Write(buf, 0, r);
                        }
                        Interlocked.Increment(ref Unpacked);
                    }
                    catch (Exception ex)
                    {
                        Log("skip " + rest + " " + ex.Message);
                    }
                }
            }
        }
        catch (Exception ex)
        {
            Log("zip-archive " + ex.Message);
        }
        if (ResolveRoot(dest) == null || Unpacked < 50)
        {
            Log("tar-fallback unpacked=" + Unpacked + " entries=" + nEntries);
            UnpackTar(zipPath, dest);
        }
        if (ResolveRoot(dest) == null)
        {
            LogDest(dest);
            throw new Exception("unpack-missing-app");
        }
        Log("unzip-ok " + Unpacked);
    }

    // .NET 4 ProcessStartInfo rewrites "--name=value" so tar never sees -x.
    // Short options only. Paths are ASCII without spaces; do not quote.
    private static string TarArgs(string zipPath, string dest)
    {
        return "-x -f " + zipPath + " -C " + dest;
    }

    private static void UnpackTar(string zipPath, string dest)
    {
        Directory.CreateDirectory(dest);
        var tar = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), "tar.exe");
        if (!File.Exists(tar)) tar = "tar.exe";
        var args = TarArgs(zipPath, dest);
        Log("tar " + tar + " " + args);
        var psi = new ProcessStartInfo
        {
            FileName = tar,
            Arguments = args,
            UseShellExecute = false,
            CreateNoWindow = true,
            WorkingDirectory = dest
        };
        using (var p = Process.Start(psi))
        {
            if (p == null) throw new Exception("tar-missing");
            if (!p.WaitForExit(600000))
            {
                try { p.Kill(); } catch { }
                throw new Exception("tar-timeout");
            }
            if (p.ExitCode != 0) throw new Exception("tar-exit-" + p.ExitCode);
        }
        var root = ResolveRoot(dest);
        if (root != null && Unpacked < 50) Unpacked = 50;
        Log("tar-direct dest=" + dest + " root=" + (root ?? "none"));
    }

    private static void LogDest(string dest)
    {
        try
        {
            var names = Directory.GetFileSystemEntries(dest);
            Log("dest-top " + names.Length);
            var n = names.Length < 20 ? names.Length : 20;
            for (var i = 0; i < n; i++)
                Log("dest-ent " + Path.GetFileName(names[i]));
        }
        catch (Exception ex)
        {
            Log("dest-list " + ex.Message);
        }
    }

    private static string ResolveRoot(string dest)
    {
        if (File.Exists(Path.Combine(dest, "TDHarness.exe"))) return dest;
        try
        {
            foreach (var dir in Directory.GetDirectories(dest))
            {
                if (File.Exists(Path.Combine(dir, "TDHarness.exe"))) return dir;
            }
        }
        catch { }
        return null;
    }

    // Zhang-style leftover: old Setup dest was %USERPROFILE%\cd or
    // cd\CompanyDesk. New dest is TDH. If the old exe stays, desktop
    // shortcuts keep launching it and login dies on EPERM symlink.
    private static void RetireOldCd()
    {
        var home = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
        foreach (var rel in new[] { "cd\\TDHarness.exe", "cd\\CompanyDesk\\TDHarness.exe" })
        {
            var exe = Path.Combine(home, rel);
            if (!File.Exists(exe)) continue;
            try
            {
                File.Move(exe, exe + ".old");
                Log("retire-old " + exe);
            }
            catch (Exception ex) { Log("retire-skip " + ex.Message); }
        }
    }

    private static void TryDelete(string path)
    {
        try { if (File.Exists(path)) File.Delete(path); } catch { }
    }

    private static void JoinCompanyNet(string root)
    {
        Log("lan-only");
    }

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
        catch { }
    }

    private static void ScrubStale()
    {
        TryDelete(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), "CompanyDesk.lnk"));
        TryDelete(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), "OCHarness.lnk"));
        TryDelete(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.StartMenu), "Programs", "CompanyDesk.lnk"));
        TryDelete(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.StartMenu), "Programs", "OCHarness.lnk"));
        try
        {
            TryDelete(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonDesktopDirectory), "CompanyDesk.lnk"));
            TryDelete(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonDesktopDirectory), "OCHarness.lnk"));
        }
        catch { }
        try
        {
            TryDelete(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonStartMenu), "Programs", "CompanyDesk.lnk"));
            TryDelete(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonStartMenu), "Programs", "OCHarness.lnk"));
        }
        catch { }
    }

    private static void WriteShim(string root)
    {
        var body =
            "\"use strict\";\n" +
            "if (process.platform !== \"win32\") return;\n" +
            "var fs = require(\"fs\");\n" +
            "var path = require(\"path\");\n" +
            "var spawnSync = require(\"child_process\").spawnSync;\n" +
            "function winJunction(link, target) {\n" +
            "  try { fs.mkdirSync(path.dirname(link), { recursive: true }); } catch (e) {}\n" +
            "  try {\n" +
            "    var st = fs.lstatSync(link);\n" +
            "    if (st.isSymbolicLink() || st.isFile()) fs.unlinkSync(link);\n" +
            "    else if (st.isDirectory()) fs.rmSync(link, { recursive: true, force: true });\n" +
            "  } catch (e) {}\n" +
            "  var r = spawnSync(\"cmd.exe\", [\"/c\", \"mklink\", \"/J\", link, target], { encoding: \"utf8\", windowsHide: true, cwd: process.env.SystemRoot || \"C:\\\\Windows\" });\n" +
            "  if (r.status === 0) return;\n" +
            "  var err = new Error(\"dsh: win-junction-failed \" + link + \" -> \" + target);\n" +
            "  err.code = \"EPERM\";\n" +
            "  throw err;\n" +
            "}\n" +
            "fs.symlinkSync = function (target, link) { winJunction(link, target); };\n" +
            "if (fs.promises) fs.promises.symlink = async function (target, link) { winJunction(link, target); };\n";
        File.WriteAllText(Path.Combine(root, "win-junction-shim.cjs"), body, Encoding.ASCII);
        Log("shim-written");
    }

    // 1.0.11 wrapped node.exe. That wrapper broke desk-lease acquire.
    // Restore the real binary and never wrap again. Junctions go through
    // AppHost --require win-junction-shim.cjs.
    private static void UnwrapNode(string root)
    {
        var nodeDir = Path.Combine(root, "node");
        var nodeExe = Path.Combine(nodeDir, "node.exe");
        var real = Path.Combine(nodeDir, "node-real.exe");
        if (File.Exists(real))
        {
            try { if (File.Exists(nodeExe)) File.Delete(nodeExe); } catch { }
            File.Move(real, nodeExe);
            Log("node-unwrapped");
        }
        if (!File.Exists(nodeExe)) throw new Exception("bundled-node-missing");
        if (new FileInfo(nodeExe).Length < 1000000)
            throw new Exception("bundled-node-is-wrap");
    }

    private static void WriteBridge(string root)
    {
        Log("bridge-skip in-tree-vbs " + root);
    }

    // 桌面只留一个 TDHarness 图标：用户自己的桌面上的 .lnk。旧安装器在每个桌面（含公用桌面、OneDrive 桌面）
    // 都写了 .lnk + .url，员工看到 4 个。公用桌面删不掉（没管理员权限）就算了，不影响启动。
    internal static void TidyExtraShortcuts()
    {
        try
        {
            var keep = Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory);
            if (string.IsNullOrEmpty(keep)) return;
            var keepLnk = Path.Combine(keep, "TDHarness.lnk");
            if (!File.Exists(keepLnk)) return;
            var dirs = new System.Collections.Generic.List<string>();
            Action<string> add = delegate(string p)
            {
                if (string.IsNullOrEmpty(p)) return;
                try { p = Path.GetFullPath(p); } catch { return; }
                foreach (var x in dirs) if (string.Equals(x, p, StringComparison.OrdinalIgnoreCase)) return;
                dirs.Add(p);
            };
            add(Environment.GetFolderPath(Environment.SpecialFolder.Desktop));
            add(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "Desktop"));
            try { add(Environment.GetFolderPath(Environment.SpecialFolder.CommonDesktopDirectory)); } catch { }
            try
            {
                foreach (var d in Directory.GetDirectories(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "OneDrive*"))
                    add(Path.Combine(d, "Desktop"));
            }
            catch { }
            var keepFull = Path.GetFullPath(keep);
            foreach (var dir in dirs)
            {
                if (string.Equals(dir, keepFull, StringComparison.OrdinalIgnoreCase)) continue;
                foreach (var name in new[] { "TDHarness.lnk", "TDHarness.url" })
                {
                    try { var f = Path.Combine(dir, name); if (File.Exists(f)) File.Delete(f); } catch { }
                }
            }
            try { var u = Path.Combine(keep, "TDHarness.url"); if (File.Exists(u)) File.Delete(u); } catch { }
            var menu = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.StartMenu), "Programs");
            if (File.Exists(Path.Combine(menu, "TDHarness.lnk")))
            {
                try { var u = Path.Combine(menu, "TDHarness.url"); if (File.Exists(u)) File.Delete(u); } catch { }
            }
        }
        catch { }
    }

    private static void WriteShortcuts(string dest)
    {
        var app = Path.Combine(dest, "TDHarness.exe");
        if (!File.Exists(app))
        {
            Log("shortcut-skip no-app");
            return;
        }
        // 桌面只放一个：用户自己的桌面（重定向到 OneDrive 时就是那个）。.lnk 建不出来才退回 .url。
        var desk = Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory);
        if (string.IsNullOrEmpty(desk)) desk = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "Desktop");
        try { Directory.CreateDirectory(desk); } catch { }
        if (!WriteOneLnk(Path.Combine(desk, "TDHarness.lnk"), app, dest))
            WriteUrlFallback(Path.Combine(desk, "TDHarness.url"), app, dest);
        var menuDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.StartMenu), "Programs");
        Directory.CreateDirectory(menuDir);
        if (!WriteOneLnk(Path.Combine(menuDir, "TDHarness.lnk"), app, dest))
            WriteUrlFallback(Path.Combine(menuDir, "TDHarness.url"), app, dest);
        TidyExtraShortcuts();
    }

    private static string[] DeskFolders()
    {
        var list = new System.Collections.Generic.List<string>();
        Action<string> add = delegate(string p)
        {
            if (string.IsNullOrEmpty(p)) return;
            try { p = Path.GetFullPath(p); } catch { return; }
            foreach (var x in list)
                if (string.Equals(x, p, StringComparison.OrdinalIgnoreCase)) return;
            list.Add(p);
        };
        add(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory));
        add(Environment.GetFolderPath(Environment.SpecialFolder.Desktop));
        add(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "Desktop"));
        try { add(Environment.GetFolderPath(Environment.SpecialFolder.CommonDesktopDirectory)); }
        catch { }
        try
        {
            var home = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
            foreach (var d in Directory.GetDirectories(home, "OneDrive*"))
                add(Path.Combine(d, "Desktop"));
        }
        catch { }
        Log("shortcut-desks " + list.Count);
        return list.ToArray();
    }

    private static void WriteShortcutAt(string dir, string app, string dest)
    {
        if (string.IsNullOrEmpty(dir) || !Directory.Exists(dir) && !Directory.Exists(Path.GetDirectoryName(dir)))
        {
            try { Directory.CreateDirectory(dir); }
            catch (Exception ex)
            {
                Log("shortcut-skip " + dir + " " + ex.Message);
                return;
            }
        }
        try { Directory.CreateDirectory(dir); } catch { }
        WriteUrlFallback(Path.Combine(dir, "TDHarness.url"), app, dest);
        WriteOneLnk(Path.Combine(dir, "TDHarness.lnk"), app, dest);
    }

    private static bool WriteOneLnk(string lnk, string app, string dest)
    {
        try
        {
            var t = Type.GetTypeFromProgID("WScript.Shell");
            if (t == null)
            {
                Log("shortcut-no-wsh " + lnk);
                return false;
            }
            object sh = Activator.CreateInstance(t);
            object sc = t.InvokeMember("CreateShortcut", BindingFlags.InvokeMethod, null, sh, new object[] { lnk });
            var st = sc.GetType();
            st.InvokeMember("TargetPath", BindingFlags.SetProperty, null, sc, new object[] { app });
            st.InvokeMember("WorkingDirectory", BindingFlags.SetProperty, null, sc, new object[] { dest });
            var ico = Path.Combine(dest, "the-diva.ico");
            if (File.Exists(ico))
                st.InvokeMember("IconLocation", BindingFlags.SetProperty, null, sc, new object[] { ico + ",0" });
            st.InvokeMember("Save", BindingFlags.InvokeMethod, null, sc, null);
            if (!File.Exists(lnk))
            {
                Log("shortcut-missing " + lnk);
                return false;
            }
            Log("shortcut-ok " + lnk);
            return true;
        }
        catch (Exception ex)
        {
            Log("shortcut-fail " + lnk + " " + ex.Message);
            return false;
        }
    }

    private static void WriteUrlFallback(string urlPath, string app, string dest)
    {
        try
        {
            var ico = Path.Combine(dest, "the-diva.ico");
            var body = "[InternetShortcut]\r\nURL=file:///" + app.Replace('\\', '/') + "\r\n";
            if (File.Exists(ico))
                body += "IconFile=" + ico + "\r\nIconIndex=0\r\n";
            File.WriteAllText(urlPath, body, Encoding.ASCII);
            Log("shortcut-url " + urlPath);
        }
        catch (Exception ex)
        {
            Log("shortcut-url-fail " + ex.Message);
        }
    }
}
