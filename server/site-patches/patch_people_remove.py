"""人员页：停用之后可以真正删除账号（幂等）。
原来只有「停用」和「吊销令牌」。吊销令牌只作废当前令牌，账号和密码都还在，重新登录就领到新令牌；
停用的人也一直留在花名册和 PASSWORDS.txt 里。人员服务新增 remove 动作，这里在已停用的人后面加「删除」
按钮和确认条，并补上对应的错误提示。只有已停用、不是种子管理员的人才显示这个按钮。
"""
import sys
from pathlib import Path

MARK = "@@people-remove-v1"

ERR_OLD = '\t\t\tif (s.indexOf("no-such-person") >= 0) return "花名册里没有这个人";\n'
ERR_NEW = ERR_OLD + (
    '\t\t\t// 删除账号的提示。' + MARK + '\n'
    '\t\t\tif (s.indexOf("remove-active") >= 0) return "先停用这个账号，再删除";\n'
    '\t\t\tif (s.indexOf("login-retired") >= 0) return "这个登录名属于已删除的账号，换一个登录名";\n'
    '\t\t\tif (s.indexOf("remove-self") >= 0) return "不能删除自己的账号";\n'
)

BTN_OLD = (
    '\t\t\t\t\t\t\tonClick: function () { pendingHook[1]({ kind: off ? "enable" : "disable", login: p.login }); }\n'
    '\t\t\t\t\t\t}),\n'
)
BTN_NEW = BTN_OLD + (
    '\t\t\t\t\t\tseed || !off ? null : btn("删除", {\n'
    '\t\t\t\t\t\t\tkey: "remove",\n'
    '\t\t\t\t\t\t\tsmall: true,\n'
    '\t\t\t\t\t\t\ttone: "danger",\n'
    '\t\t\t\t\t\t\tdisabled: busy,\n'
    '\t\t\t\t\t\t\tonClick: function () { pendingHook[1]({ kind: "remove", login: p.login }); }\n'
    '\t\t\t\t\t\t}),\n'
)

ASK_OLD = (
    '\t\t\t\t\t} else {\n'
    '\t\t\t\t\t\ttext = p.login + " 当前的模型令牌立刻失效，下次登录会领新的。";\n'
)
ASK_NEW = (
    '\t\t\t\t\t} else if (pending === "remove") {\n'
    '\t\t\t\t\t\ttext = "删除后 " + p.login + " 从花名册消失，密码作废，这个登录名不再发放。个人文件夹留在公司盘上，不删。";\n'
    '\t\t\t\t\t\tgo = "确定删除";\n'
    '\t\t\t\t\t\tbody = { action: "remove", login: p.login };\n'
    '\t\t\t\t\t\tokNote = "已删除 " + p.login;\n'
) + ASK_OLD

DESC_OLD = '"发放账号，管理部门，调整角色。停用会同时吊销这个人的模型令牌。"'
DESC_NEW = '"发放账号，管理部门，调整角色。停用会同时吊销这个人的模型令牌；停用后可以删除账号。"'


def once(t, old, new, what):
    if t.count(old) != 1:
        raise SystemExit("anchor-%s count=%d" % (what, t.count(old)))
    return t.replace(old, new, 1)


def patch(t: str) -> tuple[str, str]:
    if MARK in t:
        return t, "already"
    t = once(t, ERR_OLD, ERR_NEW, "people-remove-err")
    t = once(t, BTN_OLD, BTN_NEW, "people-remove-btn")
    t = once(t, ASK_OLD, ASK_NEW, "people-remove-ask")
    t = once(t, DESC_OLD, DESC_NEW, "people-remove-desc")
    return t, "patched-people-remove"


if __name__ == "__main__":
    for a in sys.argv[1:]:
        p = Path(a)
        raw = p.read_text(encoding="utf-8"); crlf = "\r\n" in raw
        t, how = patch(raw.replace("\r\n", "\n"))
        if how.startswith("patched"):
            p.write_text(t.replace("\n", "\r\n") if crlf else t, encoding="utf-8")
        print(a, how)
