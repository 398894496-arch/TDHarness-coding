"""账号页（幂等）：告诉每个人知识库会记下什么、谁能看到。

员工和 AI 的对话每天夜里会进公司知识库，这件事要让本人知道，不能只写在管理员手册里。
可见范围和 server/knowledge-search.js（办公室：p-org-memory/knowledge-search.js）一致。
"""
import sys
from pathlib import Path

MARK = "@@kb-notice-v1"

ANCHOR = '\t\t\t\t\tsetRow("logout", {\n\t\t\t\t\t\ttitle: "退出登录",'

NOTICE = (
    '\t\t\t\t\t// 知识库收录告知。' + MARK + '\n'
    '\t\t\t\t\tsetRow("kb-notice", {\n'
    '\t\t\t\t\t\ttitle: "知识库会记下什么",\n'
    '\t\t\t\t\t\tdesc: "你在这台工作台上和 AI 的对话，每天夜里会整理进公司知识库。'
    '原始对话只有你本人、本部门主管和管理员能逐份调阅，不会出现在别人的搜索里；'
    '每天的工作摘要你本人、本部门主管和管理员能搜到；被采纳的经验本部门能搜到；'
    '你自己记下的个人记忆只有你能搜到；公司手册和公司共享记忆全员能搜到。'
    '不想进知识库的私事，请不要在工作台里说。"\n'
    '\t\t\t\t\t}),\n'
)


def patch(t: str) -> tuple[str, str]:
    if MARK in t:
        return t, "already"
    if t.count(ANCHOR) != 1:
        raise SystemExit("anchor-kb-notice count=%d" % t.count(ANCHOR))
    return t.replace(ANCHOR, NOTICE + ANCHOR, 1), "patched-kb-notice"


if __name__ == "__main__":
    for a in sys.argv[1:]:
        p = Path(a)
        raw = p.read_text(encoding="utf-8"); crlf = "\r\n" in raw
        t, how = patch(raw.replace("\r\n", "\n"))
        if how.startswith("patched"):
            p.write_text(t.replace("\n", "\r\n") if crlf else t, encoding="utf-8")
        print(a, how)
