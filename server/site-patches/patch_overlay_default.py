"""overlay.yml（幂等）。overlay 每次启动从安装包同步、最后一层生效，所以这里只放必须对所有桌面强制的东西：
- 关掉员工端的厂商直连（DeepSeek 官方线路）：订阅和 key 只在服务器，客户端只走网关。
- tool-web：搜索 170 秒、抓取 90 秒、每次一条查询（深搜 40~70 秒，60 秒卡边界）。
模型列表和默认模型不写在这里：员工端登录后从网关 /v1/company-models 同步（company-shell，@@model-sync），
写在 overlay 里会在每次启动时盖掉同步结果。旧版本写进来的 Grok 来源块和默认模型行会被清掉。
站点仍可显式指定默认模型（--default-model/--default-effort），用于还没有 company-models 接口的网关（办公室 gw-mux）。
"""
import re
import sys
from pathlib import Path

PROVIDER_MARK = "# @@company-grok-provider"
NO_DIRECT_MARK = "# @@company-no-direct-vendor"
NO_DIRECT_ROW = NO_DIRECT_MARK + """
# 员工端不直连任何模型厂商：订阅和 key 只放服务器，经网关 8450 反代分发给客户端。
# 内核自带的 DeepSeek 官方直连：插件保留（内核 SDK 引用它），模型清空，key 指向一个永不设置的变量。
- id: llm-deepseek
  config:
    apiKeyEnv: DEEPSEEK_OFFICIAL_KEY
    models: []
"""
SITE_DEFAULT_NOTE = "# 站点指定的默认模型（打包参数 --default-model），会话里仍可手动切换。\n"
OLD_PROVIDER_BLOCK = re.compile(r"(?m)^# @@company-grok-provider\n(?:#[^\n]*\n)*- id: llm-pi-ai\n(?:  [^\n]*\n)*")
OLD_DEFAULT_ROW = re.compile(r"(?m)^# (?:公司默认模型|站点指定的默认模型)[^\n]*\n- id: agent-default-model\n(?:  [^\n]*\n)*")
ANY_DEFAULT_ROW = re.compile(r"(?m)^- id: agent-default-model\n(?:  [^\n]*\n)*")


def default_block(model, effort):
    b = "- id: agent-default-model\n  config:\n    provider: office\n    model: %s\n" % model
    if effort:
        b += "    reasoningEffort: %s\n" % effort
    return b


def patch(t, default_model=None, default_effort=None):
    out = t if t.endswith("\n") else t + "\n"
    # 旧版本写进来的静态 Grok 来源：现在由登录后的同步写，留着会盖掉同步结果。
    out = OLD_PROVIDER_BLOCK.sub("", out)
    if default_model:
        want = SITE_DEFAULT_NOTE + default_block(default_model, default_effort)
        m = OLD_DEFAULT_ROW.search(out) or ANY_DEFAULT_ROW.search(out)
        if m is None:
            out += want
        elif m.group(0) != want:
            out = out[: m.start()] + want + out[m.end():]
    else:
        out = OLD_DEFAULT_ROW.sub("", out)
    if NO_DIRECT_MARK not in out and re.search(r"(?m)^- id: llm-deepseek$", out) is None:
        out += NO_DIRECT_ROW
    tw = re.search(r"(?m)^- id: tool-web\n(?:  .*\n)*", out)
    if tw is not None:
        body = tw.group(0)
        nb = body
        for key, val in (("searchTimeoutMs", "170000"), ("fetchTimeoutMs", "90000"), ("searchMaxQueries", "1")):
            if re.search(r"(?m)^    %s:" % key, nb):
                nb = re.sub(r"(?m)^    %s:.*$" % key, "    %s: %s" % (key, val), nb)
            else:
                nb = nb.rstrip("\n") + "\n    %s: %s\n" % (key, val)
        out = out[: tw.start()] + nb + out[tw.end():]
    return (out, "patched") if out != (t if t.endswith("\n") else t + "\n") else (t, "already")


if __name__ == "__main__":
    args = sys.argv[1:]
    dm = de = None
    if "--default-model" in args:
        i = args.index("--default-model"); dm = args[i + 1]; del args[i:i + 2]
    if "--default-effort" in args:
        i = args.index("--default-effort"); de = args[i + 1]; del args[i:i + 2]
    for a in args:
        p = Path(a); raw = p.read_text(encoding="utf-8"); crlf = "\r\n" in raw
        t, how = patch(raw.replace("\r\n", "\n"), dm, de)
        if how == "patched":
            p.write_text(t.replace("\n", "\r\n") if crlf else t, encoding="utf-8")
        print(a, how)
