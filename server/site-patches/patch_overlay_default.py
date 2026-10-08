"""overlay.yml：公司模型来源 + 默认模型（幂等）。overlay 每次启动从安装包同步、最后一层生效。
- Grok 来源 office（网关 8450）：原来只在管理员用「设置 > 模型」配置后才写进各自本机配置，
  普通员工没有，默认模型指向不存在的来源，退回 DeepSeek 官方线路报 MISSING_CREDENTIAL（2026-10-08 实测）。
- 默认 grok-4.7 + High，会话里仍可手动切换。
- 关掉员工端的厂商直连（DeepSeek 官方线路）：订阅和 key 只在服务器，客户端只走网关。
网关地址取 overlay 里 company-grok-media 的 baseURL（安装时已改写成站点地址）。"""
import re
import sys
from pathlib import Path

PROVIDER_MARK = "# @@company-grok-provider"
NO_DIRECT_MARK = "# @@company-no-direct-vendor"
NO_DIRECT_ROW = NO_DIRECT_MARK + """
# 员工端不直连任何模型厂商：订阅和 key 只放服务器，经网关 8450 反代分发给客户端。
# 内核自带的 DeepSeek 官方直连：插件保留（内核 SDK 引用它），模型清空，key 指向一个永不设置的变量。
# 公司要给员工用 DeepSeek：key 填服务器 gateway.env，模型加到上面的 office 来源里。
- id: llm-deepseek
  config:
    apiKeyEnv: DEEPSEEK_OFFICIAL_KEY
    models: []
"""
DEFAULT_ROW = """# 公司默认模型：新会话一律 grok-4.7 + High（2026-10-08 定）。会话里仍可手动切换。
- id: agent-default-model
  config:
    provider: office
    model: grok-4.7
    reasoningEffort: high
"""


def provider_row(base):
    models = ""
    for mid in ("grok-4.7", "grok-4.6"):
        models += (
            "          - id: %s\n            name: %s\n            contextWindow: 500000\n"
            "            input: [text, image]\n            reasoningEfforts:\n"
            "              low: low\n              medium: medium\n              high: high\n              xhigh: xhigh\n" % (mid, mid)
        )
    return (
        PROVIDER_MARK + "\n"
        "# 公司 Grok 来源，所有角色都有（不再依赖管理员在设置页配置过）。key 是桌面启动时注入的网关令牌。\n"
        "- id: llm-pi-ai\n  config:\n    providers:\n      office:\n"
        "        displayName: Grok\n        apiKeyEnv: GROK_API_KEY\n        api: openai-completions\n"
        "        baseURL: %s/v1\n        reasoning: high\n        compat:\n"
        "          supportsStore: false\n          supportsDeveloperRole: false\n"
        "          supportsReasoningEffort: true\n          supportsUsageInStreaming: true\n"
        "        models:\n%s" % (base, models)
    )


def patch(t):
    out = t if t.endswith("\n") else t + "\n"
    changed = False
    # 模板自带 llm-pi-ai（办公室包：经办公室网关的多家模型）就以模板为准，不覆盖它的模型列表。
    has_pi = re.search(r"(?m)^- id: llm-pi-ai$", out) is not None
    if PROVIDER_MARK not in out and not has_pi:
        m = re.search(r"- id: company-grok-media\n  config:\n    baseURL: (\S+)", out)
        if not m:
            raise SystemExit("anchor-overlay-grok-media-baseURL")
        out += provider_row(m.group(1).rstrip("/"))
        changed = True
    if NO_DIRECT_MARK not in out and re.search(r"(?m)^- id: llm-deepseek$", out) is None:
        out += NO_DIRECT_ROW
        changed = True
    # 默认模型强制为公司定的值：模板里可能已有别的默认（办公室包是 grok-4.6 / medium），不能见到就跳过。
    want = DEFAULT_ROW.split("\n", 1)[1]
    block = re.search(r"(?m)^- id: agent-default-model\n(?:  .*\n)*", out)
    if block is None:
        out += DEFAULT_ROW
        changed = True
    elif block.group(0) != want:
        out = out[: block.start()] + want + out[block.end():]
        changed = True
    # tool-web：搜索 170 秒（深搜 40~70 秒，60 秒卡边界）、抓取 90 秒、每次一条查询。保留模板里的其它键。
    tw = re.search(r"(?m)^- id: tool-web\n(?:  .*\n)*", out)
    if tw is not None:
        body = tw.group(0)
        nb = body
        for key, val in (("searchTimeoutMs", "170000"), ("fetchTimeoutMs", "90000"), ("searchMaxQueries", "1")):
            if re.search(r"(?m)^    %s:" % key, nb):
                nb = re.sub(r"(?m)^    %s:.*$" % key, "    %s: %s" % (key, val), nb)
            else:
                nb = nb.rstrip("\n") + "\n    %s: %s\n" % (key, val)
        if nb != body:
            out = out[: tw.start()] + nb + out[tw.end():]
            changed = True
    return (out, "patched") if changed else (t, "already")


if __name__ == "__main__":
    for a in sys.argv[1:]:
        p = Path(a); raw = p.read_text(encoding="utf-8"); crlf = "\r\n" in raw
        t, how = patch(raw.replace("\r\n", "\n"))
        if how == "patched":
            p.write_text(t.replace("\n", "\r\n") if crlf else t, encoding="utf-8")
        print(a, how)
