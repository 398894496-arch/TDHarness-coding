#!/usr/bin/env python3
"""Prove seed admin can log in. Prints no token or password."""
from __future__ import annotations

import json
import ssl
import sys
import urllib.error
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent


def post(url: str, payload: dict, headers: dict | None = None) -> tuple[int, dict]:
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=data, method="POST")
    req.add_header("Content-Type", "application/json")
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    ctx = ssl._create_unverified_context()
    try:
        with urllib.request.urlopen(req, context=ctx, timeout=15) as resp:
            raw = resp.read()
            code = int(resp.status)
    except urllib.error.HTTPError as exc:
        raw = exc.read()
        code = int(exc.code)
    try:
        body = json.loads(raw.decode("utf-8") or "{}")
    except ValueError:
        body = {}
    if not isinstance(body, dict):
        body = {}
    return code, body


def get(url: str, headers: dict) -> tuple[int, dict]:
    req = urllib.request.Request(url, method="GET")
    for k, v in headers.items():
        req.add_header(k, v)
    ctx = ssl._create_unverified_context()
    try:
        with urllib.request.urlopen(req, context=ctx, timeout=15) as resp:
            raw = resp.read()
            code = int(resp.status)
    except urllib.error.HTTPError as exc:
        raw = exc.read()
        code = int(exc.code)
    try:
        body = json.loads(raw.decode("utf-8") or "{}")
    except ValueError:
        body = {}
    if not isinstance(body, dict):
        body = {}
    return code, body


def main() -> None:
    site_path = Path(sys.argv[1] if len(sys.argv) > 1 else r"D:\dsh\site.yml")
    site = {}
    for raw in site_path.read_text(encoding="utf-8-sig").splitlines():
        line = raw.split("#", 1)[0].strip()
        if not line or ":" not in line:
            continue
        k, v = line.split(":", 1)
        site[k.strip()] = v.strip().strip('"').strip("'")
    if "host" not in site or "login_port" not in site:
        raise SystemExit("site-missing")
    host = site["host"]
    port = site["login_port"]
    base = "https://%s:%s" % (host, port)
    code, hit = post(base + "/company/login", {"username": "tdh", "password": "12345678"})
    print("LOGIN_HTTP=%s" % code)
    if code != 200 or hit.get("ok") is not True:
        raise SystemExit("login-failed")
    if hit.get("login") != "tdh" or hit.get("role") != "admin":
        raise SystemExit("login-not-admin")
    token = str(hit.get("gw_token") or "")
    if not token.startswith("dsh_"):
        raise SystemExit("login-missing-token")
    print("LOGIN_ROLE=admin")
    headers = {"Authorization": "Bearer " + token, "X-Company-Gw-Token": token}
    lcode, lease = post(
        base + "/company/desk-lease",
        {"action": "acquire", "device_id": "prove-login-device-01"},
        headers,
    )
    print("LEASE_HTTP=%s" % lcode)
    if lcode >= 400 or not lease.get("ok"):
        raise SystemExit("lease-failed")
    pcode, people = get(base + "/company/people", headers)
    print("PEOPLE_HTTP=%s" % pcode)
    rows = people.get("people") if isinstance(people.get("people"), list) else []
    logins = [str(r.get("login") or "") for r in rows if isinstance(r, dict)]
    if pcode != 200 or "tdh" not in logins:
        raise SystemExit("people-failed")
    print("LOGIN_PROVE_OK=1")


if __name__ == "__main__":
    main()
