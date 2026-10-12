/**
 * shop_recipe runner: run a NAMED read-only recipe against the seller backstage
 * through the one agreed hand (OpenCLI).
 *
 * Why named recipes and not JS from the model: an eval in a logged-in seller tab
 * is a shell in the shop owner's identity (it can reprice, delist, refund). So
 * the model may only pick an id from the manifest and pass JSON params; the
 * script body lives in a read-only directory the model cannot write.
 *
 * Batching exists because the fixed cost per call is the CLI spawn plus the
 * extension round trip (~275ms measured), while the signed MTOP read itself is
 * ~150-200ms. One eval carrying N recipes pays that fixed cost once.
 *
 * Page warmth matters: an expired tab lease drops the session to about:blank,
 * where window.lib.mtop does not exist and every recipe would fail with a
 * confusing ReferenceError. The runner detects that and reopens (~19s, paid
 * once) instead of reporting a fake failure.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Recipe ids are dotted lowercase, e.g. shop.pending.v1. No slashes, no dots-dots. */
export const RECIPE_ID_RE = /^[a-z][a-z0-9]*(?:\.[a-z0-9]+)*$/;

/** Argument names that would mean "model supplied code". Always refused. */
export const RAW_JS_KEYS = ["js", "script", "expression", "code", "eval", "body", "source"];

export const MAX_PARAMS_JSON = 2000;
export const MAX_BATCH = 6;
const MARKER = "company-shop-recipe-v1";

function here() {
	return path.dirname(fileURLToPath(import.meta.url));
}

/**
 * Where recipe files may live, most specific first. One root wins per call and
 * is reported in every result, so "which file ran" is never a guess.
 */
export function recipeRootCandidates(env = process.env) {
	const rows = [];
	if (env.COMPANY_SHOP_RECIPES) rows.push(env.COMPANY_SHOP_RECIPES);
	const skills =
		env.COMPANY_SKILLS ||
		(process.platform === "win32" ? "Z:/_skills" : path.join(os.homedir(), "company", "_skills"));
	rows.push(path.join(skills, "company-shop", "recipes"));
	const dshHome = env.DSH_HOME || path.join(os.homedir(), ".dsh-company-rc8", "desk-home");
	rows.push(path.join(dshHome, "shop-recipes"));
	rows.push(path.join(here(), "recipes"));
	// Repo layout, so the prove script can run before anything is planted. This
	// path does not exist on an employee desk, where the company disk wins above.
	rows.push(path.resolve(here(), "..", "..", "..", "p-shop-mcp", "recipes"));
	return rows;
}

/**
 * Where the recipes we are about to run actually came from. The company share is
 * the authority; anything else is a local fallback kept for the day the share
 * hiccups (2026-09-18: smbfs went ENOTCONN mid-session and the shop hand died
 * with it). Reported on every answer, because "which copy ran" is not something
 * a reader should have to infer from a path.
 */
export function rootAuthority(root, env = process.env) {
	if (!root) return "none";
	const skills =
		env.COMPANY_SKILLS ||
		(process.platform === "win32" ? "Z:/_skills" : path.join(os.homedir(), "company", "_skills"));
	// Compare real paths: resolveRecipeRoot() returns a realpath, and on macOS the
	// share (or a temp dir) can sit behind a symlink, so a plain string compare
	// would call the authoritative copy a fallback.
	const real = (p) => {
		try {
			return realpathSync(p);
		} catch {
			return path.resolve(p);
		}
	};
	const onShare = real(root).startsWith(real(skills) + path.sep);
	return onShare ? "company-disk" : "local-fallback";
}

export function resolveRecipeRoot(env = process.env) {
	for (const root of recipeRootCandidates(env)) {
		try {
			if (existsSync(path.join(root, "manifest.json"))) return realpathSync(root);
		} catch {
			/* unreadable candidate: try the next one */
		}
	}
	return "";
}

export function loadManifest(root) {
	const raw = readFileSync(path.join(root, "manifest.json"), "utf8");
	const m = JSON.parse(raw);
	if (m == null || typeof m !== "object" || m.recipes == null || typeof m.recipes !== "object") {
		throw new Error("manifest-shape");
	}
	return m;
}

export function listShopRecipes(root) {
	const m = loadManifest(root);
	return Object.entries(m.recipes).map(([id, e]) => ({
		id,
		title: e.title || "",
		api: e.api || null,
		page: e.page || "",
		writes: !!e.writes,
	}));
}

/**
 * Read one recipe body, refusing anything that resolves outside the root.
 * The id regex already rejects separators; this is the second fence, on the
 * resolved real path, because manifest `file` values are also data.
 */
export function readRecipeBody(root, entry) {
	const file = String(entry.file || "");
	if (!file || /[\\/]/.test(file)) throw new Error("recipe-file-shape");
	const full = path.join(root, file);
	const real = realpathSync(full);
	const rootReal = realpathSync(root);
	if (real !== path.join(rootReal, path.basename(real))) throw new Error("recipe-escapes-root");
	if (!statSync(real).isFile()) throw new Error("recipe-not-file");
	const body = readFileSync(real, "utf8");
	return { body, file: real, sha256: createHash("sha256").update(body).digest("hex").slice(0, 16) };
}

export function validateParams(params) {
	if (params === undefined || params === null) return {};
	if (typeof params !== "object" || Array.isArray(params)) throw new Error("params-not-object");
	for (const [k, v] of Object.entries(params)) {
		if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(k)) throw new Error("params-bad-key:" + k);
		const t = typeof v;
		if (v !== null && t !== "string" && t !== "number" && t !== "boolean") {
			throw new Error("params-bad-value:" + k);
		}
	}
	const json = JSON.stringify(params);
	if (json.length > MAX_PARAMS_JSON) throw new Error("params-too-big");
	return params;
}

/** Wrap N recipe bodies into ONE page expression. Each one fails on its own. */
export function buildBatchExpr(items) {
	const parts = items.map((it) => {
		const body = `(\n${it.body}\n)`;
		const args = JSON.stringify(it.params || {});
		return (
			`out[${JSON.stringify(it.id)}] = await (async () => { try { return await ${body}(${args}) } ` +
			`catch (e) { return { ok: false, error: String(e && e.message ? e.message : e) } } })();`
		);
	});
	return (
		"(async () => { const out = {};\n" +
		parts.join("\n") +
		"\nreturn { marker: " +
		JSON.stringify(MARKER) +
		", url: location.href, hasMtop: !!(window.lib && window.lib.mtop), results: out } })()"
	);
}

/** opencli prints warnings before its JSON. Take the first balanced block. */
export function extractJson(text) {
	const s = String(text || "");
	for (let i = 0; i < s.length; i++) {
		const c = s[i];
		if (c !== "{" && c !== "[") continue;
		for (let j = s.length; j > i; j--) {
			const end = s.lastIndexOf(c === "{" ? "}" : "]", j);
			if (end <= i) break;
			try {
				return JSON.parse(s.slice(i, end + 1));
			} catch {
				j = end;
			}
		}
	}
	return undefined;
}

/**
 * Carrier: where the page actually lives.
 *
 * `webview` is the hidden WKWebView/WebView2 inside our own shell, reached over
 * a loopback bridge. `opencli` drives the employee's own Chrome, which is only
 * acceptable on a machine where the human agreed to share the browser: the tab
 * is visible and a reload lands in front of them.
 */
export const CARRIERS = ["webview", "opencli"];

export function bridgeInfoPath(env = process.env) {
	if (env.COMPANY_SHOP_BRIDGE) return env.COMPANY_SHOP_BRIDGE;
	const rc = env.COMPANY_RC_DIR || path.join(os.homedir(), ".dsh-company-rc8");
	return path.join(rc, "shop-bridge.json");
}

export function readBridge(env = process.env) {
	const p = bridgeInfoPath(env);
	let raw;
	try {
		raw = readFileSync(p, "utf8");
	} catch {
		return { ok: false, status: "bridge-missing", path: p };
	}
	let info;
	try {
		info = JSON.parse(raw);
	} catch {
		return { ok: false, status: "bridge-unreadable", path: p };
	}
	if (!info || typeof info.url !== "string" || typeof info.secret !== "string") {
		return { ok: false, status: "bridge-shape", path: p };
	}
	if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(info.url)) {
		return { ok: false, status: "bridge-not-loopback", path: p, url: info.url };
	}
	return { ok: true, url: info.url, secret: info.secret, pid: info.pid, path: p };
}

/**
 * Sync HTTP through curl, so the whole runner stays synchronous like the
 * opencli path and pulls in no dependency. `--noproxy` matters: a desk with
 * HTTP_PROXY set would otherwise send loopback traffic out to the proxy.
 */
export function bridgeCall(deps, bridge, method, route, payload, timeoutSec) {
	// A desk that is still booting publishes the file a moment before it accepts,
	// and a bare refusal there reads as "the shop is down" when the honest answer
	// is "wait two seconds". Only connection-level failures are retried; an HTTP
	// answer of any code is a real answer and is returned as it is.
	let last = bridgeCallOnce(deps, bridge, method, route, payload, timeoutSec);
	if (last.code !== 0) return last;
	const sleep = deps.sleep || ((ms) => {
		Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
	});
	for (let i = 0; i < 4; i++) {
		sleep(1500);
		last = bridgeCallOnce(deps, bridge, method, route, payload, timeoutSec);
		if (last.code !== 0) return last;
	}
	return last;
}

function bridgeCallOnce(deps, bridge, method, route, payload, timeoutSec) {
	const sp = deps.spawnSync || spawnSync;
	const args = [
		"-s",
		"--noproxy",
		"*",
		"-m",
		String(timeoutSec || 60),
		"-X",
		method,
		"-H",
		"Authorization: Bearer " + bridge.secret,
		"-H",
		"Content-Type: application/json",
		"-w",
		"\n%{http_code}",
	];
	if (payload !== undefined) args.push("--data-binary", "@-");
	args.push(bridge.url + route);
	const r = sp("curl", args, {
		encoding: "utf8",
		timeout: (timeoutSec || 60) * 1000 + 5000,
		input: payload === undefined ? undefined : JSON.stringify(payload),
	});
	const out = String(r.stdout || "");
	const nl = out.lastIndexOf("\n");
	const code = Number(nl >= 0 ? out.slice(nl + 1).trim() : "0") || 0;
	const body = nl >= 0 ? out.slice(0, nl) : out;
	return { code, body, parsed: extractJson(body), err: String(r.stderr || "") };
}

/// Trailing slashes differ between what we ask for and what 淘宝 settles on
/// (`/home.htm` becomes `/home.htm/QnworkbenchHome/`), so compare on a stem.
function pageStem(u) {
	try {
		const p = new URL(u);
		return (p.origin + p.pathname).replace(/\/+$/, "");
	} catch {
		return "";
	}
}

export function ensurePageWebview(deps, bridge, opts) {
	const { pageUrl, needMtop, exactPage } = opts;
	const probe = "({u:location.href,m:!!(window.lib&&window.lib.mtop)})";
	const look = () => {
		const r = bridgeCall(deps, bridge, "POST", "/eval", { js: probe }, 30);
		if (r.code === 401) return { fatal: "bridge-bad-secret" };
		if (r.code === 0) return { fatal: "bridge-down" };
		const v = r.parsed;
		if (!v || v.ok !== true || v.value == null) return {};
		return { seen: v.value };
	};
	const wantOrigin = (() => {
		try {
			return new URL(pageUrl).origin;
		} catch {
			return "";
		}
	})();
	// An mtop recipe only needs *some* logged-in seller page, so origin is
	// enough and we avoid a needless reload. A recorded recipe reports what one
	// specific page fetched, so landing on the workbench instead of 已卖出宝贝
	// must count as wrong page, not as "already there" — that mistake returns
	// matched:0 and reads like "this shop has no orders".
	const wantStem = exactPage ? pageStem(pageUrl) : "";
	const good = (s) =>
		s && typeof s.u === "string" && s.u !== "about:blank" && s.u !== "" &&
		(!wantOrigin || s.u.startsWith(wantOrigin)) &&
		(!wantStem || pageStem(s.u).startsWith(wantStem)) &&
		(!needMtop || s.m === true);

	const sleepMs = deps.sleep || ((ms) => {
		Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
	});

	let first = look();
	if (first.fatal) return { ok: false, reason: first.fatal };
	if (good(first.seen)) return { ok: true, url: first.seen.u, hasMtop: !!first.seen.m, reopened: false };

	const nav = bridgeCall(deps, bridge, "POST", "/nav", { url: pageUrl }, 30);
	if (nav.code === 401) return { ok: false, reason: "bridge-bad-secret" };
	if (nav.code !== 200) return { ok: false, reason: "nav-failed", log: nav.body.slice(-300) };

	let seen;
	for (let i = 0; i < 20; i++) {
		sleepMs(1200);
		const r = look();
		if (r.fatal) return { ok: false, reason: r.fatal };
		seen = r.seen;
		if (good(seen)) {
			// The url turns right the moment the document commits, but a recorded
			// recipe wants the calls that document then makes. Give the page a few
			// seconds or the recorder is read while it is still empty.
			if (exactPage) sleepMs(5000);
			return { ok: true, url: seen.u, hasMtop: !!seen.m, reopened: true };
		}
	}
	if (seen && typeof seen.u === "string" && /login|passport/i.test(seen.u)) {
		return { ok: false, reason: "not-logged-in", url: seen.u, reopened: true };
	}
	return {
		ok: false,
		reason: needMtop ? "page-has-no-mtop-sdk" : "page-not-ready",
		url: seen && seen.u ? seen.u : "",
		reopened: true,
	};
}

function opencliArgv(profile, session, rest) {
	const head = profile ? ["--profile", profile] : [];
	return [...head, "browser", session, ...rest];
}

function runCli(deps, bin, argv, timeout, cwd) {
	const sp = deps.spawnSync || spawnSync;
	const r = sp(bin, argv, { encoding: "utf8", timeout, cwd });
	return {
		status: r.status,
		out: String(r.stdout || ""),
		err: String(r.stderr || ""),
	};
}

/**
 * Make sure the session sits on the recipe's page with the SDK present.
 * Returns { ok, url, hasMtop, reopened, reason }.
 */
export function ensurePage(deps, bin, opts) {
	const { session, profile, pageUrl, needMtop, cwd } = opts;
	const probe = "({u:location.href,m:!!(window.lib&&window.lib.mtop)})";
	const look = () => {
		const r = runCli(deps, bin, opencliArgv(profile, session, ["eval", probe]), 60000, cwd);
		const v = extractJson(r.out);
		return v && typeof v === "object" ? v : undefined;
	};
	let seen = look();
	const wantOrigin = (() => {
		try {
			return new URL(pageUrl).origin;
		} catch {
			return "";
		}
	})();
	const good = (s) =>
		s && typeof s.u === "string" && s.u !== "about:blank" &&
		(!wantOrigin || s.u.startsWith(wantOrigin)) &&
		(!needMtop || s.m === true);
	if (good(seen)) return { ok: true, url: seen.u, hasMtop: !!seen.m, reopened: false };

	const op = runCli(deps, bin, opencliArgv(profile, session, ["open", pageUrl, "--window", "background"]), 150000, cwd);
	if (op.status !== 0) {
		return { ok: false, reason: "open-failed", log: (op.err || op.out).slice(-400), reopened: true };
	}
	// The host tool path is synchronous, so waiting must block without burning a
	// core: Atomics.wait on a private buffer is the sync sleep primitive.
	const sleep = deps.sleep || ((ms) => {
		Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
	});
	for (let i = 0; i < 10; i++) {
		seen = look();
		if (good(seen)) return { ok: true, url: seen.u, hasMtop: !!seen.m, reopened: true };
		sleep(1500);
	}
	if (seen && typeof seen.u === "string" && /login|passport/i.test(seen.u)) {
		return { ok: false, reason: "not-logged-in", url: seen.u, reopened: true };
	}
	return {
		ok: false,
		reason: needMtop ? "page-has-no-mtop-sdk" : "page-not-ready",
		url: seen && seen.u ? seen.u : "",
		reopened: true,
	};
}

/**
 * Run one or more named read-only recipes.
 * args: { recipe?: string, recipes?: string[], params?: object, session?, profile? }
 */
export function runShopRecipe(args, deps = {}) {
	const env = deps.env || process.env;
	const fail = (status, extra) => ({ ok: false, status, marker: MARKER, ...(extra || {}) });

	for (const k of RAW_JS_KEYS) {
		if (args && Object.prototype.hasOwnProperty.call(args, k)) {
			return fail("raw-js-refused", {
				hint: "shop_recipe runs named recipes only. Pick an id from action=list. Raw page JS is not available on this desk.",
			});
		}
	}

	const ids = [];
	if (args && typeof args.recipe === "string" && args.recipe) ids.push(args.recipe);
	if (args && Array.isArray(args.recipes)) for (const r of args.recipes) ids.push(String(r));
	const action = String((args && args.action) || (ids.length ? "run" : "list"));

	const root = resolveRecipeRoot(env);
	if (!root) return fail("no-recipe-root", { hint: "plant recipes first: scripts/p-shop-mcp/plant-shop-recipes.sh" });

	let manifest;
	try {
		manifest = loadManifest(root);
	} catch (e) {
		return fail("bad-manifest", { root, error: String(e.message || e) });
	}

	if (action === "list") {
		return { ok: true, status: "list", marker: MARKER, root, authority: rootAuthority(root, env), recipes: listShopRecipes(root) };
	}
	if (action !== "run") return fail("unknown-action", { root });
	if (!ids.length) return fail("need-recipe", { root, hint: "action=list shows the ids" });
	if (ids.length > MAX_BATCH) return fail("batch-too-big", { root, max: MAX_BATCH });

	let params;
	try {
		params = validateParams(args && args.params);
	} catch (e) {
		return fail("bad-params", { root, error: String(e.message || e) });
	}

	const items = [];
	let needMtop = false;
	let exactPage = false;
	let pageUrl = "";
	for (const id of ids) {
		if (!RECIPE_ID_RE.test(id)) return fail("bad-recipe-id", { root, id });
		const entry = manifest.recipes[id];
		if (entry === undefined) {
			return fail("unknown-recipe", { root, id, known: Object.keys(manifest.recipes) });
		}
		if (entry.writes) {
			return fail("writes-not-allowed", {
				root,
				id,
				hint: "phase 1 is read-only; a write recipe needs its own approval path, not this tool",
			});
		}
		let loaded;
		try {
			loaded = readRecipeBody(root, entry);
		} catch (e) {
			return fail("bad-recipe-file", { root, id, error: String(e.message || e) });
		}
		if (entry.api) needMtop = true;
		if (entry.exactPage) exactPage = true;
		if (!pageUrl) pageUrl = String(entry.page || "");
		else if (entry.page && entry.page !== pageUrl) {
			return fail("batch-page-mismatch", { root, id, want: pageUrl, got: entry.page });
		}
		items.push({ id, body: loaded.body, params, sha256: loaded.sha256, file: loaded.file });
	}
	if (!pageUrl) return fail("recipe-has-no-page", { root, ids });

	const bridge = readBridge(env);
	let carrier = String((args && args.carrier) || env.COMPANY_SHOP_CARRIER || "");
	if (carrier && !CARRIERS.includes(carrier)) return fail("unknown-carrier", { root, carrier, known: CARRIERS });
	// Default to the shell's own hidden context. Fall back to the person's Chrome
	// only when this desk has no bridge, and say so in the result: "we drove your
	// browser" must never be silent.
	// A desk with no bridge at all is an older shell, so falling back is right.
	// A bridge file that exists but is wrong is a fault to report: silently
	// reaching for the person's Chrome instead would hide a broken shell.
	if (!carrier) carrier = bridge.ok || bridge.status !== "bridge-missing" ? "webview" : "opencli";
	const expr = buildBatchExpr(items);
	const common = {
		root,
		authority: rootAuthority(root, env),
		carrier,
		recipes: items.map((i) => ({ id: i.id, sha256: i.sha256 })),
	};

	if (carrier === "webview") {
		if (!bridge.ok) {
			return fail(bridge.status, {
				...common,
				path: bridge.path,
				hint: "the hidden shop view lives in TDHarness; open the app, or pass carrier=opencli to use your own Chrome",
			});
		}
		const page = ensurePageWebview(deps, bridge, { pageUrl, needMtop, exactPage });
		if (!page.ok) {
			return fail(page.reason, {
				...common,
				url: page.url || "",
				log: page.log || "",
				hint:
					page.reason === "not-logged-in"
						? "open TDHarness menu 店铺登录（后台窗口）and log in once; the agent cannot log in"
						: "check that TDHarness is running",
			});
		}
		const r = bridgeCall(deps, bridge, "POST", "/eval", { js: expr }, 120);
		if (r.code === 401) return fail("bridge-bad-secret", common);
		if (r.code !== 200 || !r.parsed) return fail("eval-failed", { ...common, code: r.code, log: r.body.slice(-600) });
		if (r.parsed.ok !== true) {
			return fail("eval-failed", { ...common, error: String(r.parsed.error || "").slice(0, 400) });
		}
		const value = r.parsed.value;
		if (!value || value.marker !== MARKER) {
			return fail("bad-eval-shape", { ...common, got: Object.keys(value || {}) });
		}
		return {
			ok: true,
			status: "run-ok",
			marker: MARKER,
			...common,
			url: value.url,
			hidden: true,
			reopened: !!page.reopened,
			results: value.results || {},
		};
	}

	const bin = deps.resolveOpencli ? deps.resolveOpencli(env.DSH_HOME) : "";
	if (!bin) {
		return fail("opencli-missing", { ...common, hint: "opencli action=ensure, then retry. Do not call ego_* / browser_*." });
	}

	const session = String((args && args.session) || env.COMPANY_SHOP_SESSION || "shop");
	const profile = String((args && args.profile) || env.COMPANY_SHOP_PROFILE || "");
	const cwd = env.DSH_HOME || process.cwd();

	const page = ensurePage(deps, bin, { session, profile, pageUrl, needMtop, cwd });
	if (!page.ok) {
		return fail(page.reason, {
			...common,
			url: page.url || "",
			log: page.log || "",
			hint:
				page.reason === "not-logged-in"
					? "the shop owner must log in once in that browser profile; the agent cannot do it"
					: "reopen failed; check opencli doctor",
		});
	}

	const r = runCli(deps, bin, opencliArgv(profile, session, ["eval", expr]), 90000, cwd);
	const parsed = extractJson(r.out);
	if (r.status !== 0 || parsed === undefined) {
		return fail("eval-failed", {
			...common,
			exit: r.status,
			log: (r.err || r.out).slice(-600),
		});
	}
	if (parsed.marker !== MARKER) {
		return fail("bad-eval-shape", { ...common, got: Object.keys(parsed || {}) });
	}
	return {
		ok: true,
		status: "run-ok",
		marker: MARKER,
		...common,
		session,
		profile: profile || "(default)",
		url: parsed.url,
		hidden: false,
		usedYourBrowser: true,
		reopened: !!page.reopened,
		results: parsed.results || {},
	};
}
