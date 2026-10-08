"""overlay.yml：公司默认模型 grok-4.7 + High（幂等）。overlay 每次启动都从安装包同步、最后一层生效，
所以所有客户端新会话默认都是它；会话里仍可手动切换。2026-10-08 用户要求。"""
import sys
from pathlib import Path

ROW = """# 公司默认模型：新会话一律 grok-4.7 + High（2026-10-08 定）。会话里仍可手动切换。
- id: agent-default-model
  config:
    provider: office
    model: grok-4.7
    reasoningEffort: high
"""


def patch(t):
    if "id: agent-default-model" in t:
        return t, "already"
    if not t.endswith("\n"):
        t += "\n"
    return t + ROW, "patched"


if __name__ == "__main__":
    for a in sys.argv[1:]:
        p = Path(a); raw = p.read_text(encoding="utf-8"); crlf = "\r\n" in raw
        t, how = patch(raw.replace("\r\n", "\n"))
        if how == "patched":
            p.write_text(t.replace("\n", "\r\n") if crlf else t, encoding="utf-8")
        print(a, how)
