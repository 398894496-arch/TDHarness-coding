#!/usr/bin/env python3
"""Prove task cards end to end through the people service: issue rules, the
submit / review / withdraw cycle, session links, the task folder, uploads and
reads, archive, and that changes need a live gateway token.

Runs server/people-api.py against a throwaway folder on a free port. Prints
no token or password. Ends with TICKETS_PROVE_OK=1.
"""
from __future__ import annotations

import base64
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


def free_port() -> int:
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


class Client:
    def __init__(self, port: int):
        self.port = port

    def post(self, path: str, body: dict, token: str = "") -> tuple[int, dict]:
        req = urllib.request.Request("http://127.0.0.1:%d%s" % (self.port, path),
                                     data=json.dumps(body).encode("utf-8"), method="POST")
        req.add_header("Content-Type", "application/json")
        if token:
            req.add_header("Authorization", "Bearer " + token)
        try:
            with urllib.request.urlopen(req, timeout=10) as resp:
                return int(resp.status), json.loads(resp.read().decode("utf-8") or "{}")
        except urllib.error.HTTPError as exc:
            return int(exc.code), json.loads(exc.read().decode("utf-8") or "{}")

    def login(self, user: str) -> str:
        code, hit = self.post("/company/login", {"username": user, "password": "pass-" + user + "-123"})
        assert code == 200, (user, hit)
        return hit["gw_token"]

    def box(self, token: str, **body) -> tuple[int, dict]:
        return self.post("/company/mailbox", body, token)


def check(cond: bool, what: str) -> None:
    if not cond:
        raise SystemExit("TICKETS_PROVE_FAIL " + what)


def card(j: dict, tid: str) -> dict:
    for t in j.get("tickets") or []:
        if t.get("id") == tid:
            return t
    return {}


def main() -> None:
    root = Path(tempfile.mkdtemp(prefix="tdh-tickets-"))
    runtime = root / "runtime"
    company = root / "company"
    (runtime / "caddy").mkdir(parents=True)
    people = [
        ("boss", "admin", "ops"), ("lead", "director", "ops"), ("amy", "employee", "ops"),
        ("bob", "employee", "ops"), ("vic", "employee", "live"),
    ]
    roster = {"people": []}
    for login, role, dept in people:
        personal = company / ("emp-" + login)
        personal.mkdir(parents=True)
        roster["people"].append({"login": login, "role": role, "dept": dept, "status": "active",
                                 "pid": "p-" + login, "personal": str(personal)})
    (runtime / "roster.json").write_text(json.dumps(roster), encoding="utf-8")
    (runtime / "caddy" / "PASSWORDS.txt").write_text("".join("%s:pass-%s-123\n" % (p[0], p[0]) for p in people), encoding="utf-8")
    (company / "secret.txt").write_text("not on any card", encoding="utf-8")

    port = free_port()
    env = dict(os.environ, TDH_ROOT=str(root), TDH_PEOPLE_PORT=str(port), DSH_LEASE_DIR=str(runtime / "lease"))
    env["TDH_ROSTER"] = str(runtime / "roster.json")
    proc = subprocess.Popen([sys.executable, str(API)], env=env, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    try:
        for _ in range(50):
            try:
                socket.create_connection(("127.0.0.1", port), timeout=0.2).close()
                break
            except OSError:
                time.sleep(0.1)
        c = Client(port)
        boss, lead, amy, bob, vic = (c.login(x) for x in ("boss", "lead", "amy", "bob", "vic"))

        # Changes need a live token; a login named in the body is not trusted.
        code, j = c.post("/company/mailbox", {"action": "issue", "login": "boss", "to": "amy", "title": "x"})
        check(code == 403, "issue without a token is refused")

        # Issue rules: anyone for themselves, director inside the dept, admin anywhere.
        code, j = c.box(amy, action="issue", to="amy", title="自己的任务", assignment="整理素材")
        check(code == 200 and j.get("ticket", "").startswith("tk-"), "employee issues to self")
        code, j = c.box(amy, action="issue", to="bob", title="x")
        check(j.get("error") == "issue-role", "employee cannot issue to others")
        code, j = c.box(lead, action="issue", to="vic", title="x")
        check(j.get("error") == "issue-role", "director cannot issue outside the dept")
        code, j = c.box(boss, action="issue", to="amy", title="做一条口播", assignment="脚本 + 成片")
        tid = j["ticket"]
        t = card(j, tid)
        check(t["state"] == "待提交" and t["to"] == "amy" and t["from"] == "boss", "issued card %r" % t)
        check(t["folder"].endswith("emp-amy/tasks/" + tid), "task folder %r" % t["folder"])
        check(Path(t["folder"]).is_dir(), "task folder is created")

        # Visibility: the assignee, the issuer, the dept director, admin; not another employee.
        check(card(c.box(bob)[1] if False else c.post("/company/mailbox", {}, bob)[1], tid) == {}, "bob does not see amy's card")
        check(card(c.post("/company/mailbox", {}, lead)[1], tid) != {}, "director sees cards of the dept")
        check(card(c.post("/company/mailbox", {}, vic)[1], tid) == {}, "another dept does not see it")

        # What each person may do, as the card reports it.
        may = card(c.post("/company/mailbox", {}, amy)[1], tid)["may"]
        check(may["edit_summary"] and may["submit"] and not may["edit_assignment"] and not may["review"], "amy may %r" % may)

        # Drafts are saved on the card; the assignment is the issuer's.
        code, j = c.box(amy, action="edit", ticket=tid, summary="初稿写好了")
        check(card(j, tid)["summary"] == "初稿写好了", "summary draft saved")
        code, j = c.box(amy, action="edit", ticket=tid, assignment="改任务")
        check(j.get("error") == "assignment-locked", "assignee cannot rewrite the assignment")

        # Sessions: linked, and a session moves when linked to another card.
        sid = "session-abc123"
        code, j = c.box(amy, action="bind-session", ticket=tid, session=sid, title="写脚本")
        check([s["id"] for s in card(j, tid)["sessions"]] == [sid], "session linked")
        code, j = c.box(amy, action="session-card", session=sid)
        check(j.get("card", {}).get("id") == tid, "the session finds its card")
        code, j = c.box(amy, action="issue", to="amy", title="另一张")
        other = j["ticket"]
        code, j = c.box(amy, action="bind-session", ticket=other, session=sid, title="写脚本")
        check(card(j, tid)["sessions"] == [] and len(card(j, other)["sessions"]) == 1, "a session moves to the newer card")
        c.box(amy, action="bind-session", ticket=tid, session=sid, title="写脚本")
        code, j = c.box(amy, action="bind-session", ticket=tid, session="../evil", title="x")
        check(j.get("error") == "session", "bad session id refused")

        # The task folder: a file the agent writes there is a deliverable.
        (Path(t["folder"]) / "成片.mp4").write_bytes(b"0" * 2048)
        files = card(c.post("/company/mailbox", {}, amy)[1], tid)["files"]
        check(any(f["name"] == "成片.mp4" and f["kind"] == "任务文件夹" for f in files), "folder file listed %r" % files)

        # Upload, read back, and no reading files that are not on the card.
        payload = base64.b64encode("脚本 v1".encode("utf-8")).decode("ascii")
        code, j = c.box(amy, action="upload", ticket=tid, name="../../脚本.txt", content=payload)
        up = [f for f in card(j, tid)["files"] if f["kind"] == "上传"]
        check(len(up) == 1 and up[0]["name"] == "脚本.txt", "uploaded with a safe name %r" % up)
        code, j = c.box(boss, action="file", ticket=tid, path=up[0]["path"])
        check(base64.b64decode(j["content"]).decode("utf-8") == "脚本 v1", "file read back")
        code, j = c.box(boss, action="file", ticket=tid, path="secret.txt")
        check(j.get("error") == "file-not-on-card", "a file not on the card cannot be read")
        code, j = c.box(boss, action="file", ticket=tid, path="../runtime/roster.json")
        check(j.get("error") in ("file-path", "file-not-on-card"), "no reading outside the company folder")
        code, j = c.box(amy, action="attach-file", ticket=tid, path="../../etc/passwd")
        check(j.get("error") == "file-path", "attach outside the company folder refused")

        # Submit, review (the assignee cannot approve), reject with a reason, resubmit, pass.
        code, j = c.box(bob, action="submit", ticket=tid, summary="x")
        check(j.get("error") == "ticket-missing", "someone else cannot submit (cannot even see it)")
        code, j = c.box(amy, action="submit", ticket=tid, summary="成片和脚本都在")
        check(card(j, tid)["state"] == "待审批", "submitted")
        code, j = c.box(amy, action="edit", ticket=tid, summary="偷改")
        check(j.get("error") == "summary-locked", "the report is locked while under review")
        code, j = c.box(amy, action="verdict", ticket=tid, passed=True)
        check(j.get("error") == "verdict-role", "the assignee cannot approve")
        code, j = c.box(lead, action="verdict", ticket=tid, passed=False)
        check(j.get("error") == "verdict-reason", "rejecting needs a reason")
        code, j = c.box(lead, action="verdict", ticket=tid, passed=False, reason="字幕错别字")
        check(card(j, tid)["state"] == "未通过", "rejected")
        code, j = c.box(amy, action="submit", ticket=tid, summary="已改字幕")
        code, j = c.box(boss, action="verdict", ticket=tid, passed=True, reason="")
        t = card(j, tid)
        check(t["state"] == "已通过" and t["archived"] and t["archive_locked"], "passed and archived %r" % t["state"])
        whats = [e["what"] for e in t["events"]]
        check(whats[0].startswith("下达给 amy") and "提交验收" in whats and any(w.startswith("打回") for w in whats), "activity %r" % whats)

        # Withdraw while under review, and a personal archive does not hide it for others.
        code, j = c.box(amy, action="submit", ticket=other, summary="完成")
        code, j = c.box(amy, action="withdraw", ticket=other)
        check(card(j, other)["state"] == "待提交", "withdrawn")
        code, j = c.box(lead, action="archive", ticket=other, archived=True)
        check(card(j, other)["archived"] is True, "director hides it for himself")
        check(card(c.post("/company/mailbox", {}, amy)[1], other)["archived"] is False, "amy still sees it open")
    finally:
        proc.terminate()
        proc.wait(timeout=5)
    print("TICKETS_PROVE_OK=1")


if __name__ == "__main__":
    main()
