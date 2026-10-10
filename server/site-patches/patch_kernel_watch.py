"""内核页「运行中」读这个进程真正在跑的内核（幂等）。
原来 Mac 上写死读 ~/dsh-kernel/0-1-7-rc-2，不管桌子实际跑什么都显示 0.1.7-rc.2；
2026-10-10 实测桌子跑的是安装包自带的 0.2.1-alpha.1，页面却说 0.1.7-rc.2，「升级」建议因此是错的。
现在先看本进程：process.argv[1] 是 .../@deepseek-ai/dsh/lib/bin.js，往上找它自己的 package.json；
找不到才退回原来的固定路径。
"""
import sys
from pathlib import Path

MARK = "@@kernel-live-v1"
OLD = "function liveKernelVersion() {\n\tconst files = [];\n"
NEW = (
    "function liveKernelVersion() {\n"
    "\t// The kernel running this very process: argv[1] is .../@deepseek-ai/dsh/lib/bin.js. " + MARK + "\n"
    "\ttry {\n"
    "\t\tlet dir = path.dirname(String(process.argv[1] || \"\"));\n"
    "\t\tfor (let i = 0; i < 4 && dir; i++) {\n"
    "\t\t\tconst meta = readJson(path.join(dir, \"package.json\"));\n"
    "\t\t\tif (meta && meta.name === \"@deepseek-ai/dsh\" && meta.version) return String(meta.version);\n"
    "\t\t\tconst up = path.dirname(dir);\n"
    "\t\t\tif (up === dir) break;\n"
    "\t\t\tdir = up;\n"
    "\t\t}\n"
    "\t} catch {\n"
    "\t\t/* fall back to the install paths below */\n"
    "\t}\n"
    "\tconst files = [];\n"
)


def patch(t: str) -> tuple[str, str]:
    if MARK in t:
        return t, "already"
    if t.count(OLD) != 1:
        raise SystemExit("anchor-kernel-live count=%d" % t.count(OLD))
    return t.replace(OLD, NEW, 1), "patched-kernel-live"


if __name__ == "__main__":
    for a in sys.argv[1:]:
        p = Path(a)
        raw = p.read_text(encoding="utf-8"); crlf = "\r\n" in raw
        t, how = patch(raw.replace("\r\n", "\n"))
        if how.startswith("patched"):
            p.write_text(t.replace("\n", "\r\n") if crlf else t, encoding="utf-8")
        print(a, how)
