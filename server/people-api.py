#!/usr/bin/env python3
"""Loopback people + login API. Passwords stay in D:/dsh/runtime, not in git."""
from __future__ import annotations

import json
import os
import secrets
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import desk_lease  # noqa: E402

ROOT = Path(os.environ.get("TDH_ROOT") or r"D:\dsh")
ROSTER = Path(os.environ.get("TDH_ROSTER") or str(ROOT / "runtime" / "roster.json"))
PASS_FILE = Path(os.environ.get("TDH_PASSWORDS") or str(ROOT / "runtime" / "caddy" / "PASSWORDS.txt"))
TOKEN_STORE = Path(os.environ.get("TDH_GW_TOKENS") or str(ROOT / "runtime" / "gw-tokens.json"))
LEASE_MU = threading.Lock()
SEED_ADMIN = "tdh"
HOST = "127.0.0.1"
PORT = 4181


def load_roster() -> dict:
    if not ROSTER.is_file():
        return {"owner": "setup-server", "people": []}
    data = json.loads(ROSTER.read_text(encoding="utf-8-sig"))
    if not isinstance(data, dict):
        return {"owner": "setup-server", "people": []}
    data.setdefault("people", [])
    return data


def save_roster(data: dict) -> None:
    ROSTER.parent.mkdir(parents=True, exist_ok=True)
    ROSTER.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def pass_map() -> dict[str, str]:
    out: dict[str, str] = {}
    if not PASS_FILE.is_file():
        return out
    for raw in PASS_FILE.read_text(encoding="utf-8-sig", errors="ignore").splitlines():
        t = raw.strip()
        if not t or t.startswith("#"):
            continue
        if ":" in t[:40]:
            user, pw = t.split(":", 1)
        elif " " in t:
            user, pw = t.split(None, 1)
        else:
            continue
        user, pw = user.strip(), pw.strip()
        if user and pw:
            out[user] = pw
    return out


def public_people() -> list:
    rows = []
    for p in load_roster().get("people") or []:
        if not isinstance(p, dict) or not p.get("login"):
            continue
        rows.append({
            "login": p.get("login"),
            "role": p.get("role"),
            "dept": p.get("dept"),
            "status": p.get("status") or "active",
            "personal": p.get("personal"),
            "org": p.get("org"),
            "workspace": p.get("workspace"),
            "pid": p.get("pid"),
        })
    return rows


def person(login: str) -> dict | None:
    for row in public_people():
        if row.get("login") == login:
            return row
    return None


def load_tokens() -> dict:
    if not TOKEN_STORE.is_file():
        return {"tokens": []}
    try:
        data = json.loads(TOKEN_STORE.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {"tokens": []}
    if not isinstance(data, dict):
        return {"tokens": []}
    data.setdefault("tokens", [])
    return data


def save_tokens(data: dict) -> None:
    TOKEN_STORE.parent.mkdir(parents=True, exist_ok=True)
    TOKEN_STORE.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def mint_token(pid: str) -> str:
    data = load_tokens()
    for row in data["tokens"]:
        if row and row.get("pid") == pid and not row.get("revoked_at") and row.get("token"):
            return str(row["token"])
    token = "dsh_" + secrets.token_hex(16)
    data["tokens"].append({"pid": pid, "token": token, "revoked_at": ""})
    save_tokens(data)
    return token


def login_from_token(token: str) -> str:
    tok = str(token or "").strip()
    if not tok.startswith("dsh_"):
        return ""
    data = load_tokens()
    pid = ""
    for row in data.get("tokens") or []:
        if row and not row.get("revoked_at") and str(row.get("token") or "") == tok:
            pid = str(row.get("pid") or "")
            break
    if not pid:
        return ""
    for row in public_people():
        if str(row.get("pid") or "") == pid:
            return str(row.get("login") or "")
    return ""


def check_login(username: str, password: str) -> dict | None:
    login = username.strip()
    if not login or not password:
        return None
    stored = pass_map().get(login)
    if stored is None or stored != password:
        return None
    row = person(login)
    if not row or row.get("status") != "active":
        return None
    pid = str(row.get("pid") or ("p-" + login))
    return {
        "ok": True,
        "login": login,
        "role": row.get("role"),
        "dept": row.get("dept"),
        "personal": row.get("personal"),
        "org": row.get("org"),
        "gw_token": mint_token(pid),
    }


def run_lease(login: str, device_id: str, action: str) -> tuple[int, dict]:
    path = desk_lease.lease_path(login)
    with LEASE_MU:
        lease = desk_lease.load_lease(path, login)
        now = int(time.time())
        status, name = desk_lease.apply_action(lease, device_id, action, now)
        desk_lease.save_lease(path, lease)
        body = desk_lease.public_view(lease, device_id)
        body["status"] = name
        body["ok"] = status < 400
        if status >= 400:
            body["error"] = name
        return status, body


def json_bytes(obj: dict, status: int = 200) -> tuple[int, bytes]:
    return status, json.dumps(obj, ensure_ascii=False).encode("utf-8")


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt: str, *args) -> None:
        sys.stderr.write("people-api " + (fmt % args) + "\n")

    def _token(self) -> str:
        h = (self.headers.get("Authorization") or "").strip()
        if h.lower().startswith("bearer "):
            return h[7:].strip()
        return (self.headers.get("X-Company-Gw-Token") or "").strip()

    def _actor(self) -> str:
        return login_from_token(self._token())

    def _send(self, status: int, raw: bytes) -> None:
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def _read_json(self) -> dict:
        n = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(n) if n else b"{}"
        try:
            data = json.loads(raw.decode("utf-8") or "{}")
        except ValueError:
            return {}
        return data if isinstance(data, dict) else {}

    def do_GET(self) -> None:
        path = urlparse(self.path).path
        if path == "/health":
            self._send(*json_bytes({"ok": True}))
            return
        if path.startswith("/company/people"):
            self._send(*json_bytes({"ok": True, "people": public_people()}))
            return
        self._send(*json_bytes({"ok": False, "error": "not-found"}, 404))

    def do_POST(self) -> None:
        path = urlparse(self.path).path
        payload = self._read_json()
        if path == "/company/login":
            hit = check_login(str(payload.get("username") or payload.get("login") or ""), str(payload.get("password") or ""))
            if hit is None:
                self._send(*json_bytes({"ok": False, "error": "bad-login"}, 401))
                return
            self._send(*json_bytes(hit))
            return
        if path == "/company/desk-lease":
            login = login_from_token(self._token())
            if not login:
                self._send(*json_bytes({"ok": False, "error": "bad-token"}, 401))
                return
            status, body = run_lease(login, str(payload.get("device_id") or "").strip(), str(payload.get("action") or "").strip())
            self._send(*json_bytes(body, status))
            return
        if path == "/company/people":
            actor = person(self._actor())
            if not actor or actor.get("role") != "admin":
                self._send(*json_bytes({"ok": False, "error": "forbidden"}, 403))
                return
            action = str(payload.get("action") or "")
            login = str(payload.get("login") or "").strip()
            data = load_roster()
            if action == "add":
                if login == SEED_ADMIN:
                    self._send(*json_bytes({"ok": False, "error": "protect-seed-admin"}, 400))
                    return
                pw = str(payload.get("password") or "")
                if len(pw) < 8:
                    self._send(*json_bytes({"ok": False, "error": "password-too-short"}, 400))
                    return
                data["people"].append({
                    "login": login,
                    "role": str(payload.get("role") or "employee"),
                    "dept": str(payload.get("dept") or "content"),
                    "status": "active",
                    "workspace": str(ROOT / "company"),
                    "org": str(ROOT / "company"),
                    "personal": str(ROOT / "company" / ("emp-" + login)),
                    "pid": "p-" + secrets.token_hex(6),
                })
                save_roster(data)
                PASS_FILE.parent.mkdir(parents=True, exist_ok=True)
                with PASS_FILE.open("a", encoding="utf-8") as fh:
                    fh.write("%s:%s\n" % (login, pw))
                self._send(*json_bytes({"ok": True, "people": public_people()}))
                return
            if action == "disable" and login and login != SEED_ADMIN:
                for row in data.get("people") or []:
                    if row.get("login") == login:
                        row["status"] = "disabled"
                save_roster(data)
                self._send(*json_bytes({"ok": True, "people": public_people()}))
                return
            self._send(*json_bytes({"ok": False, "error": "action-unknown"}, 400))
            return
        self._send(*json_bytes({"ok": False, "error": "not-found"}, 404))


def main() -> None:
    httpd = ThreadingHTTPServer((HOST, PORT), Handler)
    sys.stdout.write("LISTEN=%s:%s\n" % (HOST, PORT))
    sys.stdout.flush()
    httpd.serve_forever()


if __name__ == "__main__":
    main()
