"""desk-lease.js：工作区路径的 realpath 与 DSH 内核同一实现（native）。幂等。
fs.realpathSync（JS 实现）对 UNC 共享根返回 \\\\host\\share\\（带尾斜杠），内核用 fs.promises.realpath（libuv）
返回不带尾斜杠的，attach 严格比对失败：session/workspace-attach-failed（2026-10-08 员工电脑实测）。"""
import sys
from pathlib import Path

OLD = "    if (fs.existsSync(n)) return fs.realpathSync(n);\n"
NEW = ("    // 必须和 DSH 内核的 fs.promises.realpath 同一实现（libuv）：JS 版 realpathSync 对 UNC 共享根\n"
       "    // 多带一个尾斜杠，团队工作区（共享盘根）attach 时会和会话 cwd 对不上。\n"
       "    if (fs.existsSync(n)) return (fs.realpathSync.native || fs.realpathSync)(n);\n")


def patch(t):
    if "realpathSync.native" in t:
        return t, "already"
    if t.count(OLD) != 1:
        raise SystemExit("anchor-desk-lease count=%d" % t.count(OLD))
    return t.replace(OLD, NEW, 1), "patched"


if __name__ == "__main__":
    for a in sys.argv[1:]:
        p = Path(a); raw = p.read_text(encoding="utf-8"); crlf = "\r\n" in raw
        t, how = patch(raw.replace("\r\n", "\n"))
        if how == "patched":
            p.write_text(t.replace("\n", "\r\n") if crlf else t, encoding="utf-8")
        print(a, how)
