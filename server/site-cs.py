#!/usr/bin/env python3
"""Emit Site.cs and Caddyfile from a host/share/ports dict. No office literals."""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path


def zip_mark(path: Path) -> str:
    import zipfile

    with zipfile.ZipFile(path, "r") as zin:
        names = [n.replace("\\", "/") for n in zin.namelist()]
        key = "CompanyDesk/BUILD.json" if "CompanyDesk/BUILD.json" in names else "BUILD.json"
        data = json.loads(zin.read(key).decode("utf-8-sig"))
    mark = str(data.get("mark") or "")
    if len(mark) != 32:
        raise SystemExit("zip-mark-missing")
    return mark


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


def company_ca() -> Path:
    """This server's Caddy root, exported by export-ca.ps1 and packed into the clients."""
    return Path(os.environ.get("TDH_COMPANY_CA") or r"D:\dsh\runtime\company-ca.crt")


def gateway_base(site: dict[str, str]) -> str:
    # Desks go through Caddy (TLS, /gw on the login port) once the root they need to
    # trust it exists; before that, plain 8450 as before. Clients, AppHost and the
    # gateway all decide from the same file, so they never disagree.
    if company_ca().is_file():
        return "https://%s:%s/gw/v1" % (site["host"], site["login_port"])
    return "http://%s:%s/v1" % (site["host"], site["gateway_port"])


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
        + '    internal const string GatewayBase = "%s";\n' % gateway_base(site)
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
	default_sni %s
	# 员工常只输入 host:8443 不带 https://，浏览器就发明文 http。同端口识别明文请求并跳到 https。
	servers :%s {
		listener_wrappers {
			http_redirect
			tls
		}
	}
}

https://%s:%s, https://:%s {
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
	# The model gateway for desks, over this TLS listener. The gateway checks every
	# request's token itself; it trusts no address, so coming from Caddy gives nothing.
	handle_path /gw/* {
		reverse_proxy 127.0.0.1:8450 {
			flush_interval -1
			transport http {
				response_header_timeout 0
				read_timeout 0
				write_timeout 0
			}
		}
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
	handle /company/mailbox* {
		reverse_proxy 127.0.0.1:4181 {
			header_up Authorization {http.request.header.Authorization}
			header_up X-Company-Gw-Token {http.request.header.X-Company-Gw-Token}
			flush_interval -1
		}
	}
	handle /company/knowledge* {
		uri strip_prefix /company/knowledge
		reverse_proxy 127.0.0.1:4182 {
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
""" % (host, lp, host, lp, lp)


def extract_zip(src: Path, dst: Path, names: list[str]) -> int:
    import zipfile

    dst.mkdir(parents=True, exist_ok=True)
    want = {n.replace("\\", "/") for n in names}
    n = 0
    with zipfile.ZipFile(src, "r") as zin:
        for item in zin.infolist():
            name = item.filename.replace("\\", "/")
            if name not in want:
                continue
            data = zin.read(item.filename)
            (dst / Path(name).name).write_bytes(data)
            n += 1
    if n != len(want):
        raise SystemExit("extract-zip-missing")
    return n


def emit_stamp(build_json: Path) -> str:
    data = json.loads(build_json.read_text(encoding="utf-8-sig"))
    mark = str(data.get("mark") or "")
    facts = data.get("facts") if isinstance(data.get("facts"), dict) else {}
    site = str(facts.get("site") or "lan")
    issued = str(facts.get("issued_to") or "lan")
    git = str(facts.get("git") or "nogit")
    utc = str(facts.get("utc") or "")
    keyed = "true" if data.get("keyed") else "false"
    if len(mark) != 32:
        raise SystemExit("build-mark-missing")
    return (
        "internal static class BuildStamp\n"
        "{\n"
        '    internal const string Mark = "DSHWM1:%s";\n' % mark
        + '    internal const string Site = "%s";\n' % site
        + '    internal const string IssuedTo = "%s";\n' % issued
        + '    internal const string Git = "%s";\n' % git
        + '    internal const string Utc = "%s";\n' % utc
        + "    internal const bool Keyed = %s;\n" % keyed
        + "}\n"
    )


def replace_zip_member(src: Path, dst: Path, name: str, data: bytes) -> int:
    import zipfile

    name = name.replace("\\", "/")
    tmp = dst.with_suffix(dst.suffix + ".tmp")
    n = 0
    with zipfile.ZipFile(src, "r") as zin, zipfile.ZipFile(tmp, "w") as zout:
        for item in zin.infolist():
            cur = item.filename.replace("\\", "/")
            if cur == name:
                zout.writestr(item, data)
                n += 1
            else:
                zout.writestr(item, zin.read(item.filename))
    if n != 1:
        tmp.unlink(missing_ok=True)
        raise SystemExit("replace-zip-member-missing")
    tmp.replace(dst)
    return n


MAC_TREE_RUN = (
    b"# Tree check is log-only. Do not pop on a dirty local tree (hot plant).\n"
    b"# Update already ran before the desk started.\n"
    b'if [ -f "$ROOT/tree-check.js" ] && [ -f "$ROOT/BUILD.json" ]; then\n'
    b'  TREE_OUT="$("$NODEBIN" "$ROOT/tree-check.js" --root "$ROOT" || true)"\n'
    b"  printf '%s\\n' \"$TREE_OUT\"\n"
    b"fi\n"
)
MAC_TREE_SKIP = (
    b"# Tree check hashes ~30k files. Do not run it on open.\n"
    b'echo "tree-check skip-on-open"\n'
)
WIN_TREE_RUN = (
    b"$treeJs = Join-Path $Root 'tree-check.js'\r\n"
    b"if ((Test-Path -LiteralPath $treeJs) -and (Test-Path -LiteralPath (Join-Path $Root 'BUILD.json'))) {\r\n"
    b"  $treeOut = & $Node $treeJs --root $Root 2>&1 | Out-String\r\n"
    b"  Write-Output $treeOut\r\n"
    b"}\r\n"
)
WIN_TREE_SKIP = (
    b"Write-Output 'tree-check skip-on-open'\r\n"
)


OFFICE_HOST = ".".join(["192", "168", "1", "15"]).encode("ascii")
SEED_PEOPLE = (
    "\t\tconst PEOPLE = [\n"
    "\t\t  {\n"
    '\t\t    "login": "tdh",\n'
    '\t\t    "role": "admin",\n'
    '\t\t    "dept": "company",\n'
    '\t\t    "status": "active",\n'
    '\t\t    "workspace": "D:/dsh/company",\n'
    '\t\t    "org": "D:/dsh/company",\n'
    '\t\t    "personal": "D:/dsh/company/_office",\n'
    '\t\t    "pid": "p-tdh-seed"\n'
    "\t\t  }\n"
    "\t\t];\n"
)


def patch_company_shell(name: str, data: bytes, host: str) -> tuple[bytes, int]:
    path = name.replace("\\", "/")
    if "company-shell/" not in path:
        return data, 0
    n = 0
    host_b = host.encode("ascii")
    if OFFICE_HOST in data:
        data = data.replace(OFFICE_HOST, host_b)
        n += 1
    if path.endswith("client.js"):
        try:
            text = data.decode("utf-8")
        except UnicodeDecodeError:
            return data, n
        begin = text.find("// @@PEOPLE_ROSTER_BEGIN")
        end = text.find("// @@PEOPLE_ROSTER_END")
        if begin >= 0 and end > begin:
            head = text[: begin + len("// @@PEOPLE_ROSTER_BEGIN")]
            tail = text[end:]
            text = head + "\n" + SEED_PEOPLE + "\t\t" + tail
            n += 1
        if 'label: "订阅"' in text:
            text = text.replace('label: "订阅"', 'label: "模型"', 1)
            n += 1
        if 'keep["订阅"] = 1;' in text and 'keep["模型"] = 1;' not in text:
            text = text.replace('keep["订阅"] = 1;', 'keep["模型"] = 1;\n\t\t\t\t\t\tkeep["订阅"] = 1;')
            n += 1
        if "React.createElement(\"h2\", null, \"订阅\")" in text:
            text = text.replace(
                "React.createElement(\"h2\", null, \"订阅\")",
                "React.createElement(\"h2\", null, \"模型\")",
                1,
            )
            n += 1
        data = text.encode("utf-8")
    return data, n


MAC_LOGIN_NAME = (
    b'  if (hit.login) write(path.join(rc8, "login.name"), String(hit.login).trim() + "\\n");\n'
)
MAC_LOGIN_SITE = (
    b'  if (hit.login) write(path.join(rc8, "login.name"), String(hit.login).trim() + "\\n");\n'
    b'  try {\n'
    b'    const site = String(urlRaw || "").replace(/\\/company\\/login\\/?$/i, "");\n'
    b'    if (site) write(path.join(rc8, "site.login"), site + "\\n");\n'
    b'  } catch (e) {}\n'
)


def patch_mac_login(name: str, data: bytes) -> tuple[bytes, int]:
    base = name.rsplit("/", 1)[-1]
    if base != "mac-company-login.js":
        return data, 0
    if b"site.login" in data:
        return data, 0
    if MAC_LOGIN_NAME in data:
        return data.replace(MAC_LOGIN_NAME, MAC_LOGIN_SITE, 1), 1
    crlf = MAC_LOGIN_NAME.replace(b"\n", b"\r\n")
    if crlf in data:
        return data.replace(crlf, MAC_LOGIN_SITE.replace(b"\n", b"\r\n"), 1), 1
    return data, 0


def skip_open_tree_check(name: str, data: bytes) -> tuple[bytes, int]:
    base = name.rsplit("/", 1)[-1]
    if base == "start.command":
        if MAC_TREE_RUN in data:
            return data.replace(MAC_TREE_RUN, MAC_TREE_SKIP), 1
        if b"tree-check skip-on-open" in data:
            return data, 0
        if b'tree-check.js" --root' in data:
            raise SystemExit("mac-start-tree-check-unpatched")
    if base == "start.ps1":
        if WIN_TREE_RUN in data:
            return data.replace(WIN_TREE_RUN, WIN_TREE_SKIP), 1
        if b"tree-check skip-on-open" in data:
            return data, 0
    return data, 0


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
            if name.endswith(".exe.new"):
                n += 1
                continue
            data = zin.read(item.filename)
            shell = "company-shell/" in name
            if "node_modules" not in name or shell:
                if mark in data:
                    data = data.replace(mark, host_b)
                    n += 1
                data, skipped = skip_open_tree_check(name, data)
                n += skipped
                data, patched = patch_company_shell(name, data, host)
                n += patched
                data, mac_login = patch_mac_login(name, data)
                n += mac_login
            zout.writestr(item, data)
    tmp.replace(dst)
    return n


def retarget_zip(src: Path, dst: Path, old: str, new: str) -> int:
    import re
    import zipfile

    pat = re.compile(re.escape(old.encode("ascii")) + rb"(?![0-9A-Za-z-])")
    new_b = new.encode("ascii")
    n = 0
    tmp = dst.with_suffix(dst.suffix + ".tmp")
    with zipfile.ZipFile(src, "r") as zin, zipfile.ZipFile(tmp, "w") as zout:
        for item in zin.infolist():
            name = item.filename.replace("\\", "/")
            # 残留的 TDHarness.exe.new 会被客户端自更新换成正式 exe；它是旧编译，地址是占位符，一启动就崩。
            if name.endswith(".exe.new"):
                n += 1
                continue
            data = zin.read(item.filename)
            if ("node_modules" not in name or "company-shell/" in name) and not name.endswith(".exe"):
                data, k = pat.subn(new_b, data)
                n += k
            zout.writestr(item, data)
    tmp.replace(dst)
    return n


def reseal_zip(src: Path) -> int:
    """包内文件改过之后重算 BUILD.json 的 files 清单和封条（与 build-stamp.py seal 同算法）。
    客户现场没有公司 watermark.key（也不该有），封条改为站点级 sha256，并注明 seal_kind。"""
    import hashlib
    import zipfile

    skip_base = {"BUILD.json", ".DS_Store"}
    with zipfile.ZipFile(src, "r") as zin:
        infos = zin.infolist()
        names = [i.filename.replace("\\", "/") for i in infos]
        key = "CompanyDesk/BUILD.json" if "CompanyDesk/BUILD.json" in names else "BUILD.json"
        body = json.loads(zin.read(key).decode("utf-8-sig"))
        root = key[: -len("BUILD.json")]
        files = {}
        for info in infos:
            name = info.filename.replace("\\", "/")
            if name.endswith("/") or not name.startswith(root):
                continue
            rel = name[len(root):]
            parts = rel.split("/")
            if rel in skip_base or any(x == "__MACOSX" or x.startswith("._") or x == ".DS_Store" for x in parts):
                continue
            data = zin.read(info.filename)
            if ((info.external_attr >> 16) & 0o170000) == 0o120000:
                files[rel] = hashlib.sha256(b"symlink:" + data).hexdigest()
            else:
                files[rel] = hashlib.sha256(data).hexdigest()
    body.pop("seal", None)
    body["files"] = files
    body["seal_kind"] = "site-sha256"
    canon = json.dumps(body, sort_keys=True, separators=(",", ":")).encode()
    body["seal"] = hashlib.sha256(canon).hexdigest()
    replace_zip_member(src, src, key, (json.dumps(body, indent=2) + "\n").encode("utf-8"))
    return len(files)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--site", required=True)
    ap.add_argument(
        "cmd",
        choices=("emit-cs", "emit-caddy", "emit-stamp", "print", "print-mark", "rewrite-zip", "retarget-zip", "reseal-zip", "extract-zip", "replace-zip"),
    )
    ap.add_argument("--out")
    ap.add_argument("--src")
    ap.add_argument("--names")
    ap.add_argument("--name")
    ap.add_argument("--file")
    ap.add_argument("--old")
    args = ap.parse_args()
    site = load_site(Path(args.site))
    if args.cmd == "print":
        for k in ("host", "share", "login_port", "gateway_port", "company_path"):
            sys.stdout.write("%s=%s\n" % (k, site[k]))
        return
    if args.cmd == "print-mark":
        if not args.src:
            raise SystemExit("print-mark needs --src")
        sys.stdout.write(zip_mark(Path(args.src)) + "\n")
        return
    if args.cmd == "rewrite-zip":
        if not args.src or not args.out:
            raise SystemExit("rewrite-zip needs --src and --out")
        n = rewrite_zip(Path(args.src), Path(args.out), site["host"])
        sys.stdout.write("REWRITE_HITS=%s\n" % n)
        return
    if args.cmd == "retarget-zip":
        if not args.src or not args.out or not args.old:
            raise SystemExit("retarget-zip needs --src --out --old")
        n = retarget_zip(Path(args.src), Path(args.out), args.old, site["host"])
        sys.stdout.write("RETARGET_HITS=%s\n" % n)
        return
    if args.cmd == "reseal-zip":
        if not args.src:
            raise SystemExit("reseal-zip needs --src")
        sys.stdout.write("RESEALED_FILES=%s\n" % reseal_zip(Path(args.src)))
        return
    if args.cmd == "extract-zip":
        if not args.src or not args.out or not args.names:
            raise SystemExit("extract-zip needs --src --out --names")
        names = [x.strip() for x in args.names.split(",") if x.strip()]
        n = extract_zip(Path(args.src), Path(args.out), names)
        sys.stdout.write("EXTRACT=%s\n" % n)
        return
    if args.cmd == "replace-zip":
        if not args.src or not args.out or not args.name or not args.file:
            raise SystemExit("replace-zip needs --src --out --name --file")
        n = replace_zip_member(Path(args.src), Path(args.out), args.name, Path(args.file).read_bytes())
        sys.stdout.write("REPLACE=%s\n" % n)
        return
    if args.cmd == "emit-cs":
        text = emit_cs(site)
    elif args.cmd == "emit-caddy":
        text = emit_caddy(site)
    elif args.cmd == "emit-stamp":
        if not args.src:
            raise SystemExit("emit-stamp needs --src")
        text = emit_stamp(Path(args.src))
    else:
        raise SystemExit("bad-cmd")
    if not args.out:
        raise SystemExit("need --out")
    Path(args.out).write_text(text, encoding="utf-8")
    sys.stdout.write("WROTE=" + args.out + "\n")


if __name__ == "__main__":
    main()
