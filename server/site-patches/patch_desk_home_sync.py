"""Mac sync-desk-home.sh：只在包里确实带了 ego-browser 时才要求它的 cosmokit 依赖（幂等）。
ego-browser 已不随包发（配置里本来就禁用），旧检查找不到依赖就 exit 2，Mac 客户端停在「正在打开本机 Agent…」
（2026-10-09 实测：公开 Mac 包和办公室 Mac 包都打不开）。"""
import sys
from pathlib import Path

OLD = """    if cosmokit_ok; then
      echo "EGO_COSMOKIT_REQUIRE=1"
    else
      echo "EGO_COSMOKIT_REQUIRE=0" >&2
      exit 2
    fi
"""
NEW = """    if [[ ! -d "$SRC/profiles/web/node_modules/ego-browser" ]]; then
      # ego-browser is not shipped (disabled in the overlay); nothing to require.
      echo "EGO_COSMOKIT_REQUIRE=not-shipped"
    elif cosmokit_ok; then
      echo "EGO_COSMOKIT_REQUIRE=1"
    else
      echo "EGO_COSMOKIT_REQUIRE=0" >&2
      exit 2
    fi
"""


def patch(t):
    if "EGO_COSMOKIT_REQUIRE=not-shipped" in t:
        return t, "already"
    if t.count(OLD) != 1:
        raise SystemExit("anchor-desk-home-sync count=%d" % t.count(OLD))
    return t.replace(OLD, NEW, 1), "patched"


if __name__ == "__main__":
    for a in sys.argv[1:]:
        p = Path(a); raw = p.read_text(encoding="utf-8"); crlf = "\r\n" in raw
        t, how = patch(raw.replace("\r\n", "\n"))
        if how == "patched":
            p.write_text(t.replace("\n", "\r\n") if crlf else t, encoding="utf-8")
        print(a, how)
