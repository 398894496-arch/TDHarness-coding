"""每扇网关门都带个人令牌（幂等）。网关 8450 现在对模型、搜索、抓取、生图、生视频都要登录令牌。
1) company-web-search / company-grok-media 原来只从 DEEPSEEK_API_KEY 取令牌。Windows 的 AppHost 把令牌放在
   GROK_API_KEY 并删掉 DEEPSEEK_API_KEY（那个名字留给模型页的官方 key），所以 Win 端搜索和生图一直没带令牌。
   改为 GROK_API_KEY、DEEPSEEK_API_KEY 里哪个是 dsh_ 令牌用哪个。
2) Mac 的 start.command 登录后只导出 DEEPSEEK_API_KEY，内核的 office 通道读 GROK_API_KEY，模型请求没带令牌。
   登录后同时导出 GROK_API_KEY。
"""
import sys
from pathlib import Path

MARK = "@@gw-token-v1"

OLD_JS = """function tokenOf() {
  return process.env.DEEPSEEK_API_KEY || "";
}
"""
NEW_JS = """function tokenOf() {
  // 网关每扇门都认个人令牌。Win 端令牌在 GROK_API_KEY，Mac 端在 DEEPSEEK_API_KEY。""" + MARK + """
  for (const v of [process.env.GROK_API_KEY, process.env.DEEPSEEK_API_KEY]) {
    if (v && /^dsh_/.test(v)) return v;
  }
  return "";
}
"""

OLD_SH = """  DEEPSEEK_API_KEY="$(tr -d '\\r\\n' < "$TOKFILE")"
  export DEEPSEEK_API_KEY
fi
"""
NEW_SH = OLD_SH + """# 内核的 office 通道读 GROK_API_KEY：模型请求也带个人令牌。""" + MARK + """
case "${DEEPSEEK_API_KEY:-}" in
  dsh_*) export GROK_API_KEY="$DEEPSEEK_API_KEY" ;;
esac
"""


def once(t, old, new, what):
    if t.count(old) != 1:
        raise SystemExit("anchor-%s count=%d" % (what, t.count(old)))
    return t.replace(old, new, 1)


def patch_js(t: str) -> tuple[str, str]:
    if MARK in t:
        return t, "already"
    return once(t, OLD_JS, NEW_JS, "gw-token-js"), "patched-gw-token"


def patch_sh(t: str) -> tuple[str, str]:
    if MARK in t:
        return t, "already"
    return once(t, OLD_SH, NEW_SH, "gw-token-sh"), "patched-gw-token"


def for_member(rel):
    """按相对 CompanyDesk/ 的路径给出补丁函数；不归这里管的返回 None。"""
    if rel.endswith("company-web-search/lib/index.js") or rel.endswith("company-grok-media/lib/index.js"):
        return patch_js
    if rel == "start.command":
        return patch_sh
    return None


if __name__ == "__main__":
    for a in sys.argv[1:]:
        p = Path(a)
        fn = patch_sh if p.name == "start.command" else patch_js
        raw = p.read_text(encoding="utf-8"); crlf = "\r\n" in raw
        t, how = fn(raw.replace("\r\n", "\n"))
        if how.startswith("patched"):
            p.write_text(t.replace("\n", "\r\n") if crlf else t, encoding="utf-8")
        print(a, how)
