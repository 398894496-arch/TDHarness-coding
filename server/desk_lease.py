"""One-account one-seat lease. people-api is the only writer.

Holder must heartbeat. Another device acquire() marks kicking; the old
holder flushes then flushed(). If the old machine is dead, kick timeout
or stale heartbeat grants the new device with dirty=1 (last good pack).
"""
from __future__ import annotations

import json
import os
import re
import tempfile
import time
from pathlib import Path

DEVICE_RE = re.compile(r"^[A-Za-z0-9._-]{8,80}$")
LOGIN_RE = re.compile(r"^[A-Za-z0-9._-]{1,64}$")
HEARTBEAT_STALE = 45
KICK_TIMEOUT = 45
LEASE_DIR = Path(os.environ.get("DSH_LEASE_DIR") or r"D:\dsh\runtime\desk-lease")


def empty_lease(login: str) -> dict:
    return {
        "login": login,
        "holder": "",
        "pending": "",
        "state": "free",
        "generation": 0,
        "heartbeat_unix": 0,
        "kick_started_unix": 0,
        "dirty": False,
    }


def _transfer(lease: dict, new_holder: str, now: int, dirty: bool) -> None:
    lease["holder"] = new_holder
    lease["pending"] = ""
    lease["state"] = "held"
    lease["generation"] = int(lease.get("generation") or 0) + 1
    lease["heartbeat_unix"] = now
    lease["kick_started_unix"] = 0
    lease["dirty"] = bool(dirty)


def expire(lease: dict, now: int) -> dict:
    holder = str(lease.get("holder") or "")
    pending = str(lease.get("pending") or "")
    hb = int(lease.get("heartbeat_unix") or 0)
    kick = int(lease.get("kick_started_unix") or 0)
    if holder and hb and (now - hb) > HEARTBEAT_STALE:
        if pending:
            _transfer(lease, pending, now, dirty=True)
        else:
            lease["holder"] = ""
            lease["pending"] = ""
            lease["state"] = "free"
            lease["dirty"] = True
            lease["kick_started_unix"] = 0
        return lease
    if (
        str(lease.get("state") or "") == "kicking"
        and pending
        and kick
        and (now - kick) >= KICK_TIMEOUT
    ):
        _transfer(lease, pending, now, dirty=True)
    return lease


def apply_action(lease: dict, device_id: str, action: str, now: int) -> tuple[int, str]:
    if not DEVICE_RE.match(device_id or ""):
        return 400, "bad-device"
    expire(lease, now)
    holder = str(lease.get("holder") or "")
    pending = str(lease.get("pending") or "")

    if action == "acquire":
        if not holder or holder == device_id:
            lease["holder"] = device_id
            lease["pending"] = ""
            lease["state"] = "held"
            lease["heartbeat_unix"] = now
            lease["kick_started_unix"] = 0
            return 200, "granted"
        lease["pending"] = device_id
        if str(lease.get("state") or "") != "kicking":
            lease["state"] = "kicking"
            lease["kick_started_unix"] = now
        expire(lease, now)
        if str(lease.get("holder") or "") == device_id:
            return 200, "granted"
        return 202, "waiting"

    if action == "heartbeat":
        if holder == device_id:
            lease["heartbeat_unix"] = now
            if pending:
                return 200, "flush"
            return 200, "held"
        if not holder and not pending:
            lease["holder"] = device_id
            lease["pending"] = ""
            lease["state"] = "held"
            lease["heartbeat_unix"] = now
            lease["kick_started_unix"] = 0
            return 200, "held"
        if pending == device_id:
            return 202, "waiting"
        return 409, "kicked"

    if action == "flushed":
        if holder != device_id:
            return 403, "not-holder"
        if pending:
            _transfer(lease, pending, now, dirty=False)
            return 200, "released"
        lease["heartbeat_unix"] = now
        return 200, "held"

    if action == "release":
        if holder != device_id:
            return 403, "not-holder"
        if pending:
            _transfer(lease, pending, now, dirty=True)
            return 200, "released"
        lease["holder"] = ""
        lease["pending"] = ""
        lease["state"] = "free"
        lease["kick_started_unix"] = 0
        lease["heartbeat_unix"] = now
        return 200, "free"

    return 400, "bad-action"


def public_view(lease: dict, device_id: str) -> dict:
    holder = str(lease.get("holder") or "")
    pending = str(lease.get("pending") or "")
    you = "none"
    if holder == device_id:
        you = "holder"
    elif pending == device_id:
        you = "pending"
    return {
        "ok": True,
        "state": str(lease.get("state") or "free"),
        "you": you,
        "generation": int(lease.get("generation") or 0),
        "dirty": bool(lease.get("dirty")),
        "held": bool(holder),
        "waiting": bool(pending),
    }


def load_lease(path: Path, login: str) -> dict:
    if not path.is_file():
        return empty_lease(login)
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return empty_lease(login)
    if not isinstance(data, dict):
        return empty_lease(login)
    data["login"] = login
    return data


def save_lease(path: Path, lease: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=str(path.parent), prefix=".lease-")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            fh.write(json.dumps(lease, ensure_ascii=False, indent=2) + "\n")
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp):
            try:
                os.unlink(tmp)
            except OSError:
                pass


def is_online(lease: dict, now: int) -> bool:
    holder = str(lease.get("holder") or "")
    hb = int(lease.get("heartbeat_unix") or 0)
    return bool(holder and hb and (now - hb) <= HEARTBEAT_STALE)


def list_presence(now: int, root: Path | None = None) -> list:
    base = root or LEASE_DIR
    rows = []
    if not base.is_dir():
        return rows
    for path in base.glob("*.json"):
        login = path.stem
        if not LOGIN_RE.match(login):
            continue
        lease = load_lease(path, login)
        online = is_online(lease, now)
        rows.append({
            "login": login,
            "online": online,
            "heartbeat_unix": int(lease.get("heartbeat_unix") or 0),
            "state": "held" if online else str(lease.get("state") or "free"),
        })
    return rows


def lease_path(login: str, root: Path | None = None) -> Path:
    if not LOGIN_RE.match(login or ""):
        raise ValueError("bad-login")
    return (root or LEASE_DIR) / (login + ".json")


def selftest() -> int:
    now = 1_700_000_000
    a, b = "dev-aaaa1111", "dev-bbbb2222"
    lease = empty_lease("bosshome")
    st, name = apply_action(lease, a, "acquire", now)
    assert st == 200 and name == "granted", (st, name)
    st, name = apply_action(lease, a, "heartbeat", now + 5)
    assert st == 200 and name == "held", (st, name)
    st, name = apply_action(lease, b, "acquire", now + 6)
    assert st == 202 and name == "waiting", (st, name)
    st, name = apply_action(lease, a, "heartbeat", now + 7)
    assert st == 200 and name == "flush", (st, name)
    st, name = apply_action(lease, a, "flushed", now + 8)
    assert st == 200 and name == "released", (st, name)
    assert lease["holder"] == b and lease["dirty"] is False
    st, name = apply_action(lease, b, "heartbeat", now + 9)
    assert st == 200 and name == "held", (st, name)

    lease2 = empty_lease("bosshome")
    apply_action(lease2, a, "acquire", now)
    apply_action(lease2, b, "acquire", now + 1)
    expire(lease2, now + 1 + KICK_TIMEOUT)
    assert lease2["holder"] == b and lease2["dirty"] is True

    lease3 = empty_lease("bosshome")
    apply_action(lease3, a, "acquire", now)
    expire(lease3, now + HEARTBEAT_STALE + 1)
    assert lease3["state"] == "free"
    st, name = apply_action(lease3, a, "heartbeat", now + HEARTBEAT_STALE + 2)
    assert st == 200 and name == "held", (st, name)
    assert lease3["holder"] == a and lease3["state"] == "held"

    lease4 = empty_lease("bosshome")
    apply_action(lease4, a, "acquire", now)
    apply_action(lease4, b, "acquire", now + 1)
    expire(lease4, now + 1 + KICK_TIMEOUT)
    assert lease4["holder"] == b
    st, name = apply_action(lease4, a, "heartbeat", now + 1 + KICK_TIMEOUT + 1)
    assert st == 409 and name == "kicked", (st, name)

    box = Path(tempfile.mkdtemp(prefix="dsh-lease-pres-"))
    try:
        live = empty_lease("quan")
        apply_action(live, a, "acquire", now)
        save_lease(lease_path("quan", box), live)
        stale = empty_lease("boss")
        apply_action(stale, b, "acquire", now - HEARTBEAT_STALE - 5)
        save_lease(lease_path("boss", box), stale)
        rows = {r["login"]: r for r in list_presence(now, box)}
        assert rows["quan"]["online"] is True, rows
        assert rows["boss"]["online"] is False, rows
    finally:
        for p in box.glob("*"):
            p.unlink()
        box.rmdir()

    print("DESK_LEASE_SELFTEST_OK=1")
    return 0


if __name__ == "__main__":
    raise SystemExit(selftest())
