#!/usr/bin/env python3
"""Emit Site.cs and Caddyfile from a host/share/ports dict. No office literals."""
from __future__ import annotations

import argparse
import sys
from pathlib import Path


def load_site(path: Path) -> dict[str, str]:
    data: dict[str, str] = {}
    for raw in path.read_text(encoding="utf-8-sig").splitlines():
        line = raw.split("#", 1)[0].strip()
        if not line or ":" not in line:
            continue
        k, v = line.split(":", 1)
        data[k.strip()] = v.strip().strip('"').strip("'")
    need = ("host", "share", "login_port", "gateway_port", "company_path")
    missing = [k for k in need if k not in data]
    if missing:
        raise SystemExit("site missing: " + ",".join(missing))
    return data


def emit_cs(site: dict[str, str]) -> str:
    host = site["host"]
    share = site["share"]
    lp = site["login_port"]
    gp = site["gateway_port"]
    company = site["company_path"]
    unc = "\\\\%s\\%s" % (host, share)
    unc_cs = unc.replace("\\", "\\\\")
    return (
        "// Generated at install. Do not commit.\n"
        "internal static class Site\n"
        "{\n"
        '    internal const string Host = "%s";\n' % host
        + '    internal const string Share = "%s";\n' % share
        + '    internal const string LoginUrl = "https://%s:%s/company/login";\n' % (host, lp)
        + '    internal const string SessionUrl = "https://%s:%s/company/sessions";\n' % (host, lp)
        + '    internal const string ZipUrl = "https://%s:%s/client/CompanyDesk-win.zip?v=login1";\n' % (host, lp)
        + '    internal const string ShareUnc = "%s";\n' % unc_cs
        + '    internal const string ShareUncFwd = "//%s/%s";\n' % (host, share)
        + '    internal const string GatewayBase = "http://%s:%s/v1";\n' % (host, gp)
        + '    internal const string NoProxy = "localhost,127.0.0.1,%s";\n' % host
        + '    internal const string CompanyPath = "%s";\n' % company
        + '    internal const string SmbUserFallback = "dshshare";\n'
        + "}\n"
    )


def emit_caddy(site: dict[str, str]) -> str:
    host = site["host"]
    lp = site["login_port"]
    return """{
	admin off
	skip_install_trust
	local_certs
	auto_https disable_redirects
}

https://%s:%s {
	tls internal
	log {
		output file D:/dsh/logs/caddy-sec.log
	}
	handle /client/CompanyDesk-win.zip* {
		header Cache-Control "no-store"
		header Content-Disposition "attachment; filename=\\"CompanyDesk-win.zip\\""
		root * D:/dsh/client-dist
		rewrite * /CompanyDesk-win.zip
		file_server
	}
	handle /client/TDHarness-Setup.exe* {
		header Cache-Control "no-store"
		header Content-Disposition "attachment; filename=\\"TDHarness-Setup.exe\\""
		root * D:/dsh/client-dist
		rewrite * /TDHarness-Setup.exe
		file_server
	}
	handle /client* {
		header Cache-Control "no-store"
		root * D:/dsh/client-dist
		uri strip_prefix /client
		file_server
	}
	handle /company/login* {
		reverse_proxy 127.0.0.1:4181 {
			flush_interval -1
		}
	}
	handle /company/sessions* {
		reverse_proxy 127.0.0.1:4181 {
			flush_interval -1
		}
	}
	handle /company/desk-lease* {
		reverse_proxy 127.0.0.1:4181 {
			flush_interval -1
		}
	}
	handle /company/people* {
		reverse_proxy 127.0.0.1:4181 {
			header_up X-Company-Desk {company_desk}
			header_up Authorization {http.request.header.Authorization}
			header_up X-Company-Gw-Token {http.request.header.X-Company-Gw-Token}
			flush_interval -1
		}
	}
	handle /company/knowledge* {
		uri strip_prefix /company/knowledge
		reverse_proxy 127.0.0.1:4182 {
			header_up X-Company-Desk {company_desk}
			header_up X-Auth-Request-User {http.request.header.X-Auth-Request-User}
			flush_interval -1
		}
	}
	handle /company/ops* {
		reverse_proxy 127.0.0.1:4181 {
			flush_interval -1
		}
	}
	handle {
		header Cache-Control "no-store"
		root * D:/dsh/client-dist
		rewrite * /index.html
		file_server
	}
}
""" % (host, lp)


def rewrite_zip(src: Path, dst: Path, host: str) -> int:
    import zipfile

    mark = b"{{TDH_HOST}}"
    host_b = host.encode("ascii")
    n = 0
    dst.parent.mkdir(parents=True, exist_ok=True)
    tmp = dst.with_suffix(dst.suffix + ".tmp")
    with zipfile.ZipFile(src, "r") as zin, zipfile.ZipFile(tmp, "w") as zout:
        for item in zin.infolist():
            name = item.filename.replace("\\", "/")
            base = name.rsplit("/", 1)[-1]
            if base == "employee.auth":
                n += 1
                continue
            data = zin.read(item.filename)
            if "node_modules" not in name and mark in data:
                data = data.replace(mark, host_b)
                n += 1
            zout.writestr(item, data)
    tmp.replace(dst)
    return n


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--site", required=True)
    ap.add_argument("cmd", choices=("emit-cs", "emit-caddy", "print", "rewrite-zip"))
    ap.add_argument("--out")
    ap.add_argument("--src")
    args = ap.parse_args()
    site = load_site(Path(args.site))
    if args.cmd == "print":
        for k in ("host", "share", "login_port", "gateway_port", "company_path"):
            sys.stdout.write("%s=%s\n" % (k, site[k]))
        return
    if args.cmd == "emit-cs":
        text = emit_cs(site)
    elif args.cmd == "emit-caddy":
        text = emit_caddy(site)
    else:
        if not args.src or not args.out:
            raise SystemExit("rewrite-zip needs --src and --out")
        n = rewrite_zip(Path(args.src), Path(args.out), site["host"])
        sys.stdout.write("REWRITE_HITS=%s\n" % n)
        return
    if not args.out:
        raise SystemExit("need --out")
    Path(args.out).write_text(text, encoding="utf-8")
    sys.stdout.write("WROTE=" + args.out + "\n")


if __name__ == "__main__":
    main()
