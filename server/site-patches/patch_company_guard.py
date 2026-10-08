"""给 company-shell 的 /company/* 本地路由加来源校验（与官方 /api 的 isTrustedApiRequest 同一判定）。幂等。"""
import sys
from pathlib import Path

GUARD = '''
// /company/* 与官方 /api 用同一套来源判定（dsh-client-connection 的 isTrustedApiRequest）：
// Host 必须是回环，浏览器跨站标记一律拒绝，带 Origin 时必须与 Host 同源。
// 防的是员工打开的任意网页借浏览器打本机 /company/*（改花名册、读邮箱、登出等）。
function companyCallerOk(req) {
	const h = (req && req.headers) || {};
	const one = (v) => (Array.isArray(v) ? v[0] : v);
	const host = one(h.host);
	if (!host) return false;
	let hostUrl;
	try { hostUrl = new URL("http://" + host); } catch { return false; }
	const name = hostUrl.hostname.replace(/^\\[|\\]$/g, "").toLowerCase();
	const loop = name === "localhost" || name.endsWith(".localhost") || name === "::1" || /^127\\./.test(name);
	if (!loop) return false;
	if (String(one(h["sec-fetch-site"]) || "") === "cross-site") return false;
	const origin = one(h.origin);
	if (origin === undefined) return true;
	try { return new URL(origin).host === hostUrl.host; } catch { return false; }
}

function guardCompanyRoute(spec) {
	const inner = spec.handler;
	return Object.assign({}, spec, {
		handler: async (req, res) => {
			if (!companyCallerOk(req)) {
				res.writeHead(403, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
				res.end(JSON.stringify({ ok: false, error: "caller-not-trusted" }));
				return;
			}
			return inner(req, res);
		},
	});
}
'''

ANCHOR_WEB = '\tconst web = typeof ctx.get === "function" ? ctx.get("webServer") : null;\n\tif (web == null || typeof web.register !== "function") return;\n'

def patch(path: Path) -> str:
    t = path.read_text(encoding="utf-8")
    if "function companyCallerOk(" in t:
        return "already"
    crlf = "\r\n" in t
    t = t.replace("\r\n", "\n")
    assert t.count(ANCHOR_WEB) == 1, "web anchor"
    head, tail = t.split(ANCHOR_WEB, 1)
    n = tail.count("web.register(")
    assert n >= 1
    tail = tail.replace("web.register(", "companyWeb.register(")
    t = head + ANCHOR_WEB + "\tconst companyWeb = { register: (spec) => web.register(guardCompanyRoute(spec)) };\n" + tail
    # 守卫函数放在第一个顶层 function 之前（ESM，函数声明会提升，位置只为可读）
    i = t.find("\nfunction ")
    assert i > 0
    t = t[:i] + "\n" + GUARD + t[i:]
    if crlf:
        t = t.replace("\n", "\r\n")
    path.write_text(t, encoding="utf-8")
    return "patched routes=%d" % n

if __name__ == "__main__":
    for a in sys.argv[1:]:
        print(a, patch(Path(a)))
