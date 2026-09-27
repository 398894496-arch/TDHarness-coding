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
