"""人员页和账号页（幂等）：
1) 「吊销令牌」改名「强制重新登录」，确认条写清账号和密码都不变；要让人彻底用不了是「停用」。
   老板实测把「吊销令牌」当成了删除。
2) 登录名上限 16 位：个人共享盘账号是 smb-<登录名>，Windows 用户名最长 20。
3) 账号页可以自己改密码（要原密码），补上对应的错误提示。
"""
import sys
from pathlib import Path

MARK = "@@people-wording-v1"

PAIRS = [
    ("btn",
     'seed ? null : btn("吊销令牌", {',
     'seed ? null : btn("强制重新登录", {'),
    ("ask",
     'text = p.login + " 当前的模型令牌立刻失效，下次登录会领新的。";',
     'text = p.login + " 要重新输入账号密码才能继续用，账号和密码都不变。要让他彻底用不了，请用「停用」。";'),
    ("go",
     'go = "确定吊销";',
     'go = "确定";'),
    ("ok",
     'okNote = "已吊销 " + p.login + " 的网关令牌";',
     'okNote = p.login + " 下次操作时要重新登录";'),
    ("foot",
     '种子管理员不能停用或降权，但可以吊销令牌。',
     '种子管理员不能停用、删除或降权，但可以强制重新登录。'),
    ("login",
     '登录名只能用小写字母、数字和 . _ -，2 到 32 位',
     '登录名只能用小写字母、数字和 . _ -，2 到 16 位'),
    ("err",
     '\t\t\tif (s.indexOf("password-bad") >= 0) return "密码里不能有换行";\n',
     '\t\t\tif (s.indexOf("password-bad") >= 0) return "密码里不能有换行";\n'
     '\t\t\t// 自己改密码的提示。' + MARK + '\n'
     '\t\t\tif (s.indexOf("password-wrong") >= 0) return "原密码不对";\n'
     '\t\t\tif (s.indexOf("password-same") >= 0) return "新密码和原密码一样";\n'
     '\t\t\tif (s.indexOf("self-not-supported") >= 0) return "这台服务器还不支持在这里改，请找管理员";\n'),
    ("hook",
     '\t\t\tconst editHook = React.useState(null);\n\t\t\tconst armHook = useArm();\n\t\t\tconst fileRef = React.useRef(null);',
     '\t\t\tconst editHook = React.useState(null);\n\t\t\tconst armHook = useArm();\n\t\t\tconst fileRef = React.useRef(null);\n'
     '\t\t\tconst pwHook = React.useState(null);'),
    ("row",
     '\t\t\t\t\tsetRow("logout", {',
     '\t\t\t\t\tsetRow("password", {\n'
     '\t\t\t\t\t\ttitle: "修改密码",\n'
     '\t\t\t\t\t\tdesc: "下次登录用新密码，这台电脑现在不用重新登录。",\n'
     '\t\t\t\t\t\tside: pwHook[0] ? null : btn("修改密码", { small: true, tone: "ghost", disabled: busyHook[0], onClick: function () { pwHook[1]({ old: "", next: "", again: "" }); } })\n'
     '\t\t\t\t\t}),\n'
     '\t\t\t\t\tpwHook[0] ? el("form", {\n'
     '\t\t\t\t\t\tclassName: "cs-confirm",\n'
     '\t\t\t\t\t\tkey: "pw-form",\n'
     '\t\t\t\t\t\tonSubmit: function (ev) {\n'
     '\t\t\t\t\t\t\tev.preventDefault();\n'
     '\t\t\t\t\t\t\tconst f = pwHook[0];\n'
     '\t\t\t\t\t\t\tif (!f.old) { noteHook[1]("先填原密码。"); return; }\n'
     '\t\t\t\t\t\t\tif (f.next.length < 8) { noteHook[1]("新密码至少 8 位。"); return; }\n'
     '\t\t\t\t\t\t\tif (f.next !== f.again) { noteHook[1]("两次输入的新密码不一样。"); return; }\n'
     '\t\t\t\t\t\t\tsaveSelf({ password_old: f.old, password_new: f.next }, "密码已修改，下次登录用新密码。").then(function (ok) { if (ok) pwHook[1](null); });\n'
     '\t\t\t\t\t\t}\n'
     '\t\t\t\t\t},\n'
     '\t\t\t\t\t\tel("input", { className: "cs-input", type: "password", autoFocus: true, placeholder: "原密码", autoComplete: "current-password", value: pwHook[0].old, onChange: function (e) { pwHook[1](Object.assign({}, pwHook[0], { old: e.target.value })); } }),\n'
     '\t\t\t\t\t\tel("input", { className: "cs-input", type: "password", placeholder: "新密码（至少 8 位）", autoComplete: "new-password", value: pwHook[0].next, onChange: function (e) { pwHook[1](Object.assign({}, pwHook[0], { next: e.target.value })); } }),\n'
     '\t\t\t\t\t\tel("input", { className: "cs-input", type: "password", placeholder: "再输一次新密码", autoComplete: "new-password", value: pwHook[0].again, onChange: function (e) { pwHook[1](Object.assign({}, pwHook[0], { again: e.target.value })); } }),\n'
     '\t\t\t\t\t\tbtn("保存", { submit: true, small: true, tone: "primary", disabled: busyHook[0] }),\n'
     '\t\t\t\t\t\tbtn("取消", { small: true, tone: "ghost", onClick: function () { pwHook[1](null); } })\n'
     '\t\t\t\t\t) : null,\n'
     '\t\t\t\t\tsetRow("logout", {'),
]


def once(t, old, new, what):
    if t.count(old) != 1:
        raise SystemExit("anchor-people-wording-%s count=%d" % (what, t.count(old)))
    return t.replace(old, new, 1)


def patch(t: str) -> tuple[str, str]:
    if MARK in t:
        return t, "already"
    for what, old, new in PAIRS:
        t = once(t, old, new, what)
    return t, "patched-people-wording"


if __name__ == "__main__":
    for a in sys.argv[1:]:
        p = Path(a)
        raw = p.read_text(encoding="utf-8"); crlf = "\r\n" in raw
        t, how = patch(raw.replace("\r\n", "\n"))
        if how.startswith("patched"):
            p.write_text(t.replace("\n", "\r\n") if crlf else t, encoding="utf-8")
        print(a, how)
