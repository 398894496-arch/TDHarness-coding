"""Task cards: who asked for what, who does it, what was handed in, and which
chat sessions worked on it.

One JSON file holds every card. The people service owns the lock and the
roster; this module owns the rules. Nothing here starts a model or touches a
desk: a card only records, and the agent reads it through the desk's
task_card tool.

Life of a card:  待提交 --submit--> 待审批 --verdict--> 已通过 (archived)
                    ^                    |         \\--> 未通过 --submit--> 待审批
                    \\---- withdraw -----/
"""
from __future__ import annotations

import base64
import hashlib
import json
import mimetypes
import os
import re
import time
from pathlib import Path

TITLE_MAX = 80
TEXT_MAX = 20000
FILE_MAX = 12 * 1024 * 1024
FILES_PER_CARD = 60
FOLDER_SCAN_MAX = 40
EVENTS_MAX = 80
SESSION_RE = re.compile(r"^session-[A-Za-z0-9._-]{1,128}$")
OPEN_STATES = ("待提交", "未通过")
REVIEW_STATES = ("待审批",)
STATES = ("待提交", "待审批", "已通过", "未通过")


class Refused(Exception):
    """A request the rules do not allow; the message is the error code."""


def now_ms() -> int:
    return int(time.time() * 1000)


def new_id(title: str, actor: str, to: str) -> str:
    raw = "%s|%s|%s|%d|%s" % (title, actor, to, now_ms(), os.urandom(4).hex())
    return "tk-" + hashlib.sha256(raw.encode("utf-8")).hexdigest()[:10]


def clean_text(value, limit: int = TEXT_MAX) -> str:
    text = str(value or "").replace("\r\n", "\n")
    text = "".join(ch for ch in text if ch == "\n" or ch == "\t" or ch.isprintable())
    return text.strip()[:limit]


def clean_name(value) -> str:
    """A file name safe to create on Windows and to show back."""
    name = Path(str(value or "")).name
    name = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", name).strip(" .")
    return name[:160] or "file"


class Board:
    def __init__(self, path: Path, company: Path):
        self.path = path
        self.company = company
        self.files_root = company / "_control" / "tickets"

    # -- storage -----------------------------------------------------------
    def load(self) -> dict:
        if not self.path.is_file():
            return {"tickets": []}
        try:
            data = json.loads(self.path.read_text(encoding="utf-8-sig"))
        except (OSError, ValueError):
            return {"tickets": []}
        if not isinstance(data, dict) or not isinstance(data.get("tickets"), list):
            return {"tickets": []}
        return data

    def save(self, data: dict) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_suffix(".tmp")
        tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        os.replace(tmp, self.path)

    # -- who may see / do what ---------------------------------------------
    @staticmethod
    def can_see(who: dict, card: dict) -> bool:
        role = who.get("role")
        login = who.get("login")
        if role == "admin":
            return True
        if card.get("to") == login or card.get("from") == login:
            return True
        return role == "director" and card.get("dept") == who.get("dept")

    @staticmethod
    def can_review(who: dict, card: dict) -> bool:
        role = who.get("role")
        login = who.get("login")
        if role == "admin":
            return True
        if role == "director" and card.get("dept") == who.get("dept") and card.get("to") != login:
            return True
        return card.get("from") == login and card.get("to") != login

    @staticmethod
    def may_issue(who: dict, target: dict) -> bool:
        if target.get("status") == "disabled":
            return False
        if target.get("login") == who.get("login"):
            return True
        role = who.get("role")
        if role == "admin":
            return True
        if role == "director":
            return target.get("dept") == who.get("dept") and target.get("role") != "admin"
        return False

    # -- views ---------------------------------------------------------------
    def task_folder(self, people: dict, card: dict) -> Path | None:
        who = people.get(card.get("to") or "")
        personal = str((who or {}).get("personal") or "").strip()
        if not personal:
            return None
        return Path(personal.replace("\\", "/")) / "tasks" / card["id"]

    def folder_files(self, people: dict, card: dict) -> list:
        folder = self.task_folder(people, card)
        if folder is None or not folder.is_dir():
            return []
        rows = []
        try:
            entries = sorted(folder.iterdir(), key=lambda p: p.stat().st_mtime, reverse=True)
        except OSError:
            return []
        for f in entries[:FOLDER_SCAN_MAX]:
            if not f.is_file() or f.name.startswith("."):
                continue
            rel = self.rel(f)
            if rel is None:
                continue
            st = f.stat()
            rows.append({"name": f.name, "path": rel, "kind": "任务文件夹", "size": st.st_size,
                         "meta": size_text(st.st_size) + " · 任务文件夹", "at": int(st.st_mtime * 1000)})
        return rows

    def view(self, card: dict, who: dict, people: dict) -> dict:
        t = dict(card)
        official = bool(t.get("archived"))
        t["archived"] = official or who.get("login") in (t.get("hidden_by") or [])
        t["archive_locked"] = official
        listed = {f.get("path") for f in t.get("files") or []}
        extra = [f for f in self.folder_files(people, card) if f["path"] not in listed]
        t["files"] = list(t.get("files") or []) + extra
        folder = self.task_folder(people, card)
        t["folder"] = str(folder).replace("\\", "/") if folder is not None else ""
        t["sessionIds"] = [s.get("id") for s in t.get("sessions") or [] if s.get("id")]
        t["may"] = self.abilities(who, card)
        t.pop("hidden_by", None)
        return t

    def abilities(self, who: dict, card: dict) -> dict:
        login = who.get("login")
        role = who.get("role")
        state = card.get("state")
        mine = card.get("to") == login or role == "admin"
        issuer = card.get("from") == login or role == "admin"
        return {
            "edit_assignment": issuer and state in OPEN_STATES,
            "edit_summary": mine and state in OPEN_STATES,
            "submit": mine and state in OPEN_STATES,
            "withdraw": mine and state in ("待审批", "未通过"),
            "review": state in REVIEW_STATES and self.can_review(who, card),
            "files": (mine or issuer) and state in OPEN_STATES,
            "archive_all": issuer,
        }

    def visible(self, who: dict, people: dict) -> list:
        rows = [c for c in self.load()["tickets"] if self.can_see(who, c)]
        rows.sort(key=lambda c: -int(c.get("updated_at") or c.get("created_at") or 0))
        return [self.view(c, who, people) for c in rows]

    def rel(self, path: Path) -> str | None:
        try:
            return path.resolve().relative_to(self.company.resolve()).as_posix()
        except (OSError, ValueError):
            return None

    # -- changes -------------------------------------------------------------
    def apply(self, action: str, who: dict, people: dict, body: dict) -> dict:
        """Run one action. Returns {"ticket": id?, "card": view?, ...extra}."""
        data = self.load()
        cards = data["tickets"]
        login = who.get("login") or ""

        if action == "issue":
            target = people.get(str(body.get("to") or login))
            if target is None:
                raise Refused("no-such-person")
            if not self.may_issue(who, target):
                raise Refused("issue-role")
            title = clean_text(body.get("title"), TITLE_MAX)
            if not title:
                raise Refused("title")
            card = {
                "id": new_id(title, login, target["login"]),
                "title": title,
                "from": login,
                "to": target["login"],
                "dept": target.get("dept") or "",
                "state": "待提交",
                "assignment": clean_text(body.get("assignment")) or title,
                "summary": "",
                "files": [],
                "sessions": [],
                "archived": False,
                "hidden_by": [],
                "created_at": now_ms(),
                "events": [],
            }
            self.event(card, login, "下达给 " + target["login"] if target["login"] != login else "新建")
            cards.append(card)
            folder = self.task_folder(people, card)
            if folder is not None:
                try:
                    folder.mkdir(parents=True, exist_ok=True)
                except OSError:
                    pass
            self.save(data)
            return {"ticket": card["id"], "card": self.view(card, who, people)}

        card = self.find(cards, body.get("ticket"))
        if not self.can_see(who, card):
            raise Refused("ticket-missing")
        may = self.abilities(who, card)
        out: dict = {"ticket": card["id"]}

        if action == "rename":
            if not may["edit_assignment"]:
                raise Refused("rename-role")
            title = clean_text(body.get("title"), TITLE_MAX)
            if not title:
                raise Refused("title")
            self.event(card, login, "改名为「%s」" % title)
            card["title"] = title
        elif action == "edit":
            changed = False
            if "assignment" in body:
                if not may["edit_assignment"]:
                    raise Refused("assignment-locked")
                card["assignment"] = clean_text(body.get("assignment"))
                changed = True
            if "summary" in body:
                if not may["edit_summary"]:
                    raise Refused("summary-locked")
                card["summary"] = clean_text(body.get("summary"))
                changed = True
            if not changed:
                raise Refused("edit-empty")
        elif action == "submit":
            if not may["submit"]:
                raise Refused("submit-role")
            if "summary" in body:
                card["summary"] = clean_text(body.get("summary"))
            if not card.get("summary"):
                raise Refused("summary-empty")
            for name in body.get("names") or []:
                self.attach_named(card, people, str(name))
            card["state"] = "待审批"
            card["submitted_by"] = login
            card["submitted_at"] = now_ms()
            card["verdict"] = ""
            self.event(card, login, "提交验收")
        elif action == "verdict":
            if not may["review"]:
                raise Refused("verdict-role")
            passed = bool(body.get("passed"))
            reason = clean_text(body.get("reason"), 2000)
            if not passed and not reason:
                raise Refused("verdict-reason")
            card["state"] = "已通过" if passed else "未通过"
            card["verdict"] = reason or "通过"
            card["approver"] = login
            card["verdict_at"] = now_ms()
            if passed:
                card["archived"] = True
            self.event(card, login, ("通过" if passed else "打回") + ("：" + reason if reason else ""))
        elif action == "withdraw":
            if not may["withdraw"]:
                raise Refused("withdraw-role")
            card["state"] = "待提交"
            card["submitted_by"] = ""
            self.event(card, login, "撤回修改")
        elif action == "archive":
            archived = bool(body.get("archived"))
            if may["archive_all"]:
                card["archived"] = archived
                card["hidden_by"] = []
            else:
                hidden = [x for x in card.get("hidden_by") or [] if x != login]
                if archived:
                    hidden.append(login)
                card["hidden_by"] = hidden
            self.event(card, login, "归档" if archived else "取消归档")
        elif action == "bind-session":
            sid = str(body.get("session") or "")
            if not SESSION_RE.match(sid):
                raise Refused("session")
            # A session works on one card at a time.
            for other in cards:
                if other is not card and any(s.get("id") == sid for s in other.get("sessions") or []):
                    other["sessions"] = [s for s in other["sessions"] if s.get("id") != sid]
                    other["updated_at"] = now_ms()
            rows = [s for s in card.get("sessions") or [] if s.get("id") != sid]
            title = clean_text(body.get("title"), 120) or sid
            rows.append({"id": sid, "title": title, "account": login, "at": now_ms()})
            card["sessions"] = rows
            self.event(card, login, "关联会话「%s」" % title)
        elif action == "unbind-session":
            sid = str(body.get("session") or "")
            before = len(card.get("sessions") or [])
            card["sessions"] = [s for s in card.get("sessions") or [] if s.get("id") != sid]
            if len(card["sessions"]) != before:
                self.event(card, login, "取消关联一个会话")
        elif action == "attach-file":
            if not may["files"]:
                raise Refused("files-locked")
            rel = self.safe_rel(body.get("path"))
            if rel is None:
                raise Refused("file-path")
            self.add_file(card, {"name": clean_name(body.get("name") or rel.split("/")[-1]), "path": rel,
                                 "kind": clean_text(body.get("kind"), 20) or "文件",
                                 "meta": clean_text(body.get("meta"), 80) or "已挂上", "at": now_ms()})
            self.event(card, login, "挂上文件 " + rel.split("/")[-1])
        elif action == "detach-file":
            if not may["files"]:
                raise Refused("files-locked")
            name = str(body.get("name") or "")
            rel = str(body.get("path") or "")
            card["files"] = [f for f in card.get("files") or []
                             if not ((rel and f.get("path") == rel) or (name and not rel and f.get("name") == name))]
            self.event(card, login, "取下文件 " + (name or rel.split("/")[-1]))
        elif action == "upload":
            if not may["files"]:
                raise Refused("files-locked")
            try:
                raw = base64.b64decode(str(body.get("content") or ""), validate=True)
            except (ValueError, TypeError):
                raise Refused("upload-content")
            if not raw or len(raw) > FILE_MAX:
                raise Refused("upload-size")
            name = clean_name(body.get("name"))
            dest_dir = self.files_root / card["id"]
            dest_dir.mkdir(parents=True, exist_ok=True)
            dest = dest_dir / name
            stem, ext = os.path.splitext(name)
            n = 2
            while dest.exists():
                dest = dest_dir / ("%s-%d%s" % (stem, n, ext))
                n += 1
            dest.write_bytes(raw)
            rel = self.rel(dest) or ""
            self.add_file(card, {"name": dest.name, "path": rel, "kind": "上传", "size": len(raw),
                                 "meta": size_text(len(raw)) + " · 已上传", "at": now_ms()})
            self.event(card, login, "上传 " + dest.name)
        else:
            raise Refused("action-unknown")

        card["updated_at"] = now_ms()
        self.save(data)
        out["card"] = self.view(card, who, people)
        return out

    def read_file(self, who: dict, people: dict, tid, rel) -> tuple[bytes, str]:
        cards = self.load()["tickets"]
        card = self.find(cards, tid)
        if not self.can_see(who, card):
            raise Refused("ticket-missing")
        rel = self.safe_rel(rel)
        if rel is None:
            raise Refused("file-path")
        listed = {f.get("path") for f in card.get("files") or []} | {f["path"] for f in self.folder_files(people, card)}
        if rel not in listed:
            raise Refused("file-not-on-card")
        path = self.company / rel
        if not path.is_file():
            raise Refused("file-missing")
        if path.stat().st_size > FILE_MAX:
            raise Refused("file-too-big")
        return path.read_bytes(), mimetypes.guess_type(path.name)[0] or "application/octet-stream"

    def card_of_session(self, who: dict, people: dict, sid: str) -> dict | None:
        for card in self.load()["tickets"]:
            if any(s.get("id") == sid for s in card.get("sessions") or []) and self.can_see(who, card):
                return self.view(card, who, people)
        return None

    # -- helpers -------------------------------------------------------------
    @staticmethod
    def find(cards: list, tid) -> dict:
        for c in cards:
            if c.get("id") == str(tid or ""):
                return c
        raise Refused("ticket-missing")

    @staticmethod
    def event(card: dict, who: str, what: str) -> None:
        rows = list(card.get("events") or [])
        rows.append({"t": now_ms(), "who": who, "what": what})
        card["events"] = rows[-EVENTS_MAX:]

    def safe_rel(self, raw) -> str | None:
        text = str(raw or "").strip().replace("\\", "/")
        if not text:
            return None
        p = Path(text)
        if not p.is_absolute():
            p = self.company / text
        return self.rel(p)

    @staticmethod
    def add_file(card: dict, row: dict) -> None:
        files = [f for f in card.get("files") or [] if f.get("path") != row["path"]]
        files.append(row)
        if len(files) > FILES_PER_CARD:
            raise Refused("files-full")
        card["files"] = files

    def attach_named(self, card: dict, people: dict, name: str) -> None:
        """Hand-in names produced by a linked session: look in the task folder,
        then the assignee's own workspace (two levels), and attach the first match."""
        name = clean_name(name)
        folder = self.task_folder(people, card)
        roots = [folder] if folder is not None else []
        who = people.get(card.get("to") or "") or {}
        personal = str(who.get("personal") or "").strip()
        if personal:
            roots.append(Path(personal.replace("\\", "/")))
        for root in roots:
            if root is None or not root.is_dir():
                continue
            hits = [root / name] + list(root.glob("*/" + name))
            for hit in hits:
                if hit.is_file():
                    rel = self.rel(hit)
                    if rel:
                        self.add_file(card, {"name": hit.name, "path": rel, "kind": "交付",
                                             "meta": size_text(hit.stat().st_size) + " · 随提交挂上", "at": now_ms()})
                        return


def size_text(n: int) -> str:
    if n < 1024:
        return "%d B" % n
    if n < 1024 * 1024:
        return "%d KB" % round(n / 1024)
    return "%.1f MB" % (n / 1024 / 1024)
