"""company-shell：员工端启动时从网关同步模型列表和站点默认模型（幂等）。
订阅和 key 只在服务器；网关 /v1/company-models 列出这台服务器真正能调的模型（Grok 订阅、各家 key、
自定义地址）和站点默认（gateway.env 的 DEFAULT_MODEL / DEFAULT_EFFORT）。所有角色登录后都同步，
不再依赖管理员在设置页点「应用」，也不在公开模板里写死某一家。网关没有这个接口（旧网关、办公室 gw-mux）时什么都不做。
"""
import sys
from pathlib import Path

MARK = "@@model-sync"
SYNC = '''
// 员工端启动时从网关同步模型列表和站点默认模型。@@model-sync
// 网关 /v1/company-models 只列这台服务器真正能调的模型；所有角色都同步，选择器里不会出现调不通的模型。
// 网关没有这个接口（旧网关）时不做任何改动。
async function syncCompanyModels(ctx) {
	const settings = settingsOf(ctx);
	if (!settings) return;
	const out = await proxyGw("/v1/company-models", "GET", Buffer.alloc(0));
	if (!out || out.status !== 200) return;
	let j = null;
	try { j = JSON.parse(out.body.toString("utf8")); } catch { return; }
	const models = cleanModelPicks((j && Array.isArray(j.models) ? j.models : []).map((m) => ({
		id: m && m.id, efforts: m && m.efforts, image: !!(m && m.image), context: m && m.context, fast: false,
	})));
	if (!models.length) return;
	await settings.mutate("llm-pi-ai", [{ op: "set", path: ["providers", "office"], value: grokProviderObject(models, gwBase() + "/v1") }]);
	const d = j.default;
	if (d && typeof d.model === "string" && models.some((m) => m.id === d.model)) {
		const ops = [
			{ op: "set", path: ["provider"], value: "office" },
			{ op: "set", path: ["model"], value: d.model },
		];
		const pick = models.find((m) => m.id === d.model);
		if (typeof d.effort === "string" && pick && pick.efforts.indexOf(d.effort) >= 0) ops.push({ op: "set", path: ["reasoningEffort"], value: d.effort });
		await settings.mutate("agent-default-model", ops);
	}
}
'''

APPLY_OLD = "export function apply(ctx) {\n\tconst tools = typeof ctx.get === \"function\" ? ctx.get(\"tools\") : ctx.tools;\n"
APPLY_NEW = APPLY_OLD + "\t// 内核的设置服务就绪后再同步；失败不影响启动，下次登录再试。\n\tsetTimeout(() => { syncCompanyModels(ctx).catch(() => {}); }, 3000);\n"


def once(t, old, new, what):
    if t.count(old) != 1:
        raise SystemExit("anchor-%s count=%d" % (what, t.count(old)))
    return t.replace(old, new, 1)


def patch(t):
    if MARK in t:
        return t, "already"
    # 网关现在不止 Grok：选择器里的分组名改成「公司模型」
    if t.count('\t\t"        displayName: Grok",\n') == 1:
        t = t.replace('\t\t"        displayName: Grok",\n', '\t\t"        displayName: 公司模型",\n', 1)
    if t.count('\t\tdisplayName: "Grok",\n') == 1:
        t = t.replace('\t\tdisplayName: "Grok",\n', '\t\tdisplayName: "公司模型",\n', 1)
    t = once(t, "\nexport function apply(ctx) {\n", "\n" + SYNC.lstrip("\n") + "\nexport function apply(ctx) {\n", "sync-def")
    t = once(t, APPLY_OLD, APPLY_NEW, "apply-call")
    return t, "patched"


if __name__ == "__main__":
    for a in sys.argv[1:]:
        p = Path(a); raw = p.read_text(encoding="utf-8"); crlf = "\r\n" in raw
        t, how = patch(raw.replace("\r\n", "\n"))
        if how == "patched":
            p.write_text(t.replace("\n", "\r\n") if crlf else t, encoding="utf-8")
        print(a, how)
