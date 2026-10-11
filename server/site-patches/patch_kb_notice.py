"""账号页（幂等）：告诉每个人知识库会记下什么、谁能看到（v2：连同公司盘上的文件夹）。

员工和 AI 的对话每天夜里会进公司知识库，这件事要让本人知道，不能只写在管理员手册里。
可见范围和 server/knowledge-search.js（办公室：p-org-memory/knowledge-search.js）一致。
"""
import sys
from pathlib import Path

MARK = "@@kb-notice-v2"
OLD_MARK = "@@kb-notice-v1"

ANCHOR = '\t\t\t\t\tsetRow("logout", {\n\t\t\t\t\t\ttitle: "退出登录",'

# v1 promised only what the search enforced; the files themselves were open on the share
# (third-party review, 2026-10-11). v2 says what both the search and the folders enforce
# (server/secure-folders.ps1), and that the server's administrators can open everything.
OLD_DESC = (
    '你在这台工作台上和 AI 的对话，每天夜里会整理进公司知识库。'
    '原始对话只有你本人、本部门主管和管理员能逐份调阅，不会出现在别人的搜索里；'
    '每天的工作摘要你本人、本部门主管和管理员能搜到；被采纳的经验本部门能搜到；'
    '你自己记下的个人记忆只有你能搜到；公司手册和公司共享记忆全员能搜到。'
    '不想进知识库的私事，请不要在工作台里说。'
)
DESC = (
    '你在这台工作台上和 AI 的对话，每天夜里会整理进公司知识库。'
    '原始对话、个人记忆和任务交付物都在你的个人文件夹里，只有你本人、本部门主管和管理员能打开，'
    '同事在公司盘上看不到、在知识库里也搜不到；'
    '每天的工作摘要你本人、本部门主管和管理员能搜到；被采纳的经验本部门能搜到；'
    '公司手册和公司共享记忆全员能看，只有管理员和主管能改。'
    '服务器的管理员能看到服务器上的所有文件。'
    '不想进知识库的私事，请不要在工作台里说。'
)

NOTICE = (
    '\t\t\t\t\t// 知识库收录告知。' + MARK + '\n'
    '\t\t\t\t\tsetRow("kb-notice", {\n'
    '\t\t\t\t\t\ttitle: "知识库会记下什么",\n'
    '\t\t\t\t\t\tdesc: "' + DESC + '"\n'
    '\t\t\t\t\t}),\n'
)


def patch(t: str) -> tuple[str, str]:
    if MARK in t:
        return t, "already"
    if OLD_MARK in t:
        if t.count(OLD_DESC) != 1:
            raise SystemExit("anchor-kb-notice-v1 count=%d" % t.count(OLD_DESC))
        return t.replace(OLD_DESC, DESC, 1).replace(OLD_MARK, MARK, 1), "patched-kb-notice-v2"
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
