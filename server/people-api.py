#!/usr/bin/env python3
"""Loopback people + login API. Passwords stay in D:/dsh/runtime, not in git."""
from __future__ import annotations

import base64
import json
import os
import re
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
import tickets as ticket_board  # noqa: E402

ROOT = Path(os.environ.get("TDH_ROOT") or r"D:\dsh")
ROSTER = Path(os.environ.get("TDH_ROSTER") or str(ROOT / "runtime" / "roster.json"))
PASS_FILE = Path(os.environ.get("TDH_PASSWORDS") or str(ROOT / "runtime" / "caddy" / "PASSWORDS.txt"))
TOKEN_STORE = Path(os.environ.get("TDH_GW_TOKENS") or str(ROOT / "runtime" / "gw-tokens.json"))
# The gateway writes one line per model call here (tokens only, by person).
USAGE_DIR = Path(os.environ.get("TDH_USAGE_DIR") or str(ROOT / "runtime" / "usage"))
USAGE_DAYS = 7
LEASE_MU = threading.Lock()
BOARD_MU = threading.Lock()
BOARD = ticket_board.Board(
    Path(os.environ.get("TDH_TICKETS") or str(ROOT / "runtime" / "tickets.json")),
    Path(os.environ.get("TDH_COMPANY") or str(ROOT / "company")),
)
TICKET_ACTIONS = ("issue", "rename", "edit", "submit", "verdict", "withdraw", "archive",
                  "bind-session", "unbind-session", "attach-file", "detach-file", "upload")
SEED_ADMIN = "tdh"
HOST = "127.0.0.1"
PORT = int(os.environ.get("TDH_PEOPLE_PORT") or 4181)


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


# A login is used as a file name (emp-<login>), as the user half of a
# "login:password" line, and in tokens and headers, so it stays plain ASCII.
# What people see is the display name, which can be anything readable.
LOGIN_RE = re.compile(r"^[a-z0-9][a-z0-9._-]{1,31}$")
NAME_MAX = 20
# A small picture the desk has already shrunk, kept inline in the roster.
AVATAR_RE = re.compile(r"^data:image/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$")
AVATAR_MAX = 60000
ROLES = ("employee", "director", "admin")
# Readable defaults for department ids that already exist on older rosters.
DEPT_NAMES = {"company": "公司", "ops": "运营", "visual": "视觉", "wms": "仓储", "live": "直播", "content": "内容"}


def clean_name(value) -> str:
    text = "".join(ch for ch in str(value or "") if ch.isprintable()).strip()
    return text[:NAME_MAX]


def clean_avatar(value) -> str | None:
    """"" clears the picture; None means the value is not acceptable."""
    text = str(value or "").strip()
    if not text:
        return ""
    if len(text) > AVATAR_MAX or not AVATAR_RE.match(text):
        return None
    return text


def depts_of(data: dict) -> list:
    """The department list, seeded from the people on an older roster."""
    rows = [d for d in (data.get("depts") or []) if isinstance(d, dict) and d.get("id")]
    have = {d["id"] for d in rows}
    for p in data.get("people") or []:
        dept = str((p or {}).get("dept") or "").strip()
        if dept and dept not in have:
            rows.append({"id": dept, "name": DEPT_NAMES.get(dept, dept)})
            have.add(dept)
    if not rows:
        rows.append({"id": "company", "name": DEPT_NAMES["company"]})
    for d in rows:
        d["name"] = clean_name(d.get("name")) or str(d["id"])
    data["depts"] = rows
    return rows


def public_depts() -> list:
    return [{"id": d["id"], "name": d["name"]} for d in depts_of(load_roster())]


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


def drop_password(login: str) -> int:
    """Take one person's line out of PASSWORDS.txt; comments and everyone else stay as they are."""
    if not PASS_FILE.is_file():
        return 0
    keep, dropped = [], 0
    for raw in PASS_FILE.read_text(encoding="utf-8-sig", errors="ignore").splitlines():
        t = raw.strip()
        user = ""
        if t and not t.startswith("#"):
            if ":" in t[:40]:
                user = t.split(":", 1)[0].strip()
            elif " " in t:
                user = t.split(None, 1)[0].strip()
        if user == login:
            dropped += 1
            continue
        keep.append(raw)
    if dropped:
        tmp = PASS_FILE.with_suffix(".tmp")
        tmp.write_text("".join(line + "\n" for line in keep), encoding="utf-8")
        os.replace(tmp, PASS_FILE)
    return dropped


def public_people() -> list:
    rows = []
    for p in load_roster().get("people") or []:
        if not isinstance(p, dict) or not p.get("login"):
            continue
        rows.append({
            "login": p.get("login"),
            "name": p.get("name") or "",
            "avatar": p.get("avatar") or "",
            "role": p.get("role"),
            "dept": p.get("dept"),
            "status": p.get("status") or "active",
            "seed": p.get("login") == SEED_ADMIN,
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


def revoke_tokens(pid: str) -> int:
    """Revoke every live gateway token of one person; the next login mints a new one."""
    if not pid:
        return 0
    data = load_tokens()
    now = time.strftime("%Y-%m-%dT%H:%M:%S")
    count = 0
    for row in data.get("tokens") or []:
        if row and row.get("pid") == pid and not row.get("revoked_at"):
            row["revoked_at"] = now
            count += 1
    if count:
        save_tokens(data)
    return count


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


_SHARE_CHECKED_AT = 0.0
_SHARE_LOCK = threading.Lock()

# dshshare 是员工电脑挂公司共享盘用的本机账户。2026-10-08 实测：安装脚本建它时把错误吞了，
# 账户根本不存在，远程员工登录全部 company-disk-not-mounted（本机桌面走环回挂盘，掩盖了问题）。
# 登录时自检：不存在就建、被禁用就启用、密码按 dshshare.pass 对齐、共享权限补齐。10 分钟最多查一次。
_SHARE_HEAL_PS = r"""
$ErrorActionPreference = 'Stop'
$pw = ([IO.File]::ReadAllText($env:TDH_SHARE_PASS_FILE).Trim().Split("`n")[0]).Trim()
if (-not $pw) { throw 'share-pass-empty' }
$sec = ConvertTo-SecureString $pw -AsPlainText -Force
$u = Get-LocalUser -Name dshshare -ErrorAction SilentlyContinue
if (-not $u) {
  New-LocalUser -Name dshshare -Password $sec -PasswordNeverExpires -UserMayNotChangePassword -AccountNeverExpires -Description 'TDH company share (SMB only)' | Out-Null
  'SHARE_ACCOUNT=created'
} else {
  Set-LocalUser -Name dshshare -Password $sec -PasswordNeverExpires $true
  if (-not $u.Enabled) { Enable-LocalUser -Name dshshare; 'SHARE_ACCOUNT=enabled' } else { 'SHARE_ACCOUNT=ok' }
}
Grant-SmbShareAccess -Name 'dsh-company' -AccountName 'dshshare' -AccessRight Full -Force | Out-Null
"""


def ensure_share_account(pass_path: Path) -> None:
    global _SHARE_CHECKED_AT
    if os.name != "nt":
        return
    with _SHARE_LOCK:
        if time.time() - _SHARE_CHECKED_AT < 600:
            return
        import subprocess

        env = dict(os.environ, TDH_SHARE_PASS_FILE=str(pass_path))
        try:
            r = subprocess.run(
                ["powershell.exe", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", _SHARE_HEAL_PS],
                capture_output=True, text=True, timeout=45, env=env,
            )
            tail = (r.stdout or "").strip().splitlines()[-1:] or [""]
            if r.returncode == 0:
                _SHARE_CHECKED_AT = time.time()
                sys.stdout.write("SHARE_HEAL rc=0 %s\n" % tail[0])
            else:
                err = (r.stderr or "").strip().splitlines()[-1:] or [""]
                sys.stdout.write("SHARE_HEAL rc=%s %s\n" % (r.returncode, err[0][:200]))
        except Exception as e:  # noqa: BLE001  自检失败不挡登录，下次登录再试
            sys.stdout.write("SHARE_HEAL error %s\n" % str(e)[:200])
        sys.stdout.flush()



def ensure_personal_dir(row: dict) -> None:
    """员工个人工作区（emp-<login>）。2026-10-08 实测：「添加人员」只写花名册不建目录，
    新员工登录报 company-workspace-missing。添加时建、登录时再补，只建公司盘下面的路径。"""
    raw = str((row or {}).get("personal") or "").strip()
    if not raw:
        return
    try:
        target = Path(raw).resolve()
        company = (ROOT / "company").resolve()
        if company not in target.parents:
            return
        target.mkdir(parents=True, exist_ok=True)
    except Exception as e:  # noqa: BLE001  建不了不挡登录，客户端会报 workspace-missing
        sys.stdout.write("PERSONAL_DIR error %s\n" % str(e)[:200])
        sys.stdout.flush()


def smb_pair() -> tuple[str, str]:
    path = ROOT / "runtime" / "dshshare.pass"
    if not path.is_file():
        return "", ""
    pw = path.read_text(encoding="utf-8-sig").strip().splitlines()
    if not pw or not pw[0].strip():
        return "", ""
    ensure_share_account(path)
    return "dshshare", pw[0].strip()


def usage_since(days: int = USAGE_DAYS) -> list:
    """Ledger lines of the last `days` days, oldest first."""
    since = (time.time() - days * 86400) * 1000
    rows = []
    if not USAGE_DIR.is_dir():
        return rows
    for f in sorted(USAGE_DIR.glob("usage-*.jsonl"))[-3:]:
        try:
            lines = f.read_text(encoding="utf-8").splitlines()
        except OSError:
            continue
        for line in lines:
            try:
                row = json.loads(line)
            except ValueError:
                continue
            if isinstance(row, dict) and float(row.get("t") or 0) >= since:
                rows.append(row)
    return rows


def usage_summary(rows: list) -> dict:
    def blank() -> dict:
        return {"calls": 0, "input": 0, "output": 0, "cached": 0, "reasoning": 0}
    by_person: dict = {}
    by_model: dict = {}
    total = blank()
    for r in rows:
        for bag, key in ((by_person, str(r.get("login") or "unknown")), (by_model, str(r.get("model") or "unknown")), (None, "")):
            slot = total if bag is None else bag.setdefault(key, blank())
            slot["calls"] += 1
            for k in ("input", "output", "cached", "reasoning"):
                slot[k] += int(r.get(k) or 0)
    def listed(bag: dict) -> list:
        out = [dict(v, key=k, tokens=v["input"] + v["output"]) for k, v in bag.items()]
        return sorted(out, key=lambda x: -x["tokens"])
    return {
        "days": USAGE_DAYS,
        "total_tokens": total["input"] + total["output"],
        "total": total,
        "by_person": listed(by_person),
        "by_model": listed(by_model),
        "total_yuan": 0,
    }


def floor_rows(spend: dict | None = None) -> list:
    now = int(time.time())
    out = []
    by_login = {row["key"]: row for row in ((spend or {}).get("by_person") or [])}
    for p in public_people():
        login = str(p.get("login") or "")
        mine = by_login.get(login, {})
        hb = 0
        online = False
        if login:
            lease = desk_lease.load_lease(desk_lease.lease_path(login), login)
            desk_lease.expire(lease, now)
            hb = int(lease.get("heartbeat_unix") or 0)
            online = desk_lease.is_online(lease, now)
        out.append({
            "login": login,
            "name": p.get("name") or "",
            "avatar": p.get("avatar") or "",
            "dept": p.get("dept"),
            "role": p.get("role"),
            "online": online,
            "last_login_unix": hb,
            "tokens_7d": mine.get("tokens", 0),
            "calls_7d": mine.get("calls", 0),
            "yuan_7d": 0,
        })
    return out


def people_by_login() -> dict:
    return {p["login"]: p for p in load_roster().get("people") or [] if isinstance(p, dict) and p.get("login")}


def mailbox_hit(actor: str, **extra) -> dict:
    row = person(actor) if actor else None
    spend = usage_summary(usage_since())
    cards = []
    if row:
        with BOARD_MU:
            cards = BOARD.visible(row, people_by_login())
    body = {
        "ok": True,
        "login": actor or "",
        "role": (row or {}).get("role") or "",
        "people": public_people(),
        "depts": public_depts(),
        "floor": floor_rows(spend),
        "tickets": cards,
        "spend": spend,
    }
    body.update(extra)
    return body


def check_login(username: str, password: str) -> dict | None:
    # 账号只允许小写（LOGIN_RE），员工常输入大写 DK，统一转小写再比对。
    login = username.strip().lower()
    if not login or not password:
        return None
    stored = pass_map().get(login)
    if stored is None or stored != password:
        return None
    row = person(login)
    if not row or row.get("status") != "active":
        return None
    pid = str(row.get("pid") or ("p-" + login))
    ensure_personal_dir(row)
    smb_user, smb_pass = smb_pair()
    return {
        "ok": True,
        "login": login,
        "role": row.get("role"),
        "dept": row.get("dept"),
        "personal": row.get("personal"),
        "org": row.get("org"),
        "gw_token": mint_token(pid),
        "smb_user": smb_user,
        "smb_pass": smb_pass,
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
    # AppHost CheckLogin looks for the exact substring "ok": true
    return status, json.dumps(obj, ensure_ascii=False, separators=(", ", ": ")).encode("utf-8")


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
        # A 12 MB attachment is about 16 MB as base64; nothing larger is read.
        if n > 17 * 1024 * 1024:
            return {}
        raw = self.rfile.read(n) if n else b"{}"
        try:
            data = json.loads(raw.decode("utf-8") or "{}")
        except ValueError:
            return {}
        return data if isinstance(data, dict) else {}

    def _people(self, payload: dict) -> None:
        actor = person(self._actor())
        action = str(payload.get("action") or "")
        login = str(payload.get("login") or "").strip()
        data = load_roster()
        depts = depts_of(data)
        dept_ids = [d["id"] for d in depts]

        def done(extra: dict | None = None) -> None:
            save_roster(data)
            body = {"ok": True, "people": public_people(), "depts": public_depts()}
            body.update(extra or {})
            self._send(*json_bytes(body))

        def fail(error: str, status: int = 400) -> None:
            self._send(*json_bytes({"ok": False, "error": error}, status))

        def row_of(who: str) -> dict | None:
            for row in data.get("people") or []:
                if isinstance(row, dict) and row.get("login") == who:
                    return row
            return None

        if not actor:
            fail("forbidden", 403)
            return
        # Everyone may change their own display name and picture.
        if action == "self":
            row = row_of(str(actor.get("login") or ""))
            if row is None:
                fail("no-such-person", 404)
                return
            if "name" in payload:
                row["name"] = clean_name(payload.get("name"))
            if "avatar" in payload:
                pic = clean_avatar(payload.get("avatar"))
                if pic is None:
                    fail("avatar-bad")
                    return
                row["avatar"] = pic
            done()
            return
        if actor.get("role") != "admin":
            fail("forbidden", 403)
            return

        if action == "add":
            if not LOGIN_RE.match(login):
                fail("login-bad")
                return
            if login == SEED_ADMIN or row_of(login) is not None or login in pass_map():
                fail("login-taken")
                return
            # A removed account's login stays retired: its folder emp-<login> is still on the
            # company disk, and a new person with the same login would open it.
            if any(isinstance(r, dict) and r.get("login") == login for r in data.get("retired") or []):
                fail("login-retired")
                return
            pw = str(payload.get("password") or "")
            if len(pw) < 8:
                fail("password-too-short")
                return
            if any(ch in pw for ch in "\r\n"):
                fail("password-bad")
                return
            role = str(payload.get("role") or "employee")
            dept = str(payload.get("dept") or dept_ids[0])
            if role not in ROLES:
                fail("role-bad")
                return
            if dept not in dept_ids:
                fail("dept-unknown")
                return
            data["people"].append({
                "login": login,
                "name": clean_name(payload.get("name")),
                "role": role,
                "dept": dept,
                "status": "active",
                "workspace": str(ROOT / "company"),
                "org": str(ROOT / "company"),
                "personal": str(ROOT / "company" / ("emp-" + login)),
                "pid": "p-" + secrets.token_hex(6),
            })
            ensure_personal_dir(data["people"][-1])
            PASS_FILE.parent.mkdir(parents=True, exist_ok=True)
            with PASS_FILE.open("a", encoding="utf-8") as fh:
                fh.write("%s:%s\n" % (login, pw))
            done()
            return

        if action in ("set", "disable", "enable", "gw-revoke"):
            row = row_of(login)
            if row is None:
                fail("no-such-person", 404)
                return
            seed = login == SEED_ADMIN
            if action == "set":
                if "role" in payload:
                    role = str(payload.get("role") or "")
                    if role not in ROLES:
                        fail("role-bad")
                        return
                    if seed and role != row.get("role"):
                        fail("protect-seed-admin")
                        return
                    row["role"] = role
                if "dept" in payload:
                    dept = str(payload.get("dept") or "")
                    if dept not in dept_ids:
                        fail("dept-unknown")
                        return
                    row["dept"] = dept
                if "name" in payload:
                    row["name"] = clean_name(payload.get("name"))
                done()
                return
            if action == "disable":
                if seed:
                    fail("protect-seed-admin")
                    return
                row["status"] = "disabled"
                revoked = revoke_tokens(str(row.get("pid") or ""))
                done({"revoked": revoked})
                return
            if action == "enable":
                row["status"] = "active"
                done()
                return
            # The seed admin's token is the one that keeps this server managed.
            if seed:
                fail("protect-seed-admin")
                return
            revoked = revoke_tokens(str(row.get("pid") or ""))
            done({"revoked": revoked})
            return

        # Remove an account for good: off the roster, its password line gone, every token
        # revoked. Only a person already disabled can be removed, so it is always two steps.
        # The personal folder on the company disk is kept; the login is recorded as retired
        # (not shown anywhere) so it cannot be handed to someone else and reopen that folder.
        if action == "remove":
            row = row_of(login)
            if row is None:
                fail("no-such-person", 404)
                return
            if login == SEED_ADMIN:
                fail("protect-seed-admin")
                return
            if login == str(actor.get("login") or ""):
                fail("remove-self")
                return
            if (row.get("status") or "active") != "disabled":
                fail("remove-active")
                return
            revoked = revoke_tokens(str(row.get("pid") or ""))
            data["people"] = [p for p in data.get("people") or [] if not (isinstance(p, dict) and p.get("login") == login)]
            data.setdefault("retired", []).append({
                "login": login,
                "pid": row.get("pid"),
                "personal": row.get("personal"),
                "removed_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
                "by": actor.get("login"),
            })
            dropped = drop_password(login)
            done({"removed": login, "revoked": revoked, "password_dropped": dropped})
            return

        if action == "dept-add":
            name = clean_name(payload.get("name"))
            if not name:
                fail("dept-name-empty")
                return
            if any(d["name"] == name for d in depts):
                fail("dept-name-taken")
                return
            depts.append({"id": "d-" + secrets.token_hex(3), "name": name})
            done()
            return
        if action == "dept-rename":
            target = next((d for d in depts if d["id"] == str(payload.get("id") or "")), None)
            name = clean_name(payload.get("name"))
            if target is None:
                fail("dept-unknown")
                return
            if not name:
                fail("dept-name-empty")
                return
            if any(d["name"] == name and d is not target for d in depts):
                fail("dept-name-taken")
                return
            target["name"] = name
            done()
            return
        if action == "dept-remove":
            dept = str(payload.get("id") or "")
            if dept not in dept_ids:
                fail("dept-unknown")
                return
            if any((p or {}).get("dept") == dept for p in data.get("people") or []):
                fail("dept-not-empty")
                return
            if len(depts) <= 1:
                fail("dept-last")
                return
            data["depts"] = [d for d in depts if d["id"] != dept]
            done()
            return

        fail("action-unknown")

    def _mailbox(self, payload: dict) -> None:
        # Changes are made only by the holder of a live gateway token.
        actor = self._actor()
        action = str(payload.get("action") or "")
        if not action:
            self._send(*json_bytes(mailbox_hit(actor)))
            return
        who = person(actor) if actor else None
        if who is None or who.get("status") == "disabled":
            self._send(*json_bytes({"ok": False, "error": "forbidden"}, 403))
            return
        people = people_by_login()
        try:
            if action in TICKET_ACTIONS:
                with BOARD_MU:
                    hit = BOARD.apply(action, who, people, payload)
                self._send(*json_bytes(mailbox_hit(actor, ticket=hit.get("ticket"), card=hit.get("card"))))
                return
            if action == "file":
                with BOARD_MU:
                    raw, kind = BOARD.read_file(who, people, payload.get("ticket"), payload.get("path"))
                self._send(*json_bytes({"ok": True, "type": kind, "content": base64.b64encode(raw).decode("ascii")}))
                return
            if action == "session-card":
                with BOARD_MU:
                    card = BOARD.card_of_session(who, people, str(payload.get("session") or ""))
                self._send(*json_bytes({"ok": True, "card": card}))
                return
        except ticket_board.Refused as exc:
            self._send(*json_bytes({"ok": False, "error": str(exc)}, 400))
            return
        self._send(*json_bytes({"ok": False, "error": "action-unknown"}, 400))

    def do_GET(self) -> None:
        path = urlparse(self.path).path
        if path == "/health":
            self._send(*json_bytes({"ok": True}))
            return
        if path.startswith("/company/people"):
            self._send(*json_bytes({"ok": True, "people": public_people(), "depts": public_depts()}))
            return
        if path.startswith("/company/mailbox"):
            actor = self._actor()
            self._send(*json_bytes(mailbox_hit(actor)))
            return
        self._send(*json_bytes({"ok": False, "error": "not-found"}, 404))

    def do_POST(self) -> None:
        path = urlparse(self.path).path
        payload = self._read_json()
        if path == "/company/mailbox":
            self._mailbox(payload)
            return
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
            self._people(payload)
            return
        self._send(*json_bytes({"ok": False, "error": "not-found"}, 404))


def main() -> None:
    httpd = ThreadingHTTPServer((HOST, PORT), Handler)
    sys.stdout.write("LISTEN=%s:%s\n" % (HOST, PORT))
    sys.stdout.flush()
    httpd.serve_forever()


if __name__ == "__main__":
    main()
