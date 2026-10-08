"""桌面快捷方式只留一个（幂等）。SetupStub.cs：只写用户桌面 .lnk（失败才写 .url），并清理其它桌面的副本；
AppHost.cs：每次启动清理多余副本，已装机器点一次更新就干净。
2026-10-08 员工反馈：安装后桌面出现 4 个图标（用户桌面 + 公用桌面，各 .lnk + .url）。"""
import sys
from pathlib import Path

TIDY = r'''
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
'''

STUB_OLD = """        foreach (var dir in DeskFolders())
            WriteShortcutAt(dir, app, dest);
        var menuDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.StartMenu), "Programs");
        Directory.CreateDirectory(menuDir);
        WriteOneLnk(Path.Combine(menuDir, "TDHarness.lnk"), app, dest);
        WriteUrlFallback(Path.Combine(menuDir, "TDHarness.url"), app, dest);
"""
STUB_NEW = """        // 桌面只放一个：用户自己的桌面（重定向到 OneDrive 时就是那个）。.lnk 建不出来才退回 .url。
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
"""

APP_OLD = "            Application.Run(new ShellForm());\n            return 0;\n"
APP_NEW = "            TidyExtraShortcuts();\n            Application.Run(new ShellForm());\n            return 0;\n"


def patch(name, t):
    if "TidyExtraShortcuts()" in t and "internal static void TidyExtraShortcuts" in t:
        return t, "already"
    if name == "SetupStub.cs":
        if t.count(STUB_OLD) != 1:
            raise SystemExit("anchor-stub count=%d" % t.count(STUB_OLD))
        t = t.replace(STUB_OLD, STUB_NEW, 1)
        anchor = "    private static void WriteShortcuts(string dest)\n"
    elif name == "AppHost.cs":
        if t.count(APP_OLD) != 1:
            raise SystemExit("anchor-app count=%d" % t.count(APP_OLD))
        t = t.replace(APP_OLD, APP_NEW, 1)
        anchor = "    [STAThread]\n    private static int Main()\n"
    else:
        return t, "skip"
    if t.count(anchor) != 1:
        raise SystemExit("anchor-insert-%s count=%d" % (name, t.count(anchor)))
    t = t.replace(anchor, TIDY.lstrip("\n") + "\n" + anchor, 1)
    return t, "patched"


if __name__ == "__main__":
    for a in sys.argv[1:]:
        p = Path(a); raw = p.read_bytes(); bom = raw[:3] == b"\xef\xbb\xbf"
        s = raw.decode("utf-8-sig"); crlf = "\r\n" in s
        t, how = patch(p.name, s.replace("\r\n", "\n"))
        if how == "patched":
            if crlf: t = t.replace("\n", "\r\n")
            p.write_bytes((b"\xef\xbb\xbf" if bom else b"") + t.encode("utf-8"))
        print(a, how)
