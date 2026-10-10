"""网关改走加密通道（幂等）：客户端连模型、搜索、生图不再用明文 http://<服务器>:8450，
改走登录用的 Caddy TLS 端口上的 /gw（https://<服务器>:8443/gw）。登录后每次请求都带个人令牌，
明文时同一 Wi-Fi 上的人能截获。
- overlay.yml / cordis.patch.yml / start.command / start.ps1 / company-shell 的 gwBase 里的地址换掉；
- Mac start.command、Win start.ps1 让 Node 信任这台服务器自己的 Caddy 根证书（包里的 company-ca.crt）；
  Win 正常启动走 TDHarness.exe，它自己设 NODE_EXTRA_CA_CERTS（server/AppHost.cs）。
只在打包时给了 --ca（这台服务器导出了根证书）才打；没有根证书就保持明文 8450，不会出现客户端
走 https 却不认证书的情况。
"""
import re
import sys
from pathlib import Path

MARK = "@@gw-tls-v1"
URL = re.compile(r"http://([A-Za-z0-9._{}\-]+):8450(/v1)?")
GWBASE_OLD = 'return "http://" + u.hostname + ":8450";'
GWBASE_NEW = 'return "https://" + u.host + "/gw";'
SH_ANCHOR = "unset HTTP_PROXY HTTPS_PROXY ALL_PROXY http_proxy https_proxy all_proxy\n"
SH_ADD = ('# 网关走 Caddy TLS：Node 信任这台服务器自己的根证书。' + MARK + '\n'
          'if [ -f "$ROOT/company-ca.crt" ]; then export NODE_EXTRA_CA_CERTS="$ROOT/company-ca.crt"; fi\n')
PS_ADD = ("# Gateway over Caddy TLS: Node trusts this server's own root. " + MARK + "\n"
          "if (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'company-ca.crt')) { $env:NODE_EXTRA_CA_CERTS = (Join-Path $PSScriptRoot 'company-ca.crt') }\n")

TARGETS = ("home/profiles/web/overlay.yml", "home/profiles/web/cordis.patch.yml",
           "company-shell/lib/index.js", "company-shell/index.js")


def is_target(rel: str) -> bool:
    return rel in ("start.command", "start.ps1") or any(rel.endswith(t) for t in TARGETS)


def patch(rel: str, t: str, login_port: str = "8443") -> tuple[str, str]:
    out = URL.sub(lambda m: "https://%s:%s/gw%s" % (m.group(1), login_port, m.group(2) or ""), t)
    out = out.replace(GWBASE_OLD, GWBASE_NEW)
    if rel == "start.command" and MARK not in out:
        if out.count(SH_ANCHOR) != 1:
            raise SystemExit("anchor-gw-tls-sh count=%d" % out.count(SH_ANCHOR))
        out = out.replace(SH_ANCHOR, SH_ANCHOR + SH_ADD, 1)
    if rel == "start.ps1" and MARK not in out:
        lines = out.split("\n")
        at = next((i for i, l in enumerate(lines) if l.startswith("$env:DEEPSEEK_BASE_URL = ")), -1)
        if at < 0:
            raise SystemExit("anchor-gw-tls-ps1")
        lines.insert(at + 1, PS_ADD.rstrip("\n"))
        out = "\n".join(lines)
    return (out, "patched-gw-tls") if out != t else (t, "already")


if __name__ == "__main__":
    port = "8443"
    for a in sys.argv[1:]:
        p = Path(a)
        raw = p.read_text(encoding="utf-8"); crlf = "\r\n" in raw
        t, how = patch(p.name if p.name in ("start.command", "start.ps1") else a.replace("\\", "/"), raw.replace("\r\n", "\n"), port)
        if how.startswith("patched"):
            p.write_text(t.replace("\n", "\r\n") if crlf else t, encoding="utf-8")
        print(a, how)
