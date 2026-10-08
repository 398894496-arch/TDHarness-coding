"""两处启动行为（幂等，按文件名分派）：
1) tool-web 以安装包模板为准：AppHost.cs / start.ps1 / start.command 原来每次启动删掉模板的 tool-web，
   写死搜索 60 秒、抓取 90 秒并丢掉 searchMaxQueries（深搜 40~70 秒，60 秒卡边界）。改为模板有就保留，
   没有才补默认值（170 秒 / 90 秒 / 1 条）。
2) AppHost.cs「连不上公司网」时说清原因：公司地址被代理 fake-ip 改写（198.18.x），或解析到本机（重名）。
"""
import sys
from pathlib import Path

MARK = "@@tool-web-template"
DEF = "- id: tool-web\\n  config:\\n    fetch: true\\n    searchTimeoutMs: 170000\\n    fetchTimeoutMs: 90000\\n    searchMaxQueries: 1\\n"

HINT_CS = r'''
    // 「连不上公司网」时说清原因。@@net-hint
    // 1) 公司地址被代理软件的 fake-ip 改写成 198.18.x（Clash TUN 常见）；2) 解析到了这台电脑自己（和服务器重名）。
    internal static string CompanyNetHint()
    {
        try
        {
            var host = Site.Host ?? "";
            System.Net.IPAddress lit;
            if (host.Length == 0 || System.Net.IPAddress.TryParse(host, out lit)) return "";
            var addrs = System.Net.Dns.GetHostAddresses(host);
            foreach (var a in addrs)
            {
                if (a.AddressFamily != System.Net.Sockets.AddressFamily.InterNetwork) continue;
                var b = a.GetAddressBytes();
                if (b[0] == 198 && (b[1] == 18 || b[1] == 19))
                    return "公司地址 " + host + " 被代理软件改写了（fake-ip）。请在 Clash 等代理里把 +.local 设为直连，或关掉 TUN 后再登录";
            }
            if (!File.Exists(@"D:\dsh\site.yml"))
            {
                var mine = new System.Collections.Generic.HashSet<string>(StringComparer.OrdinalIgnoreCase);
                foreach (var a in System.Net.Dns.GetHostAddresses(System.Net.Dns.GetHostName())) mine.Add(a.ToString());
                foreach (var a in addrs)
                {
                    if (System.Net.IPAddress.IsLoopback(a) || mine.Contains(a.ToString()))
                        return "公司地址 " + host + " 解析到了这台电脑自己：这台电脑和公司服务器重名了，请改这台电脑的计算机名后重启";
                }
            }
        }
        catch { }
        return "";
    }
'''


def once(t, old, new, what):
    if t.count(old) != 1:
        raise SystemExit("anchor-%s count=%d" % (what, t.count(old)))
    return t.replace(old, new, 1)


def patch(name, t):
    done = []
    if name == "AppHost.cs":
        if MARK not in t:
            t = once(t, '        text = Regex.Replace(text, @"(?m)^- id: tool-web\\r?\\n(?:  .*\\r?\\n)*", "");\n',
                     '        // tool-web 以安装包模板为准，模板没有才补默认值。' + MARK + '\n'
                     '        var hasToolWeb = Regex.IsMatch(text, @"(?m)^- id: tool-web\\r?$");\n', "cs-toolweb-rm")
            t = once(t, '            "- id: tool-web\\n  config:\\n    fetch: true\\n    searchTimeoutMs: 60000\\n    fetchTimeoutMs: 90000\\n" +\n',
                     '            (hasToolWeb ? "" : "' + DEF + '") +\n', "cs-toolweb-block")
            done.append("toolweb")
        if "@@net-hint" not in t:
            t = once(t, '            catch (WebException)\n            {\n                _err.Text = "连不上公司网，请稍后再试";\n',
                     '            catch (WebException)\n            {\n                var netHint = AppHost.CompanyNetHint();\n'
                     '                _err.Text = netHint.Length > 0 ? netHint : "连不上公司网，请稍后再试";\n', "cs-hint-use")
            t = once(t, "    internal static bool OnCompanyNet()\n", HINT_CS.lstrip("\n") + "\n    internal static bool OnCompanyNet()\n", "cs-hint-def")
            done.append("hint")
    elif name == "start.ps1":
        if MARK not in t:
            t = once(t, "foreach ($id in @('web-search-deepseek', 'web', 'tool-web', 'company-web-search')) {\n",
                     "# tool-web is left as the template has it. " + MARK + "\n"
                     "foreach ($id in @('web-search-deepseek', 'web', 'company-web-search')) {\n", "ps1-list")
            t = once(t, "- id: tool-web\n  config:\n    fetch: true\n    searchTimeoutMs: 60000\n    fetchTimeoutMs: 90000\n", "", "ps1-block")
            t = once(t, '"@\n$firstId = $ov2.IndexOf(\'- id: \')\n',
                     '"@\nif ($ov2 -notmatch \'(?m)^- id: tool-web\\r?$\') {\n'
                     '  $searchBlock = $searchBlock.TrimEnd() + "`n- id: tool-web`n  config:`n    fetch: true`n    searchTimeoutMs: 170000`n    fetchTimeoutMs: 90000`n    searchMaxQueries: 1"\n}\n'
                     "$firstId = $ov2.IndexOf('- id: ')\n", "ps1-default")
            done.append("toolweb")
    elif name == "start.command":
        if MARK not in t:
            t = once(t, 'for (const id of ["web-search-deepseek", "web", "tool-web", "company-web-search"]) {\n',
                     '// tool-web is left as the template has it. ' + MARK + '\n'
                     'const hasToolWeb = /(^|\\n)- id: tool-web\\n/.test(t);\n'
                     'for (const id of ["web-search-deepseek", "web", "company-web-search"]) {\n', "sh-list")
            t = once(t, '- id: tool-web\\n  config:\\n    fetch: true\\n    searchTimeoutMs: 60000\\n    fetchTimeoutMs: 90000\\n- id: company-web-search',
                     '" + (hasToolWeb ? "" : "' + DEF + '") + "- id: company-web-search', "sh-block")
            done.append("toolweb")
    return t, ("patched " + "+".join(done)) if done else "already"


def patch_bytes(name, data):
    bom = data[:3] == b"\xef\xbb\xbf"
    s = data.decode("utf-8-sig"); crlf = "\r\n" in s
    t, how = patch(name, s.replace("\r\n", "\n"))
    if not how.startswith("patched"):
        return data, how
    if crlf: t = t.replace("\n", "\r\n")
    return (b"\xef\xbb\xbf" if bom else b"") + t.encode("utf-8"), how


if __name__ == "__main__":
    for a in sys.argv[1:]:
        p = Path(a); new, how = patch_bytes(p.name, p.read_bytes())
        if how.startswith("patched"): p.write_bytes(new)
        print(a, how)
