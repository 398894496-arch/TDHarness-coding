import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import https from "node:https";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { URL } from "node:url";
import { writeMemory } from "./memory-write.js";
import { watchVideo } from "./video-watch.js";
import { kernelWatchCutover, kernelWatchPlug, kernelWatchPublish, kernelWatchSnapshot, kernelWatchUpgrade } from "./kernel-watch.js";

const OPENCLI_STORE =
	"https://chromewebstore.google.com/detail/opencli/ildkmabpimmkaediidaifkhjpohdnifk";
const OPENCLI_PKG = "@jackwener/opencli";

export const name = "company-shell";
export const inject = ["webServer", "tools", "systemPrompt"];

function rcDir() {
	return process.env.DSH_COMPANY_RC || path.join(os.homedir(), ".dsh-company-rc8");
}

function readTrim(p) {
	try {
		return readFileSync(p, "utf8").trim();
	} catch {
		return "";
	}
}

function siteBase() {
	return readTrim(path.join(rcDir(), "site.login")) || "https://{{TDH_HOST}}:8443";
}

function gwToken() {
	return process.env.DEEPSEEK_API_KEY || readTrim(path.join(rcDir(), "gw.token"));
}

function loginRoleFile() {
	const r = readTrim(path.join(rcDir(), "login.role"));
	if (r === "admin" || r === "director" || r === "employee") return r;
	return "employee";
}

function loginNameFile() {
	const named = readTrim(path.join(rcDir(), "login.name"));
	if (named) return named;
	const smb = readTrim(path.join(rcDir(), "smb.user"));
	if (smb.indexOf("smb-") === 0) return smb.slice(4);
	return smb;
}

function gwBase() {
	const raw = process.env.DEEPSEEK_BASE_URL || "";
	if (raw && raw.indexOf("__SITE_") < 0) return raw.replace(/\/v1\/?$/, "");
	try {
		const u = new URL(siteBase());
		return "http://" + u.hostname + ":8450";
	} catch {
		return "http://{{TDH_HOST}}:8450";
	}
}

// company-apply-models-local-v1
// The model list a person confirms belongs to the desk they are sitting at. The
// gateway used to write it, which only ever reached the desk on the server
// itself and, there, only the install template. This side owns the file.
const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/;
const DEFAULT_GROK = "grok-4.7";
const EFFORT = /^[a-z]{1,12}$/;
// The kernel only accepts these level names. The value beside each is what the
// vendor is sent, so xAI's "none" has to sit under "off"; written as
// `none: none` the whole provider row fails validation and no model loads.
const LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];

function levelOf(effort) {
	const key = effort === "none" ? "off" : effort;
	return LEVELS.indexOf(key) >= 0 ? key : "";
}

function userPatchFile() {
	const home = process.env.DSH_HOME || "";
	return home ? path.join(home, "profiles", "web", "cordis.patch.yml") : "";
}

/** Chosen models as sent by the settings page, with anything unsafe to write dropped. */
export function cleanModelPicks(models) {
	const out = [];
	const seen = new Set();
	for (const m of Array.isArray(models) ? models : []) {
		const id = m && typeof m.id === "string" ? m.id : "";
		if (!MODEL_ID.test(id) || seen.has(id)) continue;
		seen.add(id);
		const efforts = [];
		for (const e of Array.isArray(m.efforts) ? m.efforts : []) {
			if (typeof e === "string" && EFFORT.test(e) && efforts.indexOf(e) < 0) efforts.push(e);
		}
		// `fast` is the vendor's priority service tier. The gateway adds it per
		// request; it is not a reasoning level and does not go into the profile.
		// The window the gateway measured for this model; the desk's meter and its
		// compaction point both come from this number.
		const context = Number.isInteger(m.context) && m.context >= 8000 && m.context <= 4000000 ? m.context : 0;
		out.push({ id, efforts: efforts.filter((e) => levelOf(e) !== ""), fast: m.fast === true, image: m.image === true, context });
	}
	return out;
}

function grokProviderLines(models, baseURL) {
	const lines = [
		"      office:",
		"        displayName: Grok",
		"        apiKeyEnv: GROK_API_KEY",
		"        api: openai-completions",
		"        baseURL: " + baseURL,
	];
	// The official picker adds a "Default" row unless this profile-level value
	// is a level every listed model really offers.
	if (models.every((m) => m.efforts.indexOf("high") >= 0)) lines.push("        reasoning: high");
	lines.push(
		"        compat:",
		"          supportsStore: false",
		"          supportsDeveloperRole: false",
		"          supportsReasoningEffort: true",
		"          supportsUsageInStreaming: true",
		"        models:",
	);
	for (const m of models) {
		lines.push(
			"          - id: " + m.id,
			"            name: " + m.id,
			"            contextWindow: " + (m.context || 256000),
			// Without `image` here the kernel refuses a message that carries a
			// picture, and the composer just hands the draft back with no reason.
			"            input: " + (m.image ? "[text, image]" : "[text]"),
		);
		if (m.efforts.length) {
			lines.push("            reasoningEfforts:");
			for (const e of m.efforts) lines.push("              " + levelOf(e) + ": " + e);
		}
	}
	return lines;
}

/**
 * Rewrite the user patch so the Grok provider lists exactly `models`.
 * Other rows, and other providers under the same row, are kept as written.
 */
export function applyGrokModels(text, models, baseURL) {
	const nl = text.indexOf("\r\n") >= 0 ? "\r\n" : "\n";
	const lines = text.length ? text.split(/\r?\n/) : [];
	while (lines.length && lines[lines.length - 1].trim() === "") lines.pop();
	if (lines.length === 1 && lines[0].trim() === "[]") lines.pop();
	const office = models.length ? grokProviderLines(models, baseURL) : [];
	let start = -1;
	for (let i = 0; i < lines.length; i++) {
		if (/^- id: llm-pi-ai\s*$/.test(lines[i])) { start = i; break; }
	}
	if (start < 0) {
		if (!office.length) return text;
		lines.push("- id: llm-pi-ai", '  name: "@deepseek-ai/dsh-llm-pi-ai"', "  config:", "    providers:", ...office);
		return lines.join(nl) + nl;
	}
	let end = lines.length;
	for (let i = start + 1; i < lines.length; i++) {
		if (/^- /.test(lines[i])) { end = i; break; }
	}
	const block = lines.slice(start, end);
	let at = -1;
	for (let i = 1; i < block.length; i++) {
		if (/^    providers:/.test(block[i])) { at = i; break; }
	}
	const kept = [];
	let after = at + 1;
	if (at >= 0) {
		let keep = false;
		for (; after < block.length; after++) {
			const line = block[after];
			if (line.trim() !== "" && !/^ {6}/.test(line)) break;
			const key = /^ {6}([^\s#:][^:]*):/.exec(line);
			if (key) keep = key[1].trim() !== "office";
			if (keep) kept.push(line);
		}
	}
	const providers = kept.concat(office);
	const head = at >= 0 ? block.slice(0, at) : block.slice();
	const tail = at >= 0 ? block.slice(after) : [];
	if (at < 0 && !head.some((l) => /^  config:\s*$/.test(l))) head.push("  config:");
	const next = head.concat(providers.length ? ["    providers:", ...providers] : ["    providers: {}"], tail);
	lines.splice(start, end - start, ...next);
	return lines.join(nl) + nl;
}

function grokProviderObject(models, baseURL) {
	const office = {
		displayName: "Grok",
		apiKeyEnv: "GROK_API_KEY",
		api: "openai-completions",
		baseURL,
	};
	if (models.every((m) => m.efforts.indexOf("high") >= 0)) office.reasoning = "high";
	office.compat = {
		supportsStore: false,
		supportsDeveloperRole: false,
		supportsReasoningEffort: true,
		supportsUsageInStreaming: true,
	};
	office.models = models.map((m) => {
		const row = { id: m.id, name: m.id, contextWindow: m.context || 256000, input: m.image ? ["text", "image"] : ["text"] };
		if (m.efforts.length) {
			row.reasoningEfforts = {};
			for (const e of m.efforts) row.reasoningEfforts[levelOf(e)] = e;
		}
		return row;
	});
	return office;
}

function settingsOf(ctx) {
	let settings = null;
	try { settings = typeof ctx.get === "function" ? ctx.get("settings") : null; } catch { settings = null; }
	return settings && typeof settings.mutate === "function" && typeof settings.describe === "function" ? settings : null;
}

/** The Grok models this desk currently lists, in the shape the settings page ticks. */
export function pickedGrokModels(ctx) {
	const settings = settingsOf(ctx);
	if (!settings) return [];
	let row = null;
	try { row = settings.describe().find((r) => r.ns === "llm-pi-ai"); } catch { row = null; }
	const office = row && row.value && row.value.providers ? row.value.providers.office : null;
	const out = [];
	for (const m of office && Array.isArray(office.models) ? office.models : []) {
		if (!m || typeof m.id !== "string") continue;
		const levels = m.reasoningEfforts && typeof m.reasoningEfforts === "object" ? m.reasoningEfforts : {};
		out.push({ id: m.id, efforts: Object.keys(levels).map((k) => String(levels[k])) });
	}
	return out;
}

/**
 * Through the kernel's own settings service the change is live: the composer
 * lists the models without a restart, and the kernel validates what is written.
 * The file path below is only for a kernel that does not offer the service.
 */
async function writeGrokModels(ctx, models) {
	const settings = settingsOf(ctx);
	if (settings) {
		const op = models.length
			? { op: "set", path: ["providers", "office"], value: grokProviderObject(models, gwBase() + "/v1") }
			: { op: "unset", path: ["providers", "office"] };
		await settings.mutate("llm-pi-ai", [op]);
		if (models.length) {
			// A default that is no longer listed shows up as a raw id nobody can send to.
			try {
				const row = settings.describe().find((r) => r.ns === "agent-default-model");
				const cur = row && row.value ? row.value : {};
				if (cur.provider !== "office" || !models.some((m) => m.id === cur.model)) {
					// The product default is grok-4.7 at high. Fall back to the first
					// listed model only when 4.7 is not among the chosen ones.
					const pick = models.find((m) => m.id === DEFAULT_GROK) || models[0];
					const ops = [
						{ op: "set", path: ["provider"], value: "office" },
						{ op: "set", path: ["model"], value: pick.id },
					];
					if (pick.efforts.indexOf("high") >= 0) ops.push({ op: "set", path: ["reasoningEffort"], value: "high" });
					await settings.mutate("agent-default-model", ops);
				}
			} catch {}
		}
		return { ok: true, written: 1, count: models.length, live: true };
	}
	return writeGrokModelsFile(models);
}

function writeGrokModelsFile(models) {
	const file = userPatchFile();
	if (!file) return { ok: false, error: "no-desk-home" };
	let text = "";
	try { text = readFileSync(file, "utf8"); } catch { text = ""; }
	const next = applyGrokModels(text, models, gwBase() + "/v1");
	mkdirSync(path.dirname(file), { recursive: true });
	const tmp = file + ".tmp";
	writeFileSync(tmp, next);
	renameSync(tmp, file);
	return { ok: true, written: 1, count: models.length, live: false };
}

function proxyGw(pathName, method, body) {
	const u = new URL(pathName, gwBase() + "/");
	const tok = gwToken();
	const lib = u.protocol === "http:" ? http : https;
	const headers = { Accept: "application/json" };
	if (tok) headers.Authorization = "Bearer " + tok;
	if (body && body.length) {
		headers["Content-Type"] = "application/json";
		headers["Content-Length"] = String(body.length);
	}
	return new Promise((resolve) => {
		const req = lib.request(
			{
				method,
				hostname: u.hostname,
				port: u.port || (u.protocol === "http:" ? 80 : 443),
				path: u.pathname,
				rejectUnauthorized: false,
				headers,
			},
			(res) => {
				const chunks = [];
				res.on("data", (c) => chunks.push(c));
				res.on("end", () => {
					resolve({
						status: res.statusCode || 502,
						body: Buffer.concat(chunks),
					});
				});
			},
		);
		req.on("error", (err) => {
			resolve({
				status: 502,
				body: Buffer.from(JSON.stringify({ ok: false, error: "gw-proxy " + String(err && err.message || err) })),
			});
		});
		if (body && body.length) req.write(body);
		req.end();
	});
}

function clearLoginFiles() {
	const dir = rcDir();
	// Same set AppHost.ClearLogin / Mac quit wipe. Next launch types the password.
	["gw.token", "smb.pass", "smb.user", "login.role", "login.name"].forEach(function (name) {
		const p = path.join(dir, name);
		try {
			if (existsSync(p)) unlinkSync(p);
		} catch {
			// keep going; the client still tells the user to quit
		}
	});
}

function collect(req) {
	return new Promise((resolve, reject) => {
		const chunks = [];
		req.on("data", (c) => chunks.push(c));
		req.on("end", () => resolve(Buffer.concat(chunks)));
		req.on("error", reject);
	});
}

function proxyCompany(pathName, method, body) {
	const u = new URL(pathName, siteBase());
	const tok = gwToken();
	const lib = u.protocol === "http:" ? http : https;
	const headers = {
		Accept: "application/json",
	};
	if (tok) {
		headers.Authorization = "Bearer " + tok;
		headers["X-Company-Gw-Token"] = tok;
	}
	if (body && body.length) {
		headers["Content-Type"] = "application/json";
		headers["Content-Length"] = String(body.length);
	}
	return new Promise((resolve) => {
		const req = lib.request(
			{
				method,
				hostname: u.hostname,
				port: u.port || (u.protocol === "http:" ? 80 : 443),
				path: u.pathname + (u.search || ""),
				rejectUnauthorized: false,
				headers,
			},
			(res) => {
				const chunks = [];
				res.on("data", (c) => chunks.push(c));
				res.on("end", () => {
					resolve({
						status: res.statusCode || 502,
						body: Buffer.concat(chunks),
						contentType: String(res.headers["content-type"] || ""),
					});
				});
			},
		);
		req.on("error", (err) => {
			resolve({
				status: 502,
				body: Buffer.from(JSON.stringify({ ok: false, error: "company-proxy " + String(err && err.message || err) })),
				contentType: "",
			});
		});
		if (body && body.length) req.write(body);
		req.end();
	});
}

function proxyKnowledge(bodyObj, pathname) {
	const raw = Buffer.from(JSON.stringify(bodyObj || {}), "utf8");
	const u = new URL(pathname || "/company/knowledge/v1/search", siteBase());
	const tok = gwToken();
	const lib = u.protocol === "http:" ? http : https;
	const headers = {
		Accept: "application/json",
		"Content-Type": "application/json",
		"Content-Length": String(raw.length),
	};
	if (tok && tok !== "company-gateway") {
		headers.Authorization = "Bearer " + tok;
		headers["X-Company-Gw-Token"] = tok;
	}
	return new Promise((resolve) => {
		const req = lib.request(
			{
				method: "POST",
				hostname: u.hostname,
				port: u.port || (u.protocol === "http:" ? 80 : 443),
				path: u.pathname,
				rejectUnauthorized: false,
				headers,
			},
			(res) => {
				const chunks = [];
				res.on("data", (c) => chunks.push(c));
				res.on("end", () => {
					let json = {};
					try {
						json = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
					} catch {
						json = { ok: false, status: "bad-json" };
					}
					resolve({ status: res.statusCode || 502, json });
				});
			},
		);
		req.on("error", (err) => {
			resolve({
				status: 502,
				json: { ok: false, status: "knowledge-proxy", error: String(err && err.message || err) },
			});
		});
		req.write(raw);
		req.end();
	});
}

const knowledgeSess = new Map();
const webSess = new Map();

function sessionIdOf(exec) {
	return String(
		(exec &&
			exec.agent &&
			exec.agent.session &&
			exec.agent.session.header &&
			exec.agent.session.header.id) ||
			"desk",
	);
}

function knowledgeState(exec) {
	const sid = sessionIdOf(exec);
	if (!knowledgeSess.has(sid)) {
		knowledgeSess.set(sid, {
			status: false,
			stems: new Map(),
			mapRows: new Set(),
			haveHits: false,
			evidence: false,
			dumpBlocked: false,
			offMapStop: false,
			namedPaths: new Set(),
		});
	}
	return knowledgeSess.get(sid);
}

function webState(exec) {
	const sid = sessionIdOf(exec);
	if (!webSess.has(sid)) webSess.set(sid, { search: 0, fetch: 0 });
	return webSess.get(sid);
}

/** Per-session HOST caps. 2026-09-10: was 2/2/1; incomplete evidence. */
export const WEB_SEARCH_BUDGET = 16;
export const WEB_FETCH_BUDGET = 16;
export const WEB_SEARCH_MAX_QUERIES = 8;

export function queryStem(q) {
	return String(q || "")
		.toLowerCase()
		.replace(/有限公司|网络科技|科技|公司/g, "")
		.replace(/[\s,，、._-]+/g, "")
		.slice(0, 16);
}

export function isCompanyPublicQuery(q) {
	const s = String(q || "").toLowerCase();
	return /天眼查|企查查|tianyancha|qcc\.com|qixin\.com/.test(s);
}

export function isSerpFetchUrl(q) {
	const s = String(q || "").toLowerCase();
	return /baidu\.com\/s\?|google\.[^/\s]+\/search|bing\.com\/search|so\.com\/s\?|sogou\.com\/web/.test(s);
}

export function isPublicTechQuery(q) {
	const s = String(q || "").toLowerCase();
	return /github|gitlab|npmjs|pypi\.org|crates\.io|stackoverflow|hyperframes|remotion\b|revideo|editly|moviepy/.test(s);
}

// Same job as DSH-KRouter's canonical_sources.psv: map first, miss = do not search the store.
// Product rows only; a company's own nouns (its name, its brands) belong in its handbook and
// synonym list (company\\_handbook\\_company\\同义词.txt), not here.
const COMPANY_MAP_ROWS = [
	{ aliases: ["工单", "任务卡", "验收", "下达", "提交验收"], path: "_handbook/_company/desk.md", how: "工单在侧栏任务：下达、提交验收。对话完成不等于格子完成。这一条就是答案，停。不要再 company_knowledge。" },
	{ aliases: ["手册", "检索", "工作边界", "本岗"], path: "_handbook/_company", how: "岗位手册打开即用。地图 how 已是结论。没有的正文说还不存在。不要 glob _handbook。" },
	{ aliases: ["_office", "_shared", "_memory", "花名册", "椅子"], path: "_handbook/_company/work-boundary.md", how: "老板椅是 _office，团队盘根 $HOME/company。不要猜 _boss。共享区只读。记忆写入走 company_memory_write。不要 ls _memory。" },
	{ aliases: ["公司桌", "tdharness", "companydesk", "agent工作台", "ai工作台", "核心功能", "能做什么", "完整agent"], path: "_handbook/_company/desk.md", how: "装在公司里的完整 Agent 工作台，本机真干活，不是聊天窗。一人一座：登录即用，换电脑对话和文件跟人走。能力全开：读改跑、搜网、点选走 OpenCLI 一只手。Full Access 只覆盖这台电脑和自己的椅子读写；共享区全员只读。公开网走公司出口。点选第一下 bash：opencli <site> whoami --window foreground，或 opencli browser work open <url>。HOST action=run。不要调 ego_* / browser_*。出图出短视频落格子。任务到四格验收在侧栏。手册打开即用。没有先例就说没有。资料在公司盘。飞书钉钉有接口，还没接通。HTML 用 artifact。这一条就是答案，停。" },
];

function mapNorm(s) {
	return String(s || "")
		.toLowerCase()
		.replace(/[\s,，、._\-/]+/g, "");
}

export function matchCompanyMap(q) {
	const n = mapNorm(q);
	if (!n) return null;
	let best = null;
	let bestScore = 0;
	for (const row of COMPANY_MAP_ROWS) {
		for (const alias of row.aliases) {
			const a = mapNorm(alias);
			if (!a) continue;
			let score = 0;
			if (n === a) score = 1000 + a.length;
			else if (n.indexOf(a) >= 0) score = 500 + a.length;
			else if (n.length >= 4 && a.indexOf(n) >= 0) score = 100 + n.length;
			if (score > bestScore) {
				bestScore = score;
				best = row;
			}
		}
	}
	return best;
}

export function isInternalEvalQuery(q) {
	const s = String(q || "").toLowerCase();
	return /搜索链路|执行链路|搜索执行|知识门|一问一搜|倒库|dump-blocked|agents\.md|overlay\.yml|_skills|node_modules|够不够短|健不健康|(?:^|\s)执行(?:$|\s|链路)|自检/.test(s);
}

export function isPublicFactQuery(q) {
	if (isPublicTechQuery(q)) return true;
	const s = String(q || "");
	return /扶持|补贴|政策|番禺|条例/.test(s);
}

export function isOnCompanyMap(q) {
	return matchCompanyMap(q) != null;
}

export function isGithubHtmlUrl(q) {
	try {
		const u = new URL(String(q || ""));
		if (u.hostname.toLowerCase() !== "github.com") return false;
		const parts = u.pathname.split("/").filter(Boolean);
		if (parts.length < 2) return false;
		const head = parts[0].toLowerCase();
		return head !== "search" && head !== "topics" && head !== "orgs";
	} catch {
		return false;
	}
}

function githubApiFromHtml(q) {
	try {
		const u = new URL(String(q || ""));
		const parts = u.pathname.split("/").filter(Boolean);
		if (parts.length < 2) return "";
		return "https://api.github.com/repos/" + parts[0] + "/" + parts[1];
	} catch {
		return "";
	}
}

function webQueryText(args) {
	if (!args) return "";
	if (Array.isArray(args.queries)) return args.queries.join(" ");
	return String(args.query || args.url || args.q || "");
}

function knowledgeStop(status, note) {
	return { ok: true, status, hits: [], note };
}

export function wrapKnowledgeBudget(definition) {
	if (!definition || definition.name !== "company_knowledge" || typeof definition.execute !== "function") {
		return definition;
	}
	const inner = definition.execute.bind(definition);
	definition.execute = async function (args, exec) {
		const st = knowledgeState(exec);
		const collapsed = { memory: 1, experience: 1, handbook: 1, correction: 1 };
		const next = args && typeof args === "object" ? { ...args } : {};
		let route = String(next.route || "search");
		if (collapsed[route]) {
			next.route = "search";
			route = "search";
		}
		args = next;
		const query = String((args && args.query) || "");
		const evidence = !!(args && args.evidence);
		const namedPath = String((args && (args.path || args.evidence_path)) || "").trim();
		if (evidence && !namedPath) {
			return knowledgeStop(
				"evidence-need-path",
				"name an L0/L1 path from a prior hit. do not dump the store.",
			);
		}
		if (route !== "status" && !evidence && isPublicTechQuery(query)) {
			st.dumpBlocked = true;
			st.offMapStop = true;
			return knowledgeStop(
				"public-tech",
				"not a company fact. web_search once. for a repo, web_fetch https://api.github.com/repos/<owner>/<name>. do not load extra skills.",
			);
		}
		if (route !== "status" && !evidence && st.offMapStop && !isOnCompanyMap(query) && !isPublicFactQuery(query)) {
			st.dumpBlocked = true;
			return knowledgeStop(
				"not-on-map",
				"off-map-stop. do not company_knowledge again. 地图没有 = 没有. do not glob. answer now.",
			);
		}
		if (route !== "status" && !evidence && !isOnCompanyMap(query)) {
			if (isInternalEvalQuery(query)) {
				st.dumpBlocked = true;
				st.offMapStop = true;
				return knowledgeStop(
					"not-on-map",
					"没有先例. 地图没有 = 没有. stop. do not company_knowledge again. do not web_search. do not glob or read _handbook / _memory / _skills. answer now.",
				);
			}
			if (isPublicFactQuery(query)) {
				st.dumpBlocked = true;
				st.offMapStop = true;
				return knowledgeStop(
					"not-on-map",
					"没有先例 / not on the company map. web_search once. do not call company_knowledge again. do not glob or read _handbook / _memory.",
				);
			}
			// Company-store recall: map miss is not "no memory". Hit POST /company/knowledge.
			// Stairs / public policy still stop above. Dump of _memory stays wrapDumpScan.
		}
		if (route === "status") {
			if (st.haveHits || (st.mapRows && st.mapRows.size)) {
				return knowledgeStop(
					"already-have-status",
					"map already answered. stop. do not call status. do not ls the chair.",
				);
			}
			if (st.status) {
				return knowledgeStop(
					"already-have-status",
					"chair identity is already in this conversation. do not call company_knowledge again.",
				);
			}
			st.status = true;
			return inner(args, exec);
		}
		if (evidence && st.evidence) {
			return knowledgeStop(
				"already-have-evidence",
				"L0/L1 originals already fetched. answer from those hits. do not search more.",
			);
		}
		if (evidence) {
			const p = namedPath.replace(/\\/g, "/");
			if (!/(^|\/)(10-l0|11-l1)\//.test(p)) {
				return knowledgeStop(
					"evidence-not-l0",
					"evidence is L0/L1 only. map how already answered. do not evidence handbook. answer now.",
				);
			}
		}
		if (route !== "status" && !evidence) {
			const row = matchCompanyMap(query);
			const stem0 = queryStem(query) || route;
			const rowId = row ? mapRowId(row) : "";
			if (row && (st.stems.has(stem0) || (rowId && st.mapRows.has(rowId)))) {
				return knowledgeStop(
					"already-have-search",
					isInternalEvalQuery(query)
						? "map already answered. stop. do not web_search. do not dump the store."
						: "map already answered. if that how closed the question, stop. if not, web_search once. do not dump the store.",
				);
			}
			if (row) {
				st.stems.set(stem0, { hits: 1, route: "map" });
				if (rowId) st.mapRows.add(rowId);
				st.haveHits = true;
				if (row.path) st.namedPaths.add(row.path);
				return {
					ok: true,
					status: "ok",
					hits: [{ path: row.path, line: 1, text: row.how, layer: "map" }],
					note: "map-hit. if this closes the question, stop and answer. do not dump the store. internal eval: do not web_search. public facts only: web_search once.",
					layer: "map",
				};
			}
		}
		const stem = queryStem(query) || route;
		if (st.stems.has(stem) && !evidence) {
			return knowledgeStop(
				"already-have-search",
				"stop. same question already went through company_knowledge. do not switch route. if that search was not-found, web_search once.",
			);
		}
		if (!st.stems.has(stem) && st.stems.size >= 2 && !evidence) {
			return knowledgeStop(
				"knowledge-budget",
				"max 2 distinct company_knowledge lookups. if they missed, web_search once.",
			);
		}
		st.stems.set(stem, { pending: true, route });
		if (namedPath) st.namedPaths.add(namedPath);
		const out = await inner(args, exec);
		const hitList = Array.isArray(out && out.hits) ? out.hits : [];
		const hits = hitList.length;
		st.stems.set(stem, { hits, route });
		if (hits > 0) st.haveHits = true;
		for (let i = 0; i < hitList.length; i++) {
			if (hitList[i] && hitList[i].path) st.namedPaths.add(String(hitList[i].path));
		}
		if (evidence) st.evidence = true;
		if (hits === 0 && !evidence) {
			st.offMapStop = true;
			st.dumpBlocked = true;
		}
		if (out && typeof out === "object") {
			out.note =
				hits > 0
					? "hits-enough. stop extra company_knowledge routes."
					: out.note || "no-hits. 没有先例 after search. do not dump _memory. web_search public names once.";
		}
		return out;
	};
	return definition;
}

export function wrapWebCompanyName(tools) {
	if (tools == null || typeof tools.register !== "function" || tools.__companyWebName) return tools;
	// Keep the caller's `this`. 0.2.x hands each agent its own scoped tools
	// object that inherits from this one; binding to the root sent every
	// per-agent tool to the global layer and the second session could not start.
	const orig = tools.register;
	const wrapExec = (definition) => {
		if (!definition || typeof definition.execute !== "function") return definition;
		const n = String(definition.name || "");
		const isEgo = n.indexOf("ego_") === 0 || n.indexOf("browser_") === 0;
		if (n !== "web_search" && n !== "web_fetch" && !isEgo) return definition;
		const inner = definition.execute.bind(definition);
		definition.execute = async function (args, exec) {
			const st = webState(exec);
			if (n === "web_search") {
				const next = args && typeof args === "object" ? { ...args } : {};
				if (Array.isArray(next.queries) && next.queries.length > WEB_SEARCH_MAX_QUERIES) {
					next.queries = next.queries
						.slice(0, WEB_SEARCH_MAX_QUERIES)
						.map((q) => String(q || "").trim())
						.filter(Boolean);
					args = next;
				}
				if (st.search >= WEB_SEARCH_BUDGET) {
					return {
						content: "search-budget. answer from earlier sources. do not web_search or web_fetch more.",
						sources: [],
						truncated: false,
					};
				}
			}
			if (n === "web_fetch" && st.fetch >= WEB_FETCH_BUDGET) {
				return {
					url: String((args && args.url) || ""),
					statusCode: 400,
					body: {
						kind: "text",
						content: "fetch-budget. search snippets already have highlights. answer now.",
					},
					truncated: false,
				};
			}
			const q = webQueryText(args);
			if (n === "web_search" && isInternalEvalQuery(q)) {
				return {
					content: "internal-stairs. session rules already injected. do not read AGENTS.md. do not web_search. do not dump handbook / _memory / _skills.",
					sources: [],
					truncated: false,
				};
			}
			if (isEgo) {
				return {
					ok: false,
					error: "click-retired. One hand / 一只手: bash opencli <site> whoami --window foreground --keep-tab true OR opencli browser work open <url>. HOST action=run. Do not ego_* / browser_*. Public pages stay web_search.",
				};
			}
			if (n === "web_fetch" && isGithubHtmlUrl(q)) {
				const api = githubApiFromHtml(q);
				return {
					url: q,
					statusCode: 400,
					body: {
						kind: "text",
						content: "github.com HTML has no star count. web_fetch " + (api || "https://api.github.com/repos/<owner>/<name>"),
					},
					truncated: false,
				};
			}
			if (n === "web_fetch" && isSerpFetchUrl(q)) {
				return {
					url: q,
					statusCode: 400,
					body: {
						kind: "text",
						content: "web_fetch is for a result page, not a search-engine results URL. Use web_search with queries.",
					},
					truncated: false,
				};
			}
			if (n === "web_search" && isCompanyPublicQuery(q)) {
				return {
					content: "skip 天眼查/企查查. web_search the company name instead.",
					sources: [],
					truncated: false,
				};
			}
			if (n === "web_search") st.search += 1;
			if (n === "web_fetch") st.fetch += 1;
			return inner(args, exec);
		};
		return definition;
	};
	tools.register = function (definition, ...rest) {
		const n = String((definition && definition.name) || "");
		if (n.indexOf("ego_") === 0 || n.indexOf("browser_") === 0) {
			wrapExec(definition);
			return definition;
		}
		return orig.call(this, wrapExec(definition), ...rest);
	};
	if (typeof tools.get === "function") {
		try {
			wrapExec(tools.get("web_search"));
			wrapExec(tools.get("web_fetch"));
			wrapExec(tools.get("ego_navigate"));
			wrapExec(tools.get("ego_space_open"));
			wrapExec(tools.get("ego_http"));
			wrapExec(tools.get("browser_navigate"));
		} catch {
			/* official search tools may register after this host row */
		}
	}
	tools.__companyWebName = true;
	return tools;
}

function mapRowId(row) {
	return String((row && row.aliases && row.aliases[0]) || row.path || "");
}

export function isWorkspaceRootPath(p) {
	const s = String(p || "")
		.replace(/\\/g, "/")
		.replace(/\/+$/, "");
	if (!s || s === "." || s === "./") return true;
	if (/(^|\/)(_office|_shared)$/.test(s)) return true;
	if (/\/company$/.test(s)) return true;
	return false;
}

export function isBroadWorkspaceGlob(args) {
	if (!args || typeof args !== "object") return false;
	const pat = String(args.glob || args.pattern || args.q || "")
		.replace(/\\/g, "/")
		.trim();
	if (!/^\.?\/?\*\*/.test(pat)) return false;
	return isWorkspaceRootPath(args.path || args.target_directory || args.root || args.dir || "");
}

function stripDumpFromResult(name, value) {
	if (!value || typeof value !== "object") return value;
	const keep = (p) => !isDumpPath(String(p || ""));
	if (name === "glob") {
		if (Array.isArray(value.paths)) return { ...value, paths: value.paths.filter(keep) };
		if (Array.isArray(value.matches)) {
			return {
				...value,
				matches: value.matches.filter((m) => keep(typeof m === "string" ? m : (m && m.path) || "")),
			};
		}
	}
	if (name === "grep" && Array.isArray(value.matches)) {
		return {
			...value,
			matches: value.matches.filter((m) => keep((m && (m.path || m.file)) || "")),
		};
	}
	return value;
}

export function isAgentsFileRef(q) {
	const s = String(q || "").replace(/\\/g, "/");
	return /(^|[\/\s'"=])agents\.md(?=[\/\s'"\)]|$)/i.test(s);
}

export function isDumpPath(q) {
	const s = String(q || "").replace(/\\/g, "/");
	if (s.indexOf("_手册") >= 0) return true;
	const low = s.toLowerCase();
	if (low.indexOf("node_modules") >= 0) return true;
	if (low.indexOf("/_skills") >= 0 || /(^|\/)_skills(\/|$)/.test(low)) return true;
	return low.indexOf("_handbook") >= 0 || low.indexOf("/_memory") >= 0 || /(^|\/)_memory(\/|$)/.test(low);
}

function dumpArgsText(args) {
	if (!args || typeof args !== "object") return String(args || "");
	const bits = [args.path, args.file_path, args.pattern, args.glob, args.target_directory, args.command, args.query];
	try {
		bits.push(JSON.stringify(args));
	} catch {
		/* ignore */
	}
	return bits.filter(Boolean).join(" ");
}

function dumpAllowed(text, st) {
	if (isAgentsFileRef(text)) return false;
	if (String(text || "").toLowerCase().indexOf("node_modules") >= 0) return false;
	if (!isDumpPath(text)) return true;
	if (String(text || "").indexOf("_手册") >= 0) return false;
	if (st.dumpBlocked) return false;
	if (!st.haveHits) return false;
	const s = String(text || "").replace(/\\/g, "/");
	const names = st.namedPaths ? Array.from(st.namedPaths) : [];
	for (let i = 0; i < names.length; i++) {
		const n = String(names[i] || "").replace(/\\/g, "/");
		if (n && (s.indexOf(n) >= 0 || n.indexOf(s) >= 0)) return true;
	}
	return false;
}

function dumpBlockedMsg(kind) {
	if (kind === "broad") {
		return "[tool-refused] glob-too-broad. narrow path to a subfolder. do not glob ** on _office / workspace root.";
	}
	if (kind === "agents") {
		return "[tool-refused] agents-injected. already in this session. do not read AGENTS.md. answer now.";
	}
	return "[tool-refused] not file body. dump-blocked. 没有先例. use company_knowledge. do not read AGENTS.md. do not web_search. do not glob handbook / _memory / _skills / node_modules.";
}

function dumpBlockedValue(name, args, kind) {
	const msg = dumpBlockedMsg(kind);
	if (name === "read") {
		const p = String((args && (args.path || args.file_path)) || "_handbook");
		return {
			path: p,
			offset: 1,
			lines: [{ number: 1, text: msg }],
			totalLines: 1,
		};
	}
	if (name === "glob") {
		return { root: ".", paths: [msg] };
	}
	if (name === "grep") {
		return { matches: [{ path: "_handbook", lineNumber: 1, line: msg }] };
	}
	return {
		kind: "foreground",
		exitCode: 1,
		signal: null,
		timedOut: false,
		aborted: false,
		timeoutMs: 0,
		stdout: { text: msg, truncated: false },
		stderr: { text: "", truncated: false },
	};
}

export function wrapDumpScan(tools) {
	if (tools == null || typeof tools.register !== "function" || tools.__companyDumpScan) return tools;
	const orig = tools.register;
	const wrapExec = (definition) => {
		if (!definition || typeof definition.execute !== "function") return definition;
		const n = String(definition.name || "");
		if (n !== "glob" && n !== "grep" && n !== "read" && n !== "bash" && n !== "pwsh") return definition;
		const inner = definition.execute.bind(definition);
		definition.execute = async function (args, exec) {
			const st = knowledgeState(exec);
			const text = dumpArgsText(args);
			if (isAgentsFileRef(text)) {
				return dumpBlockedValue(n, args, "agents");
			}
			if (!dumpAllowed(text, st)) {
				return dumpBlockedValue(n, args);
			}
			if (n === "glob" && isBroadWorkspaceGlob(args)) {
				return dumpBlockedValue(n, args, "broad");
			}
			const out = await inner(args, exec);
			return stripDumpFromResult(n, out);
		};
		return definition;
	};
	tools.register = function (definition, ...rest) {
		return orig.call(this, wrapExec(definition), ...rest);
	};
	if (typeof tools.get === "function") {
		try {
			wrapExec(tools.get("glob"));
			wrapExec(tools.get("grep"));
			wrapExec(tools.get("read"));
			wrapExec(tools.get("bash"));
			wrapExec(tools.get("pwsh"));
		} catch {
			/* official fs tools may register after this host row */
		}
	}
	tools.__companyDumpScan = true;
	return tools;
}

function registerKnowledgeTool(ctx) {
	const tools = typeof ctx.get === "function" ? ctx.get("tools") : ctx.tools;
	if (tools == null || typeof tools.register !== "function") return;
	tools.register(wrapKnowledgeBudget({
		name: "company_knowledge",
		description: "One company lookup. route=search with a narrow keyword for handbook, _memory, or past work. Map hit = one how, then stop. Public policy / GitHub: do not use this, web_search once.",
		parameters: {
			type: "object",
			additionalProperties: false,
			properties: {
				route: {
					type: "string",
					enum: ["search", "status"],
					description: "search. status only if this chair is unknown.",
				},
				query: { type: "string", description: "Narrow keyword. Required except route=status." },
				evidence: { type: "boolean", description: "true only with path set to a prior hit's L0/L1 path." },
				path: { type: "string", description: "Required when evidence=true. The L0/L1 path named by a prior hit." },
			},
			required: ["route"],
		},
		timeoutMs: 30000,
		output: {
			schema: {
				type: "object",
				additionalProperties: true,
				properties: {
					ok: { type: "boolean" },
					status: { type: "string" },
					hits: { type: "array" },
				},
			},
			render(_args, value) {
				const hits = (value && value.hits) || [];
				const head = [
					"status=" + ((value && value.status) || "ok"),
					value && value.account ? "account=" + value.account : "",
					value && value.role ? "role=" + value.role : "",
					value && value.dept ? "dept=" + value.dept : "",
				].filter(Boolean);
				const lines = hits.slice(0, 16).map((h) => (h.path || "") + ":" + (h.line || "") + " " + (h.text || ""));
				return [{ type: "text", text: head.concat(lines).join("\n") }];
			},
		},
		async execute(args) {
			const tok = gwToken();
			if (!tok || tok === "company-gateway") {
				return { ok: false, status: "no-login", hits: [] };
			}
			const route = String(args.route || "search");
			const query = String(args.query || "");
			const out = await proxyKnowledge({
				route,
				query,
				evidence: !!args.evidence,
				path: String(args.path || args.evidence_path || ""),
			});
			return out.json && typeof out.json === "object" ? out.json : { ok: false, status: "bad-json", hits: [] };
		},
	}));
}

function registerPriorWorkTool(ctx) {
	const tools = typeof ctx.get === "function" ? ctx.get("tools") : ctx.tools;
	if (tools == null || typeof tools.register !== "function") return;
	tools.register({
		name: "prior_work",
		description:
			"Before installing a tool, running a skill, or starting a task, ask whether someone on the company share already did it. Returns the person and the session path. Does not copy sessions.",
		parameters: {
			type: "object",
			additionalProperties: false,
			properties: {
				query: {
					type: "string",
					description: "Tool name, skill id, or task phrase. Example opencli / company-web / q3 campaign",
				},
			},
			required: ["query"],
		},
		timeoutMs: 30000,
		output: {
			schema: {
				type: "object",
				additionalProperties: true,
				properties: {
					ok: { type: "boolean" },
					status: { type: "string" },
					hits: { type: "array" },
				},
			},
			render(_args, value) {
				const hits = (value && value.hits) || [];
				const head = ["status=" + ((value && value.status) || "ok")];
				const lines = hits.slice(0, 12).map((h) =>
					[h.login, h.kind, h.tool || h.skill || "", h.path].filter(Boolean).join(" "),
				);
				return [{ type: "text", text: head.concat(lines).join("\n") }];
			},
		},
		async execute(args) {
			const tok = gwToken();
			if (!tok || tok === "company-gateway") {
				return { ok: false, status: "no-login", hits: [] };
			}
			const out = await proxyKnowledge({ query: String(args.query || "") }, "/company/knowledge/v1/prior-work");
			return out.json && typeof out.json === "object" ? out.json : { ok: false, status: "bad-json", hits: [] };
		},
	});
}

function registerMemoryWriteTool(ctx) {
	const tools = typeof ctx.get === "function" ? ctx.get("tools") : ctx.tools;
	if (tools == null || typeof tools.register !== "function") return;
	tools.register({
		name: "company_memory_write",
		description: "Write this seat's personal _memory or, for admin/director, company _shared/_memory. Host write, not official write: sandbox root is the personal workspace so official write cannot reach _shared, and SMB link/rename ENOTSUP. Employees calling zone=shared are denied. ASCII slug only.",
		parameters: {
			type: "object",
			additionalProperties: false,
			properties: {
				zone: {
					type: "string",
					enum: ["personal", "shared"],
					description: "personal = this seat. shared = _shared/_memory, admin/director only.",
				},
				layer: {
					type: "string",
					enum: ["01-projects", "02-methods", "03-evidence", "04-reviews", "05-logs", "90-system"],
					description: "Same layers as company-memory.",
				},
				name: { type: "string", description: "ASCII slug without .md. Example product-self-intro" },
				content: { type: "string", description: "Markdown body. Frontmatter is added if missing." },
				title: { type: "string", description: "Optional title for generated frontmatter." },
				mode: {
					type: "string",
					enum: ["replace", "append"],
					description: "append for 05-logs and 90-system/corrections. Default replace.",
				},
			},
			required: ["zone", "layer", "name", "content"],
		},
		timeoutMs: 15000,
		output: {
			schema: {
				type: "object",
				additionalProperties: true,
				properties: {
					ok: { type: "boolean" },
					status: { type: "string" },
					path: { type: "string" },
				},
			},
			render(_args, value) {
				const line = [
					"status=" + ((value && value.status) || "ok"),
					value && value.zone ? "zone=" + value.zone : "",
					value && value.path ? "path=" + value.path : "",
				].filter(Boolean);
				return [{ type: "text", text: line.join("\n") }];
			},
		},
		async execute(args) {
			return writeMemory({
				zone: args.zone,
				layer: args.layer,
				name: args.name,
				content: args.content,
				title: args.title,
				mode: args.mode || "replace",
				role: loginRoleFile(),
				loginName: loginNameFile(),
				cwd: process.cwd(),
			});
		},
	});
}

// OpenCLI ships with the client (<install>/opencli) and on the server
// (D:/dsh/tools/opencli). Its entry is a script run on the desk's own Node,
// so it works on a machine with no Node or npm of its own.
const OPENCLI_ENTRY = ["node_modules", "@jackwener", "opencli", "dist", "src", "main.js"];

function deskInstallDir() {
	// Windows: <install>/node/node.exe. macOS: <install>/node/bin/node.
	const here = path.dirname(process.execPath);
	return path.basename(here) === "bin" ? path.resolve(here, "..", "..") : path.resolve(here, "..");
}

function opencliExtensionDir() {
	for (const d of [path.join(deskInstallDir(), "opencli", "extension"), "D:/dsh/tools/opencli/extension"]) {
		if (existsSync(path.join(d, "manifest.json"))) return d.replace(/\\/g, "/");
	}
	return "";
}

function bundledOpencli() {
	for (const root of [path.join(deskInstallDir(), "opencli"), "D:/dsh/tools/opencli"]) {
		const entry = path.join(root, ...OPENCLI_ENTRY);
		if (existsSync(entry)) return entry;
	}
	return "";
}

// Run OpenCLI whichever form it was found in. A .cmd cannot be started
// without a shell on current Node, so a script entry is run on this Node.
function spawnOpencli(bin, argv, opts) {
	if (/\.(m?js|cjs)$/i.test(bin)) return spawnSync(process.execPath, [bin, ...argv], opts);
	if (process.platform === "win32" && /\.(cmd|bat|ps1)$/i.test(bin)) return spawnSync(bin, argv, { ...opts, shell: true });
	return spawnSync(bin, argv, opts);
}

export function resolveOpencli(cwd) {
	const forced = String(process.env.OPENCLI_BIN || "").trim();
	const shipped = bundledOpencli();
	if (shipped) return shipped;
	if (forced && existsSync(forced)) return forced;
	const root = cwd || process.cwd();
	const bins = process.platform === "win32" ? ["opencli.cmd", "opencli.ps1", "opencli"] : ["opencli"];
	for (const b of bins) {
		const p = path.join(root, "node_modules", ".bin", b);
		if (existsSync(p)) return p;
	}
	const which = process.platform === "win32" ? "where" : "which";
	const r = spawnSync(which, ["opencli"], { encoding: "utf8", timeout: 8000 });
	const line = String(r.stdout || "")
		.split(/\r?\n/)
		.map((s) => s.trim())
		.find((s) => s && existsSync(s));
	return line || "";
}

export function ensureOpencli(cwd) {
	const root = cwd || process.env.DSH_HOME || process.cwd();
	const hit = resolveOpencli(root);
	if (hit) return { ok: true, status: "have", bin: hit };
	if (process.env.COMPANY_OPENCLI_SKIP_INSTALL === "1") {
		return { ok: false, status: "missing", hint: "call opencli action=ensure without skip, or set OPENCLI_BIN" };
	}
	const npm = process.platform === "win32" ? "npm.cmd" : "npm";
	const r = spawnSync(npm, ["install", OPENCLI_PKG], {
		cwd: root,
		encoding: "utf8",
		timeout: 180000,
	});
	const again = resolveOpencli(root);
	if (again) return { ok: true, status: "installed", bin: again };
	return {
		ok: false,
		status: "install-failed",
		log: String(r.stderr || r.stdout || "").slice(-800),
	};
}

function argvOf(args) {
	if (args && Array.isArray(args.argv)) return args.argv.map((x) => String(x));
	return [];
}

export function runOpencliAction(args) {
	const argv = argvOf(args);
	let action = String((args && args.action) || "").trim();
	if (!action) action = "run";
	const cwd = (args && args.cwd) || process.env.DSH_HOME || process.cwd();
	if (action === "help") {
		const have = resolveOpencli(cwd);
		if (have) {
			return {
				ok: true,
				status: "help",
				bin: have,
				marker: "company-opencli-host-v1",
				store: OPENCLI_STORE,
				steps: [
					"already have " + have,
					"bash first: opencli <site> whoami --window foreground --keep-tab true",
					"or: opencli browser work open <url> --window foreground",
					"or this tool: action=run argv=[...]",
				],
			};
		}
		return {
			ok: true,
			status: "help",
			marker: "company-opencli-host-v1",
			steps: [
				"binary missing: action=ensure",
				"then bash first: opencli <site> whoami --window foreground --keep-tab true",
				"or: opencli browser work open <url> --window foreground",
				"or this tool: action=run argv=[...]",
				"action=doctor only if bridge down",
				"Chrome Add only if doctor says extension missing: " + OPENCLI_STORE,
			],
			store: OPENCLI_STORE,
		};
	}
	if (action === "ensure") {
		const ens = ensureOpencli(cwd);
		return {
			...ens,
			marker: "company-opencli-host-v1",
			store: OPENCLI_STORE,
			next: ens.ok ? "bash opencli <site> / action=run, not doctor-first" : "do not call ego_*",
		};
	}
	const bin = resolveOpencli(cwd);
	if (!bin) {
		return {
			ok: false,
			status: "missing",
			marker: "company-opencli-host-v1",
			hint: "opencli binary missing. then action=ensure. do not start with ensure when the binary exists.",
		};
	}
	if (action === "doctor") {
		const r = spawnOpencli(bin, ["doctor"], { encoding: "utf8", timeout: 30000, cwd });
		const text = String(r.stdout || "") + String(r.stderr || "");
		if (/Extension:\s*not connected|extension not connected/i.test(text)) {
			// The one step a person has to do: put the bridge into their own browser.
			const ext = opencliExtensionDir();
			return {
				ok: false,
				status: "extension-missing",
				bin,
				log: text.slice(-800),
				marker: "company-opencli-host-v1",
				extensionDir: ext,
				guide: [
					"用 Chrome（或 Edge）打开地址 chrome://extensions（Edge 是 edge://extensions）",
					"打开页面右上角的「开发者模式」开关",
					"点左上角「加载已解压的扩展程序」，选择文件夹 " + (ext || "<客户端安装目录>/opencli/extension"),
					"列表里出现 OpenCLI 并且是开启状态后，告诉我「装好了」",
				],
				hint: "带用户一步一步装：每次只说一步，等用户回复做完了再说下一步。装好后再调用一次 action=doctor 确认连上。还连不上就请用户在扩展列表里点 OpenCLI 的刷新按钮，或关掉浏览器再打开。不要让用户把密码告诉你，网站登录由用户自己在浏览器里完成。",
			};
		}
		return {
			ok: r.status === 0,
			status: r.status === 0 ? "doctor-ok" : "doctor-fail",
			bin,
			log: text,
			marker: "company-opencli-host-v1",
		};
	}
	if (action === "run") {
		if (!argv.length) {
			return {
				ok: false,
				status: "need-argv",
				bin,
				marker: "company-opencli-host-v1",
				hint: "action=run needs argv, e.g. [\"douyin\",\"whoami\",\"--window\",\"foreground\"]. Prefer bash.",
			};
		}
		const r = spawnOpencli(bin, argv, { encoding: "utf8", timeout: 120000, cwd });
		return {
			ok: r.status === 0,
			status: r.status === 0 ? "run-ok" : "run-fail",
			bin,
			argv,
			log: String(r.stdout || r.stderr || "").slice(-2000),
			marker: "company-opencli-host-v1",
		};
	}
	return { ok: false, status: "unknown-action", marker: "company-opencli-host-v1" };
}

function registerWatchVideoTool(ctx) {
	const tools = typeof ctx.get === "function" ? ctx.get("tools") : ctx.tools;
	if (tools == null || typeof tools.register !== "function") return;
	tools.register({
		name: "watch_video",
		description:
			"Watch a video file and answer a question about it. The model sees the picture and hears the sound of the whole file. " +
			"Use this for any video the user attached or named (.mp4 .mov .m4v .webm .mkv .avi). " +
			"Do not read video bytes, do not extract frames yourself, and do not answer that you cannot see video. " +
			"Files over 150 MB are compressed first, which can take a few minutes. Ask one specific question per call; call again for a follow-up.",
		parameters: {
			type: "object",
			additionalProperties: false,
			properties: {
				path: { type: "string", description: "Absolute path of the video file, exactly as it was given for the attachment or by the user." },
				question: { type: "string", description: "What to find out from the video, in the user's language." },
			},
			required: ["path", "question"],
		},
		timeoutMs: 45 * 60 * 1000,
		output: {
			schema: {
				type: "object",
				additionalProperties: true,
				properties: {
					ok: { type: "boolean" },
					status: { type: "string" },
					answer: { type: "string" },
				},
			},
			render(_args, value) {
				const v = value || {};
				if (v.ok) {
					const how = v.shrunk ? "compressed " + v.originalMB + " MB to " + v.sentMB + " MB, then watched by " + v.model : "watched by " + v.model + " (" + v.sentMB + " MB)";
					return [{ type: "text", text: "[" + how + "]\n" + String(v.answer || "") }];
				}
				return [{ type: "text", text: "status=" + (v.status || "failed") + (v.hint ? "\nhint=" + v.hint : "") }];
			},
		},
		async execute(args) {
			const picked = pickedGrokModels(ctx);
			return watchVideo({
				file: args && args.path,
				question: args && args.question,
				gwBase: gwBase(),
				token: gwToken(),
				model: picked.length ? picked[0].id : "grok-4.7",
			});
		},
	});
}

function registerOpencliTool(ctx) {
	const tools = typeof ctx.get === "function" ? ctx.get("tools") : ctx.tools;
	if (tools == null || typeof tools.register !== "function") return;
	tools.register({
		name: "opencli",
		description:
			"Open a logged-in site. Prefer bash: opencli <site> … or opencli browser work open <url>. This tool default action=run + argv. ensure/doctor only if missing or down. Do not ego_* / browser_*.",
		parameters: {
			type: "object",
			additionalProperties: false,
			properties: {
				action: {
					type: "string",
					enum: ["run", "ensure", "doctor", "help"],
					description: "run = exec opencli argv (default). ensure = install if missing. doctor = bridge check. help = steps.",
				},
				argv: {
					type: "array",
					items: { type: "string" },
					description: "Arguments for action=run, e.g. [\"browser\",\"work\",\"open\",\"https://www.douyin.com\",\"--window\",\"foreground\"]",
				},
			},
		},
		timeoutMs: 180000,
		output: {
			schema: {
				type: "object",
				additionalProperties: true,
				properties: {
					ok: { type: "boolean" },
					status: { type: "string" },
					bin: { type: "string" },
				},
			},
			render(_args, value) {
				const line = [
					"status=" + ((value && value.status) || "ok"),
					value && value.bin ? "bin=" + value.bin : "",
					value && value.next ? "next=" + value.next : "",
					value && value.hint ? "hint=" + value.hint : "",
					value && value.store ? "store=" + value.store : "",
					value && value.extensionDir ? "extensionDir=" + value.extensionDir : "",
					value && Array.isArray(value.guide) ? "guide:\n" + value.guide.map((g, i) => (i + 1) + ". " + g).join("\n") : "",
					value && value.log ? String(value.log).slice(0, 800) : "",
				].filter(Boolean);
				return [{ type: "text", text: line.join("\n") }];
			},
		},
		async execute(args) {
			return runOpencliAction(args);
		},
	});
}

function registerShopRecipeTool(ctx) {
	const tools = typeof ctx.get === "function" ? ctx.get("tools") : ctx.tools;
	if (tools == null || typeof tools.register !== "function") return;
	tools.register({
		name: "shop_recipe",
		description:
			"THE live connection to this company's own 淘宝/天猫 seller backstage (千牛 + 生意参谋). Use it for 经营概况/生意参谋 (visitors, paid amount, conversion, per-customer), 订单 (待发货/即将超时), 商品 (在售/仓库/草稿/滞销), 店铺档案/层级/评分, 待办与违规 — and whenever asked whether the shop is connected: it is, through this tool. Reads run inside the desk's own hidden logged-in view, using the page's own signed MTOP calls, so no 开放平台 app_key is involved. action=list first, then action=run recipe=<id> or recipes=[ids] to batch on one page load. Read-only: no price, no listing, no refund. There is no way to pass page JS here.",
		parameters: {
			type: "object",
			additionalProperties: false,
			properties: {
				action: { type: "string", enum: ["list", "run"], description: "list = ids and what each reads. run = execute." },
				recipe: { type: "string", description: "One recipe id from action=list, e.g. shop.pending.v1" },
				recipes: {
					type: "array",
					items: { type: "string" },
					description: "Several ids sharing the same page; one page load serves them all.",
				},
				params: {
					type: "object",
					additionalProperties: true,
					description: "Flat JSON params for the recipe. Strings/numbers/booleans only.",
				},
				session: { type: "string", description: "opencli browser session name. Default shop." },
				profile: { type: "string", description: "opencli profile, for a browser profile kept apart from personal browsing." },
			},
		},
		timeoutMs: 240000,
		output: {
			schema: { type: "object", additionalProperties: true, properties: { ok: { type: "boolean" }, status: { type: "string" } } },
			render(_args, value) {
				const v = value || {};
				if (v.status === "list") {
					const rows = (v.recipes || []).map((r) => "  " + r.id + (r.api ? " [api]" : " [text]") + " — " + r.title);
					return [{ type: "text", text: ["root=" + v.root, ...rows].join("\n") }];
				}
				const head = [
					"status=" + (v.status || "ok"),
					v.url ? "url=" + v.url : "",
					v.reopened ? "reopened=1 (cold page paid once)" : "",
					v.hint ? "hint=" + v.hint : "",
					v.error ? "error=" + v.error : "",
					v.log ? String(v.log).slice(0, 600) : "",
				].filter(Boolean);
				const body = v.results ? JSON.stringify(v.results, null, 1).slice(0, 6000) : "";
				return [{ type: "text", text: [head.join("\n"), body].filter(Boolean).join("\n") }];
			},
		},
		async execute(args) {
			const { runShopRecipe } = await import("./shop-recipe.js");
			return runShopRecipe(args, { resolveOpencli });
		},
	});
}

function registerShopWriteTool(ctx) {
	const tools = typeof ctx.get === "function" ? ctx.get("tools") : ctx.tools;
	if (tools == null || typeof tools.register !== "function") return;
	tools.register({
		name: "shop_write",
		description:
			"CHANGE one thing in this company's own 淘宝 seller backstage (phase 1: 改库存 only). Two steps, always: action=plan shows the exact diff and makes TDHarness pop a confirm window on the owner's desk; then, only after the person says they clicked 同意, action=commit with that ticket. You cannot approve a plan yourself and there is no way to skip the panel — if nobody clicks, nothing happens, and that is a correct outcome, not an error to retry. commit re-reads the shop first, so an approval cannot be applied to a state nobody saw. On status=blocked-needs-human 淘宝 wants a human through its risk check: stop and say so, never retry. Reads belong to shop_recipe; this tool never reads for you.",
		parameters: {
			type: "object",
			additionalProperties: false,
			properties: {
				action: {
					type: "string",
					enum: ["list", "plan", "commit", "capture", "log"],
					description:
						"list = what can be written. plan = propose + ask the human. commit = execute an approved ticket. capture = learn the page's own call (needed once per desk, after a human does the change by hand). log = recent writes.",
				},
				recipe: { type: "string", description: "Write action id from action=list, e.g. item.stock.v1" },
				params: {
					type: "object",
					additionalProperties: true,
					description: "Only the fields the action declares, e.g. { itemId, quantity }. Anything else is refused.",
				},
				ticket: { type: "string", description: "The ticket from action=plan. Single use." },
			},
		},
		timeoutMs: 240000,
		output: {
			schema: { type: "object", additionalProperties: true, properties: { ok: { type: "boolean" }, status: { type: "string" } } },
			render(_args, value) {
				const v = value || {};
				if (v.status === "list") {
					const rows = (v.actions || []).map(
						(a) => "  " + a.id + (a.captured ? " [ready]" : " [needs capture]") + " — " + a.title,
					);
					return [{ type: "text", text: ["root=" + v.root, ...rows].join("\n") }];
				}
				if (v.status === "log") {
					const rows = (v.entries || []).map((e) => "  " + e.at + " " + e.phase + " " + e.recipe + " " + (e.result || ""));
					return [{ type: "text", text: rows.join("\n") || "(no writes yet)" }];
				}
				const head = [
					"status=" + (v.status || "ok"),
					v.ticket ? "ticket=" + v.ticket : "",
					v.approver ? "approver=" + v.approver : "",
					v.api ? "api=" + v.api : "",
					v.state ? "state=" + v.state : "",
					v.error ? "error=" + v.error : "",
					// Without this a failed capture printed only its status, so
					// "nobody edited", "not an mtop call" and "no params in it"
					// all read the same and all read as the human's fault.
					v.reason ? "reason=" + v.reason : "",
					v.seen != null ? "seen=" + v.seen : "",
					v.hint ? "hint=" + v.hint : "",
					v.next ? v.next : "",
				].filter(Boolean);
				const diff = (v.lines || []).map((l) => "  " + l);
				const looked = v.candidates
					? "candidates=" + JSON.stringify(v.candidates).slice(0, 900)
					: v.saw
						? "saw=" + JSON.stringify(v.saw).slice(0, 900)
						: "";
				const tail = v.detail ? JSON.stringify(v.detail).slice(0, 800) : "";
				return [{ type: "text", text: [head.join("\n"), ...diff, looked, tail].filter(Boolean).join("\n") }];
			},
		},
		async execute(args) {
			const { runShopWrite } = await import("./shop-write.js");
			return runShopWrite(args, {});
		},
	});
}

const AGENTS_TEACH_SKILLS = new Set([
	"company-knowledge",
	"company-web",
	"writing-artifacts",
	"company-tools",
	"company-docs",
	"company-memory",
	"company-access",
	"company-dept",
	"company-handoff",
	"company-ticket",
	"company-shop",
]);

/** This-Mac video lane. Other skills stay retired. */
export const VIDEO_SKILL_ALLOW = new Set([
	"orangecity",
	"hyperframes",
	"hyperframes-core",
	"hyperframes-cli",
	"hyperframes-registry",
	"hyperframes-keyframes",
	"hyperframes-creative",
	"hyperframes-animation",
	"media-use",
	"remotion",
	"gsap-core",
	"gsap-timeline",
	"gsap-scrolltrigger",
	"gsap-react",
	"gsap-plugins",
	"gsap-performance",
	"gsap-frameworks",
	"gsap-utils",
	"text-to-lottie",
	"speech",
	"transcribe",
]);

export function isVideoSkill(name) {
	return VIDEO_SKILL_ALLOW.has(String(name || "").toLowerCase());
}

export function wrapSkillOnce(tools) {
	if (tools == null || typeof tools.register !== "function" || tools.__companySkillOnce) return tools;
	const orig = tools.register;
	const wrapExec = (definition) => {
		if (!definition || definition.name !== "skill" || typeof definition.execute !== "function") return definition;
		const inner = definition.execute.bind(definition);
		definition.execute = async function (args, exec) {
			const n = String((args && args.name) || "");
			if (isVideoSkill(n)) return inner(args, exec);
			return {
				name: n || "skill",
				provider: "company-agents",
				resourceBase: { kind: "opaque", description: "skill-retired" },
				content:
					"skill-retired. handbook is already open. do not call skill. use company_knowledge / web_search / web_fetch / artifact / opencli. video: orangecity / hyperframes / remotion / media-use / gsap-* only.",
			};
		};
		return definition;
	};
	tools.register = function (definition, ...rest) {
		return orig.call(this, wrapExec(definition), ...rest);
	};
	if (typeof tools.get === "function") {
		try {
			wrapExec(tools.get("skill"));
		} catch {
			/* official tool-skill may register after this host row */
		}
	}
	tools.__companySkillOnce = true;
	return tools;
}

function addMemoryRecallSection(ctx) {
	const systemPrompt = ctx.systemPrompt;
	if (systemPrompt == null || typeof systemPrompt.section !== "function") return;
	const text =
		"过往事实在公司盘个人 _memory 与 _shared/_memory。新对话没有自动上下文。用户问之前/上次/已定/纠错：先 company_knowledge route=search 窄词，按 hits 答。地图只覆盖工单/手册/工作台这些产品词；地图没有不等于没有记忆。search 0 hits 才能说没有先例。用户说记住就 company_memory_write。不要 ls/glob _memory。公开政策/GitHub 走 web_search。";
	if (typeof ctx.effect === "function") {
		ctx.effect(
			() =>
				systemPrompt.section({
					name: "company-memory-recall",
					order: 5,
					text,
				}),
			"company-memory-recall",
		);
		return;
	}
	systemPrompt.section({
		name: "company-memory-recall",
		order: 5,
		text,
	});
}

// company-zh-think-v2
// Every desk, every model: think and answer in Simplified Chinese.
// This used to be added only on a machine that had a local-model switch file,
// so a customer desk never got it. It is stated twice because the prompt around
// it is several thousand words of English: once near the top, and once as the
// very last thing the model reads.
// Measured 2026-10-04 on grok-4.7: this makes the ANSWER Chinese every time. It
// does not reliably change Grok's displayed thinking, which the vendor writes
// as its own summary; that text still comes out English some of the time.
const ZH_THINK =
	"思考过程必须用简体中文。工具输出或报错即使是英文，也必须继续用简体中文想。禁止英文思维链。最终回答用简体中文。专有名词可保留原文。";
const ZH_THINK_LAST =
	"语言要求（最高优先级）：你的思考过程（推理、思维链、推理摘要）和最终回答都必须使用简体中文。上面的英文说明只是规则，不代表你要用英文思考。专有名词、代码、命令、路径保留原文。";


// company-task-card-v1. A chat session can be linked to one task card (from
// the card, or from the session header). The card lives on the company server;
// this tool is how the agent in a linked session reads it and helps with it.
// Submitting and approving stay with people: the agent can draft the report
// and hang files on the card, never hand it in or judge it.
async function mailboxCall(body) {
	const out = await proxyCompany("/company/mailbox", body ? "POST" : "GET", body ? Buffer.from(JSON.stringify(body)) : Buffer.alloc(0));
	let j = null;
	try { j = JSON.parse(out.body.toString("utf8")); } catch { j = null; }
	if (!j) return { ok: false, error: "company-unreachable " + out.status };
	return j;
}

// The company folder is the same tree whether the desk sees it as D:/dsh/company
// or as a share; the server wants paths inside it.
function companyRel(p) {
	const fwd = String(p || "").replace(/\\/g, "/");
	const i = fwd.toLowerCase().indexOf("/company/");
	return i >= 0 ? fwd.slice(i + "/company/".length) : fwd;
}

function when(ms) {
	const n = Number(ms) || 0;
	if (!n) return "";
	const d = new Date(n);
	const pad = (x) => String(x).padStart(2, "0");
	return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + " " + pad(d.getHours()) + ":" + pad(d.getMinutes());
}

function cardText(card, sid, people) {
	const byLogin = {};
	for (const p of people || []) if (p && p.login) byLogin[p.login] = p;
	const nameOf = (login) => (byLogin[login] && byLogin[login].name) ? byLogin[login].name + "(" + login + ")" : login;
	const lines = [];
	lines.push("任务卡 " + card.id + "「" + card.title + "」 状态：" + card.state);
	lines.push("下达人 " + nameOf(card.from) + " → 负责人 " + nameOf(card.to) + (card.dept ? " · 部门 " + card.dept : ""));
	lines.push("");
	lines.push("【任务内容】");
	lines.push(card.assignment || "（空）");
	lines.push("");
	lines.push("【提交内容（汇报）】");
	lines.push(card.summary || "（还没写）");
	if (card.verdict) {
		lines.push("");
		lines.push("【审批意见】" + (card.state === "未通过" ? "打回：" : "") + card.verdict + (card.approver ? "（" + nameOf(card.approver) + "）" : ""));
	}
	lines.push("");
	lines.push("【交付物】");
	const files = card.files || [];
	if (!files.length) lines.push("（还没有）");
	const folder = String(card.folder || "");
	const cut = folder.toLowerCase().indexOf("/company/");
	const companyRoot = cut >= 0 ? folder.slice(0, cut + "/company/".length) : "";
	for (const f of files) lines.push("- " + f.name + "（" + (f.kind || "文件") + "） " + companyRoot + f.path);
	if (card.folder) {
		lines.push("");
		lines.push("【任务文件夹】" + card.folder);
		lines.push("这张卡的产出文件存到这个文件夹，就会自动列为交付物。");
	}
	lines.push("");
	lines.push("【关联的会话】（处理同一张卡的各个会话）");
	const sessions = card.sessions || [];
	if (!sessions.length) lines.push("（没有）");
	for (const s of sessions) {
		const owner = byLogin[s.account] || {};
		const log = owner.personal ? String(owner.personal).replace(/\\/g, "/") + "/.dsh-desk/sessions/" + s.id + ".jsonl" : "";
		lines.push("- " + (s.id === sid ? "【本会话】" : "") + (s.title || s.id) + " · " + nameOf(s.account) + " · " + when(s.at) + (log && s.id !== sid ? "\n  记录：" + log : ""));
	}
	const events = (card.events || []).slice(-8);
	if (events.length) {
		lines.push("");
		lines.push("【最近动态】");
		for (const e of events) lines.push("- " + when(e.t) + " " + nameOf(e.who) + " " + e.what);
	}
	const may = card.may || {};
	lines.push("");
	lines.push("【你能做的】" + [
		may.edit_summary ? "update 写汇报（summary）" : "",
		may.edit_assignment ? "update 改任务内容（assignment）" : "",
		may.files ? "attach 挂文件" : "",
	].filter(Boolean).join("；") + "。提交验收、审批只能由人在任务卡上点按钮。");
	return lines.join("\n");
}

function registerTaskCardTool(ctx) {
	const tools = typeof ctx.get === "function" ? ctx.get("tools") : ctx.tools;
	if (tools == null || typeof tools.register !== "function") return;
	tools.register({
		name: "task_card",
		description:
			"Read and help with the company task card linked to this chat session. " +
			"When the user mentions 任务卡 / 这个任务 / 交付 / 汇报 / 验收 / 进度, call action=get first and answer from the card. " +
			"get: the card linked to this session (or the one named by ticket), with its assignment, report, deliverables, task folder, the other sessions working on it and recent activity. " +
			"list: the cards this person can see. " +
			"update: write the report draft (summary) or, for the issuer, the assignment. Write the full text; it replaces the old one. " +
			"attach: hang a file that already exists on the card's deliverables. Files saved into the task folder are listed automatically and need no attach. " +
			"Never claim the card was submitted or approved; only a person can do that on the card.",
		parameters: {
			type: "object",
			additionalProperties: false,
			properties: {
				action: { type: "string", enum: ["get", "list", "update", "attach"] },
				ticket: { type: "string", description: "Card id (tk-...). Optional for get/update/attach: defaults to the card linked to this session." },
				summary: { type: "string", description: "update: the full report text." },
				assignment: { type: "string", description: "update: the full assignment text (issuer only)." },
				path: { type: "string", description: "attach: absolute path of the file." },
			},
			required: ["action"],
		},
		output: {
			schema: { type: "object", additionalProperties: true, properties: { ok: { type: "boolean" }, text: { type: "string" } } },
			render(_args, value) {
				const v = value || {};
				return [{ type: "text", text: v.ok ? String(v.text || "") : "task_card: " + String(v.error || "failed") }];
			},
		},
		async execute(args, exec) {
			const a = args || {};
			const sid = sessionIdOf(exec);
			const action = String(a.action || "get");
			if (action === "list") {
				const j = await mailboxCall(null);
				if (!j.ok) return { ok: false, error: j.error || "company-unreachable" };
				const rows = (j.tickets || []).filter((t) => !t.archived);
				if (!rows.length) return { ok: true, text: "没有进行中的任务卡。" };
				return { ok: true, text: rows.map((t) => "- " + t.id + "「" + t.title + "」 " + t.state + " · " + t.from + " → " + t.to + ((t.sessionIds || []).indexOf(sid) >= 0 ? " · 本会话关联" : "")).join("\n") };
			}
			let ticket = String(a.ticket || "");
			let card = null;
			let people = [];
			if (!ticket) {
				const hit = await mailboxCall({ action: "session-card", session: sid });
				if (!hit.ok) return { ok: false, error: hit.error || "company-unreachable" };
				card = hit.card || null;
				if (card == null) return { ok: true, text: "这个会话没有关联任务卡。用户可以在任务卡上点「新建会话」或「关联当前会话」，或者在会话标题旁的「关联任务」里选一张。要看全部任务卡用 action=list。" };
				ticket = card.id;
			}
			if (action === "update") {
				const body = { action: "edit", ticket };
				if (typeof a.summary === "string") body.summary = a.summary;
				if (typeof a.assignment === "string") body.assignment = a.assignment;
				if (!("summary" in body) && !("assignment" in body)) return { ok: false, error: "nothing to update: give summary or assignment" };
				const j = await mailboxCall(body);
				if (!j.ok) return { ok: false, error: j.error || "update-failed" };
				return { ok: true, text: "已写进任务卡 " + ticket + "。\n\n" + cardText(j.card || {}, sid, j.people) };
			}
			if (action === "attach") {
				const rel = companyRel(a.path);
				if (!rel) return { ok: false, error: "attach needs path" };
				const j = await mailboxCall({ action: "attach-file", ticket, path: rel, name: rel.split("/").pop(), kind: "交付", meta: "智能体挂上" });
				if (!j.ok) return { ok: false, error: j.error || "attach-failed" };
				return { ok: true, text: "已挂到任务卡 " + ticket + " 的交付物。" };
			}
			const j = await mailboxCall(null);
			if (!j.ok) return { ok: false, error: j.error || "company-unreachable" };
			people = j.people || [];
			card = (j.tickets || []).find((t) => t.id === ticket) || card;
			if (card == null) return { ok: false, error: "no such card or not visible: " + ticket };
			return { ok: true, text: cardText(card, sid, people) };
		},
	});
}

const TASK_CARD_PROMPT = "公司任务卡：会话可以关联一张任务卡（用户消息开头会有一行【任务卡】指针）。用户问到任务、进度、交付、汇报时，先调用 task_card 的 get 读卡再回答；产出文件存进卡上的任务文件夹；汇报写好后用 task_card 的 update 写进卡里，并告诉用户去卡上点「提交验收」。不要说任务已提交或已通过。";

function addTaskCardSection(ctx) {
	const systemPrompt = ctx.systemPrompt;
	if (systemPrompt == null || typeof systemPrompt.section !== "function") return;
	const row = { name: "company-task-card", order: 40, text: TASK_CARD_PROMPT };
	if (typeof ctx.effect === "function") ctx.effect(() => systemPrompt.section(row), row.name);
	else systemPrompt.section(row);
}

// Talking-head rough cut (koubo): present only on a machine where the tool
// is installed, so other desks are not told about a command they do not have.
function kouboHome() {
	const given = String(process.env.TDH_KOUBO_HOME || "").trim();
	const dir = given || (process.platform === "win32" ? "D:/dsh/tools/koubo" : path.join(os.homedir(), ".tdh", "koubo"));
	return existsSync(path.join(dir, "koubo.py")) ? dir.replace(/\\/g, "/") : "";
}

function addKouboSection(ctx) {
	const systemPrompt = ctx.systemPrompt;
	if (systemPrompt == null || typeof systemPrompt.section !== "function") return;
	const home = kouboHome();
	if (!home) return;
	const cmd = process.platform === "win32" ? home + "/koubo.cmd" : "python3 " + home + "/koubo.py";
	const text =
		"口播短视频：用户要剪口播、做短视频、粗剪、包装、出剪映草稿时，用本机的 koubo skill（" + cmd + "）。" +
		"动手前先完整读一遍 " + home + "/SKILL.md，严格按里面的五步做：对齐声画 → 转写 → 写脚本（分章节、标角色）→ 找证据和空镜 → 包装出草稿。每一步过关再做下一步。" +
		"包装长什么样由风格文件定，你只判断内容，不要自己发明包装。工具输出的 WARN 必须处理到 0 条。" +
		"它出的是剪映草稿，不是成片；看效果和导出由人在剪映里做。不要改用别的剪辑办法，不要说成片已完成。";
	const row = { name: "company-koubo", order: 41, text };
	if (typeof ctx.effect === "function") ctx.effect(() => systemPrompt.section(row), row.name);
	else systemPrompt.section(row);
}

// How the desk's web search behaves, so the model picks the right kind.
function addWebSearchTipSection(ctx) {
	const systemPrompt = ctx.systemPrompt;
	if (systemPrompt == null || typeof systemPrompt.section !== "function") return;
	const row = {
		name: "company-web-search-tip",
		order: 42,
		text: "联网搜索（web_search）有两档。普通查询走境内搜索引擎（必应中国、360、百度），约一秒，给网页列表，适合常识、新闻、找某个网页。查询词以「深搜 」开头则由 Grok 联网检索，约 40–70 秒，会打开页面核对并给出结论和来源，适合查权威出处、论文、指南、需要核实的事实。同一个问题不要两档都反复搜；拿到结果要点开关键来源（web_fetch）再下结论。搜索报错时如实说搜不了，不要凭记忆编来源。",
	};
	if (typeof ctx.effect === "function") ctx.effect(() => systemPrompt.section(row), row.name);
	else systemPrompt.section(row);
}

// Browser work through OpenCLI: the desk's own copy goes on PATH for the
// shell tool, and the model is told how to get a person through the one step
// they must do themselves.
function addOpencliSection(ctx) {
	const shipped = bundledOpencli();
	if (shipped) {
		const dir = path.resolve(path.dirname(shipped), "..", "..", "..", "..", "..");
		const sep = process.platform === "win32" ? ";" : ":";
		const cur = String(process.env.PATH || process.env.Path || "");
		if (cur.split(sep).indexOf(dir) < 0) {
			process.env.PATH = dir + sep + cur;
			if (process.env.Path !== undefined) process.env.Path = process.env.PATH;
		}
	}
	const systemPrompt = ctx.systemPrompt;
	if (systemPrompt == null || typeof systemPrompt.section !== "function") return;
	const row = {
		name: "company-opencli",
		order: 43,
		text:
			"浏览器操作（打开网页、点按钮、填表、看需要登录的网站后台）用 opencli 工具，不要用别的办法。第一次用之前先调用 opencli action=doctor。" +
			"返回 extension-missing 时，说明用户的浏览器还没装 OpenCLI 扩展：按返回里的 guide 带用户装，每次只说一步，等用户说做完了再说下一步，装好后再 doctor 一次确认。" +
			"需要登录的网站由用户自己在浏览器里登录，不要索要密码。只是查公开信息时用 web_search，不必开浏览器。",
	};
	if (typeof ctx.effect === "function") ctx.effect(() => systemPrompt.section(row), row.name);
	else systemPrompt.section(row);
}

function addZhThinkSection(ctx) {
	const systemPrompt = ctx.systemPrompt;
	if (systemPrompt == null || typeof systemPrompt.section !== "function") return;
	const rows = [
		{ name: "company-zh-think", order: 6, text: ZH_THINK },
		{ name: "company-zh-think-last", order: 1000000, text: ZH_THINK_LAST },
	];
	for (const row of rows) {
		if (typeof ctx.effect === "function") ctx.effect(() => systemPrompt.section(row), row.name);
		else systemPrompt.section(row);
	}
}

export function apply(ctx) {
	const tools = typeof ctx.get === "function" ? ctx.get("tools") : ctx.tools;
	addMemoryRecallSection(ctx);
	addZhThinkSection(ctx);
	wrapSkillOnce(tools);
	wrapWebCompanyName(tools);
	wrapDumpScan(tools);
	registerKnowledgeTool(ctx);
	registerPriorWorkTool(ctx);
	registerMemoryWriteTool(ctx);
	registerOpencliTool(ctx);
	registerWatchVideoTool(ctx);
	registerTaskCardTool(ctx);
	addTaskCardSection(ctx);
	addKouboSection(ctx);
	addWebSearchTipSection(ctx);
	addOpencliSection(ctx);
	registerShopRecipeTool(ctx);
	registerShopWriteTool(ctx);
	const web = typeof ctx.get === "function" ? ctx.get("webServer") : null;
	if (web == null || typeof web.register !== "function") return;
	ctx.effect(() =>
		web.register({
			kind: "exact",
			path: "/company/logout",
			handler: async (req, res) => {
				const method = String(req.method || "GET").toUpperCase();
				if (method !== "POST") {
					res.writeHead(405, { "content-type": "application/json" });
					res.end(JSON.stringify({ ok: false, error: "method" }));
					return;
				}
				clearLoginFiles();
				res.writeHead(200, {
					"content-type": "application/json; charset=utf-8",
					"cache-control": "no-store",
				});
				res.end(JSON.stringify({ ok: true }));
			},
		}),
	);
	ctx.effect(() =>
		web.register({
			kind: "exact",
			path: "/company/mailbox",
			handler: async (req, res) => {
				const method = String(req.method || "GET").toUpperCase();
				if (method !== "GET" && method !== "POST") {
					res.writeHead(405, { "content-type": "application/json" });
					res.end(JSON.stringify({ ok: false, error: "method" }));
					return;
				}
				let body = Buffer.alloc(0);
				if (method === "POST") body = await collect(req);
				const q = String((req.url && req.url.split("?")[1]) || "");
				const out = await proxyCompany("/company/mailbox" + (q ? "?" + q : ""), method, body);
				const ctype = (q.indexOf("action=file") >= 0 && out.contentType)
					? out.contentType
					: "application/json; charset=utf-8";
				res.writeHead(out.status, { "content-type": ctype, "cache-control": "no-store" });
				res.end(out.body);
			},
		}),
	);
	ctx.effect(() =>
		web.register({
			kind: "exact",
			path: "/company/me",
			handler: async (req, res) => {
				const method = String(req.method || "GET").toUpperCase();
				if (method !== "GET") {
					res.writeHead(405, { "content-type": "application/json" });
					res.end(JSON.stringify({ ok: false, error: "method" }));
					return;
				}
				res.writeHead(200, {
					"content-type": "application/json; charset=utf-8",
					"cache-control": "no-store",
				});
				res.end(JSON.stringify({
					ok: true,
					role: loginRoleFile(),
					login: loginNameFile(),
				}));
			},
		}),
	);
	ctx.effect(() =>
		web.register({
			kind: "exact",
			path: "/company/grok-quota",
			handler: async (req, res) => {
				const method = String(req.method || "GET").toUpperCase();
				if (method !== "GET") {
					res.writeHead(405, { "content-type": "application/json" });
					res.end(JSON.stringify({ ok: false, error: "method" }));
					return;
				}
				const out = await proxyGw("/grok-quota", "GET", Buffer.alloc(0));
				res.writeHead(out.status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
				res.end(out.body);
			},
		}),
	);
	ctx.effect(() =>
		web.register({
			kind: "exact",
			path: "/company/grok-fast",
			handler: async (req, res) => {
				const method = String(req.method || "GET").toUpperCase();
				if (method !== "GET" && method !== "POST") {
					res.writeHead(405, { "content-type": "application/json" });
					res.end(JSON.stringify({ ok: false, error: "method" }));
					return;
				}
				let body = Buffer.alloc(0);
				if (method === "POST") body = await collect(req);
				const out = await proxyGw("/grok-fast", method, body);
				res.writeHead(out.status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
				res.end(out.body);
			},
		}),
	);
	ctx.effect(() =>
		web.register({
			kind: "exact",
			path: "/company/channels",
			handler: async (req, res) => {
				const method = String(req.method || "GET").toUpperCase();
				if (method !== "GET" && method !== "POST") {
					res.writeHead(405, { "content-type": "application/json" });
					res.end(JSON.stringify({ ok: false, error: "method" }));
					return;
				}
				let body = Buffer.alloc(0);
				if (method === "POST") body = await collect(req);
				if (method === "POST") {
					let ask = null;
					try { ask = JSON.parse(body.toString("utf8") || "{}"); } catch { ask = null; }
					const grok = ask && String(ask.vendor || "").toLowerCase() === "grok";
					if (grok && ask.action === "apply-models") {
						let done;
						try {
							const picks = cleanModelPicks(ask.models);
							done = await writeGrokModels(ctx, picks);
							const fast = picks.filter((m) => m.fast).map((m) => m.id);
							const told = await proxyGw("/channels", "POST", Buffer.from(JSON.stringify({ action: "set-fast", vendor: "grok", models: fast })));
							done.fast = told.status === 200 ? fast.length : -1;
						}
						catch (err) { done = { ok: false, error: "write-failed", hint: String((err && err.message) || err).slice(0, 200) }; }
						res.writeHead(done.ok ? 200 : 500, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
						res.end(JSON.stringify(done));
						return;
					}
					if (grok && ask.action === "picked-models") {
						res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
						res.end(JSON.stringify({ ok: true, models: pickedGrokModels(ctx) }));
						return;
					}
				}
				const out = await proxyGw("/channels", method, body);
				res.writeHead(out.status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
				res.end(out.body);
			},
		}),
	);
	ctx.effect(() =>
		web.register({
			kind: "exact",
			path: "/company/people",
			handler: async (req, res) => {
				const method = String(req.method || "GET").toUpperCase();
				if (method !== "GET" && method !== "POST") {
					res.writeHead(405, { "content-type": "application/json" });
					res.end(JSON.stringify({ ok: false, error: "method" }));
					return;
				}
				let body = Buffer.alloc(0);
				if (method === "POST") body = await collect(req);
				const out = await proxyCompany("/company/people", method, body);
				res.writeHead(out.status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
				res.end(out.body);
			},
		}),
	);
	ctx.effect(() =>
		web.register({
			kind: "exact",
			path: "/company/kernel-watch",
			handler: async (req, res) => {
				const method = String(req.method || "GET").toUpperCase();
				if (method !== "GET" && method !== "POST") {
					res.writeHead(405, { "content-type": "application/json" });
					res.end(JSON.stringify({ ok: false, error: "method" }));
					return;
				}
				if (method === "POST") {
					const raw = await collect(req);
					let body = {};
					try { body = JSON.parse(raw.toString("utf8") || "{}"); } catch { body = {}; }
					if (body.action === "publish") {
						if (loginRoleFile() !== "admin") {
							res.writeHead(403, { "content-type": "application/json" });
							res.end(JSON.stringify({ ok: false, error: "admin-only" }));
							return;
						}
						const hit = kernelWatchPublish();
						res.writeHead(hit.ok ? 200 : 409, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
						res.end(JSON.stringify(hit));
						return;
					}
					if (body.action === "upgrade") {
						if (loginRoleFile() !== "admin") {
							res.writeHead(403, { "content-type": "application/json" });
							res.end(JSON.stringify({ ok: false, error: "admin-only" }));
							return;
						}
						const hit = await kernelWatchUpgrade(body.version);
						res.writeHead(hit.ok ? 200 : 409, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
						res.end(JSON.stringify(hit));
						return;
					}
					if (body.action === "cutover") {
						if (loginRoleFile() !== "admin") {
							res.writeHead(403, { "content-type": "application/json" });
							res.end(JSON.stringify({ ok: false, error: "admin-only" }));
							return;
						}
						const hit = kernelWatchCutover(body.version);
						res.writeHead(hit.ok ? 200 : 409, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
						res.end(JSON.stringify(hit));
						return;
					}
					if (body.action === "plug") {
						if (loginRoleFile() !== "admin") {
							res.writeHead(403, { "content-type": "application/json" });
							res.end(JSON.stringify({ ok: false, error: "admin-only" }));
							return;
						}
						const hit = kernelWatchPlug(body.version);
						res.writeHead(hit.ok ? 200 : 409, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
						res.end(JSON.stringify(hit));
						return;
					}
				}
				const snap = await kernelWatchSnapshot(method === "POST");
				res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
				res.end(JSON.stringify(snap));
			},
		}),
	);
}
