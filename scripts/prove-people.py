#!/usr/bin/env python3
"""Prove the people API: login rules, role/department changes, departments,
display names and pictures, disabling and token revocation.

Runs server/people-api.py against a throwaway folder on a free port. Prints
no token or password. Ends with PEOPLE_PROVE_OK=1.
"""
from __future__ import annotations

import json
import os
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
API = HERE.parent / "server" / "people-api.py"
PIXEL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="


def free_port() -> int:
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


def call(port: int, method: str, body: dict | None = None, token: str = "") -> tuple[int, dict]:
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request("http://127.0.0.1:%d/company/%s" % (port, "people" if method != "LOGIN" else "login"),
                                 data=data, method="GET" if method == "GET" else "POST")
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", "Bearer " + token)
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return int(resp.status), json.loads(resp.read().decode("utf-8") or "{}")
    except urllib.error.HTTPError as exc:
        return int(exc.code), json.loads(exc.read().decode("utf-8") or "{}")


def check(cond: bool, what: str) -> None:
    if not cond:
        raise SystemExit("PEOPLE_PROVE_FAIL " + what)


def main() -> None:
    root = Path(tempfile.mkdtemp(prefix="tdh-people-"))
    runtime = root / "runtime"
    (runtime / "caddy").mkdir(parents=True)
    # An older roster: no department list, no names.
    (runtime / "roster.json").write_text(json.dumps({"owner": "test", "people": [
        {"login": "tdh", "role": "admin", "dept": "company", "status": "active", "pid": "p-seed"},
    ]}), encoding="utf-8")
    (runtime / "caddy" / "PASSWORDS.txt").write_text("tdh:seed-pass-123\n", encoding="utf-8")
    # Two model calls by tdh, one by an unknown caller, one too old to count.
    usage = runtime / "usage"
    usage.mkdir()
    now_ms = int(time.time() * 1000)
    ledger = [
        {"t": now_ms, "login": "tdh", "model": "grok-4.7", "input": 1000, "output": 200, "cached": 800, "reasoning": 50},
        {"t": now_ms, "login": "tdh", "model": "grok-4.3", "input": 500, "output": 100, "cached": 0, "reasoning": 0},
        {"t": now_ms, "login": "unknown", "model": "grok-4.7", "input": 10, "output": 5, "cached": 0, "reasoning": 0},
        {"t": now_ms - 8 * 86400 * 1000, "login": "tdh", "model": "grok-4.7", "input": 99999, "output": 99999},
    ]
    (usage / time.strftime("usage-%Y-%m.jsonl")).write_text("".join(json.dumps(r) + "\n" for r in ledger), encoding="utf-8")
    port = free_port()
    env = dict(os.environ, TDH_ROOT=str(root), TDH_PEOPLE_PORT=str(port), DSH_LEASE_DIR=str(runtime / "lease"))
    proc = subprocess.Popen([sys.executable, str(API)], env=env, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    try:
        for _ in range(50):
            try:
                socket.create_connection(("127.0.0.1", port), timeout=0.2).close()
                break
            except OSError:
                time.sleep(0.1)

        code, hit = call(port, "LOGIN", {"username": "tdh", "password": "seed-pass-123"})
        check(code == 200 and hit.get("ok"), "seed login")
        admin = hit["gw_token"]

        # Usage: the last 7 days by person and by model, older lines left out.
        req = urllib.request.Request("http://127.0.0.1:%d/company/mailbox" % port, method="GET")
        req.add_header("Authorization", "Bearer " + admin)
        with urllib.request.urlopen(req, timeout=10) as resp:
            box = json.loads(resp.read().decode("utf-8"))
        spend = box["spend"]
        check(spend["total_tokens"] == 1815, "total tokens %r" % spend["total_tokens"])
        models = {m["key"]: m for m in spend["by_model"]}
        check(models["grok-4.7"]["calls"] == 2 and models["grok-4.7"]["tokens"] == 1215 and models["grok-4.7"]["cached"] == 800, "by model %r" % models)
        floor = {r["login"]: r for r in box["floor"]}
        check(floor["tdh"]["tokens_7d"] == 1800 and floor["tdh"]["calls_7d"] == 2, "floor %r" % floor["tdh"])

        # Departments: an older roster gets one seeded from its people, with a readable name.
        code, got = call(port, "GET")
        check(got.get("depts") == [{"id": "company", "name": "公司"}], "seeded departments %r" % got.get("depts"))

        # Only an admin manages people.
        code, got = call(port, "POST", {"action": "dept-add", "name": "运营部"})
        check(code == 403, "no token is refused")

        # Department add / rename / duplicate / remove rules.
        code, got = call(port, "POST", {"action": "dept-add", "name": "运营部"}, admin)
        check(code == 200, "dept-add")
        ops = next(d["id"] for d in got["depts"] if d["name"] == "运营部")
        code, got = call(port, "POST", {"action": "dept-add", "name": "运营部"}, admin)
        check(got.get("error") == "dept-name-taken", "duplicate department name")
        code, got = call(port, "POST", {"action": "dept-rename", "id": ops, "name": "直播运营"}, admin)
        check(any(d["name"] == "直播运营" for d in got["depts"]), "dept-rename")

        # Login rules.
        for bad in ("张三", "../evil", "a:b", "UPPER", "x"):
            code, got = call(port, "POST", {"action": "add", "login": bad, "password": "longenough1", "dept": ops}, admin)
            check(got.get("error") == "login-bad", "login %r refused, got %r" % (bad, got.get("error")))
        code, got = call(port, "POST", {"action": "add", "login": "tdh", "password": "longenough1"}, admin)
        check(got.get("error") == "login-taken", "seed login cannot be added again")
        code, got = call(port, "POST", {"action": "add", "login": "zhangsan", "password": "short", "dept": ops}, admin)
        check(got.get("error") == "password-too-short", "short password")
        code, got = call(port, "POST", {"action": "add", "login": "zhangsan", "password": "longenough1", "dept": "nope"}, admin)
        check(got.get("error") == "dept-unknown", "unknown department")
        code, got = call(port, "POST", {"action": "add", "login": "zhangsan", "name": "张三", "password": "longenough1", "dept": ops}, admin)
        check(code == 200, "add zhangsan")
        row = next(p for p in got["people"] if p["login"] == "zhangsan")
        check(row["name"] == "张三" and row["dept"] == ops and row["role"] == "employee", "new person fields %r" % row)
        code, got = call(port, "POST", {"action": "add", "login": "zhangsan", "password": "longenough1", "dept": ops}, admin)
        check(got.get("error") == "login-taken", "duplicate login")

        # A department with people in it cannot be removed.
        code, got = call(port, "POST", {"action": "dept-remove", "id": ops}, admin)
        check(got.get("error") == "dept-not-empty", "dept-remove refuses a non-empty department")

        # Role / department / name changes; the seed admin keeps its role.
        code, got = call(port, "POST", {"action": "set", "login": "zhangsan", "role": "director", "dept": "company", "name": "张三丰"}, admin)
        row = next(p for p in got["people"] if p["login"] == "zhangsan")
        check(row["role"] == "director" and row["dept"] == "company" and row["name"] == "张三丰", "set %r" % row)
        code, got = call(port, "POST", {"action": "set", "login": "tdh", "role": "employee"}, admin)
        check(got.get("error") == "protect-seed-admin", "seed admin cannot be demoted")
        code, got = call(port, "POST", {"action": "dept-remove", "id": ops}, admin)
        check(code == 200 and not any(d["id"] == ops for d in got["depts"]), "empty department removed")

        # Everyone edits their own name and picture; a bad picture is refused.
        code, hit = call(port, "LOGIN", {"username": "zhangsan", "password": "longenough1"})
        check(code == 200, "new person logs in")
        mine = hit["gw_token"]
        code, got = call(port, "POST", {"action": "self", "name": "小张", "avatar": PIXEL}, mine)
        row = next(p for p in got["people"] if p["login"] == "zhangsan")
        check(row["name"] == "小张" and row["avatar"] == PIXEL, "self edit")
        code, got = call(port, "POST", {"action": "self", "avatar": "javascript:alert(1)"}, mine)
        check(got.get("error") == "avatar-bad", "bad avatar refused")
        code, got = call(port, "POST", {"action": "set", "login": "tdh", "name": "x"}, mine)
        check(code == 403, "a non-admin cannot edit others")

        # Token revocation and disabling.
        code, got = call(port, "POST", {"action": "gw-revoke", "login": "zhangsan"}, admin)
        check(got.get("revoked") == 1, "gw-revoke revoked %r" % got.get("revoked"))
        code, got = call(port, "POST", {"action": "self", "name": "y"}, mine)
        check(code == 403, "a revoked token no longer works")
        code, got = call(port, "POST", {"action": "disable", "login": "zhangsan"}, admin)
        check(next(p for p in got["people"] if p["login"] == "zhangsan")["status"] == "disabled", "disable")
        code, hit = call(port, "LOGIN", {"username": "zhangsan", "password": "longenough1"})
        check(code == 401, "a disabled person cannot log in")
        code, got = call(port, "POST", {"action": "enable", "login": "zhangsan"}, admin)
        code, hit = call(port, "LOGIN", {"username": "zhangsan", "password": "longenough1"})
        check(code == 200, "an enabled person logs in again")
        code, got = call(port, "POST", {"action": "disable", "login": "tdh"}, admin)
        check(got.get("error") == "protect-seed-admin", "seed admin cannot be disabled")
        code, got = call(port, "POST", {"action": "gw-revoke", "login": "tdh"}, admin)
        check(got.get("error") == "protect-seed-admin", "seed admin token cannot be revoked")
        code, got = call(port, "POST", {"action": "nonsense"}, admin)
        check(got.get("error") == "action-unknown", "unknown action")
    finally:
        proc.terminate()
        proc.wait(timeout=5)
    print("PEOPLE_PROVE_OK=1")


if __name__ == "__main__":
    main()
