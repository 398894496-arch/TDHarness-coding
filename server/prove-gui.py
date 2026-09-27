#!/usr/bin/env python3
"""Prove the AppHost GUI login URL, not just the LAN Caddy host."""
from __future__ import annotations

import json
import ssl
import sys
import urllib.error
import urllib.request
import zipfile
from pathlib import Path

ROOT = Path(r"D:\dsh")


def load_site(path: Path) -> dict[str, str]:
    site: dict[str, str] = {}
    for raw in path.read_text(encoding="utf-8-sig").splitlines():
        line = raw.split("#", 1)[0].strip()
        if not line or ":" not in line:
            continue
        k, v = line.split(":", 1)
        site[k.strip()] = v.strip().strip('"').strip("'")
    return site


def fetch(url: str) -> tuple[int, bytes]:
    req = urllib.request.Request(url, method="GET")
    ctx = ssl._create_unverified_context()
    try:
        with urllib.request.urlopen(req, context=ctx, timeout=15) as resp:
            return int(resp.status), resp.read()
    except urllib.error.HTTPError as exc:
        return int(exc.code), exc.read()


def main() -> None:
    site_path = Path(sys.argv[1] if len(sys.argv) > 1 else str(ROOT / "site.yml"))
    site = load_site(site_path)
    host = site.get("host") or ""
    port = site.get("login_port") or "8443"
    if not host:
        raise SystemExit("site-missing")
    office = ".".join(["192", "168", "1", "15"])
    if host == office:
        raise SystemExit("site-host-is-office")
    login_url = "https://%s:%s/company/login" % (host, port)
    ver_url = "https://%s:%s/client/version.json" % (host, port)
    zip_path = ROOT / "client-dist" / "CompanyDesk-win.zip"
    if not zip_path.is_file() or zip_path.stat().st_size < 20 * 1024 * 1024:
        raise SystemExit("client-zip-missing")

    vcode, vraw = fetch(ver_url)
    print("VERSION_HTTP=%s" % vcode)
    if vcode != 200:
        raise SystemExit("version-json-http")
    try:
        ver = json.loads(vraw.decode("utf-8") or "{}")
    except ValueError:
        raise SystemExit("version-json-bad")
    win = ver.get("win") if isinstance(ver, dict) else None
    mark = str((win or {}).get("mark") or "")
    print("VERSION_MARK=%s" % mark)
    if len(mark) != 32:
        raise SystemExit("version-json-mark")

    with zipfile.ZipFile(zip_path, "r") as zin:
        names = [n.replace("\\", "/") for n in zin.namelist()]
        build_name = "CompanyDesk/BUILD.json" if "CompanyDesk/BUILD.json" in names else "BUILD.json"
        build = json.loads(zin.read(build_name).decode("utf-8-sig"))
        local_mark = str(build.get("mark") or "")
        exe_name = "CompanyDesk/TDHarness.exe" if "CompanyDesk/TDHarness.exe" in names else "TDHarness.exe"
        exe = zin.read(exe_name)
    print("BUILD_MARK=%s" % local_mark)
    if local_mark != mark:
        raise SystemExit("version-mark-mismatch")
    hay = exe.decode("utf-16le", errors="ignore")
    if login_url not in hay:
        raise SystemExit("exe-missing-lan-login-url")
    if office in hay:
        raise SystemExit("exe-still-has-office-ip")
    print("EXE_LOGIN_URL=%s" % login_url)

    people_url = "https://%s:%s/company/people" % (host, port)
    mail_url = "https://%s:%s/company/mailbox" % (host, port)
    pcode, praw = fetch(people_url)
    print("PEOPLE_HTTP=%s" % pcode)
    if pcode != 200:
        raise SystemExit("people-http")
    try:
        people = json.loads(praw.decode("utf-8") or "{}")
    except ValueError:
        raise SystemExit("people-json")
    rows = people.get("people") if isinstance(people, dict) else None
    if not isinstance(rows, list) or not any(str((r or {}).get("login") or "") == "tdh" for r in rows):
        raise SystemExit("people-missing-tdh")
    print("PEOPLE_HAS_TDH=1")
    mcode, mraw = fetch(mail_url)
    print("MAILBOX_HTTP=%s" % mcode)
    if mcode != 200:
        raise SystemExit("mailbox-http")
    try:
        mail = json.loads(mraw.decode("utf-8") or "{}")
    except ValueError:
        raise SystemExit("mailbox-json")
    floor = mail.get("floor") if isinstance(mail, dict) else None
    if not isinstance(floor, list) or not any(str((r or {}).get("login") or "") == "tdh" for r in floor):
        raise SystemExit("mailbox-floor-missing-tdh")
    print("MAILBOX_HAS_TDH=1")

    gw_url = "http://%s:%s/channels" % (host, site.get("gateway_port") or "8450")
    gcode, graw = fetch(gw_url)
    print("CHANNELS_HTTP=%s" % gcode)
    if gcode != 200:
        raise SystemExit("channels-http")
    try:
        ch = json.loads(graw.decode("utf-8") or "{}")
    except ValueError:
        raise SystemExit("channels-json")
    if not (isinstance(ch, dict) and ch.get("ok") is True and isinstance(ch.get("models"), list)):
        raise SystemExit("channels-shape")
    print("CHANNELS_OK=1")

    shell_js = ""
    shell_host = ""
    with zipfile.ZipFile(zip_path, "r") as zin:
        for name in zin.namelist():
            norm = name.replace("\\", "/")
            if not norm.endswith("company-shell/lib/client.js"):
                continue
            if "node_modules" in norm:
                shell_js = zin.read(name).decode("utf-8", errors="replace")
            elif not shell_js:
                shell_js = zin.read(name).decode("utf-8", errors="replace")
        for name in zin.namelist():
            norm = name.replace("\\", "/")
            if norm.endswith("company-shell/lib/index.js") and "node_modules" in norm:
                shell_host = zin.read(name).decode("utf-8", errors="replace")
                break
    if '"login": "tdh"' not in shell_js:
        raise SystemExit("zip-shell-missing-tdh")
    if 'label: "模型"' not in shell_js:
        raise SystemExit("zip-shell-missing-model-tab")
    if office in shell_js:
        raise SystemExit("zip-shell-still-office")
    print("SHELL_TDH=1")
    print("SHELL_MODEL_TAB=1")
    if shell_host:
        if office in shell_host:
            raise SystemExit("zip-host-still-office")
        if host not in shell_host:
            raise SystemExit("zip-host-missing-lan")
        print("SHELL_HOST_LAN=1")

    mac_path = ROOT / "client-dist" / "CompanyDesk-mac.zip"
    if mac_path.is_file() and mac_path.stat().st_size >= 20 * 1024 * 1024:
        with zipfile.ZipFile(mac_path, "r") as zin:
            names = [n.replace("\\", "/") for n in zin.namelist()]
            start_name = "CompanyDesk/start.command" if "CompanyDesk/start.command" in names else "start.command"
            start = zin.read(start_name)
        if b"tree-check skip-on-open" not in start:
            raise SystemExit("mac-start-missing-skip")
        if b'tree-check.js" --root' in start:
            raise SystemExit("mac-start-still-hashes-tree")
        print("MAC_OPEN_SKIP=1")

    personal = ROOT / "company" / "_office"
    if not personal.is_dir():
        raise SystemExit("office-chair-missing")
    print("CHAIR_OK=1")
    print("GUI_PROVE_OK=1")


if __name__ == "__main__":
    main()
