/**
 * shop_write runner: change ONE thing in the seller backstage, with a human in
 * the loop that the model cannot play.
 *
 * Deliberately a separate tool from shop_recipe. shop_recipe refuses writes and
 * that refusal is worth keeping absolute: anyone reading it knows it cannot
 * touch the shop. Writes get their own hand, their own recipe directory, their
 * own gates, and their own log, so a mistake here cannot spread to there.
 *
 * The chain, and why each link exists:
 *
 *   plan    read the current value out of the page, render the diff, ask the
 *           app for an approval ticket. The app shows the diff in ITS OWN
 *           window and the person clicks. The model never sees a code it could
 *           replay, because there is no code — the decision lives in a button.
 *   commit  re-read the current value. If the shop moved since the plan, the
 *           digest no longer matches and the approval is refused rather than
 *           applied to a state nobody agreed to. Then spend the ticket (once),
 *           write, read back, and log.
 *
 * Nothing here is stored between plan and commit: the digest is recomputed from
 * (recipe id, script hash, params, current state). That is both the replay guard
 * and the optimistic lock, and it means a crash between the two steps leaves
 * nothing half-done.
 *
 * Params are never guessed. A write recipe replays the call the page itself was
 * watched making (see recipes/shop-recorded.v1.js for why guessing loses), with
 * only allowlisted fields substituted, and this runner checks the replay target
 * against the api named in the manifest before any human is asked to approve it.
 */
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
	RAW_JS_KEYS,
	RECIPE_ID_RE,
	bridgeCall,
	ensurePageWebview,
	readBridge,
	rootAuthority,
	validateParams,
} from "./shop-recipe.js";

const MARKER = "company-shop-write-v1";
/** A write is one thing at a time. No batch, on purpose. */
export const TICKET_TTL_SEC = 300;
export const DEFAULT_MAX_PER_HOUR = 20;

function here() {
	return path.dirname(fileURLToPath(import.meta.url));
}

export function rcDir(env = process.env) {
	return env.COMPANY_RC_DIR || path.join(os.homedir(), ".dsh-company-rc8");
}

export function writeStateDir(env = process.env) {
	return path.join(rcDir(env), "shop-writes");
}

/** Same search order as reads, but a different directory: writes/ not recipes/. */
export function writeRootCandidates(env = process.env) {
	const rows = [];
	if (env.COMPANY_SHOP_WRITES) rows.push(env.COMPANY_SHOP_WRITES);
	const skills =
		env.COMPANY_SKILLS ||
		(process.platform === "win32" ? "Z:/_skills" : path.join(os.homedir(), "company", "_skills"));
	rows.push(path.join(skills, "company-shop", "writes"));
	const dshHome = env.DSH_HOME || path.join(os.homedir(), ".dsh-company-rc8", "desk-home");
	rows.push(path.join(dshHome, "shop-writes-lib"));
	rows.push(path.join(here(), "writes"));
	rows.push(path.resolve(here(), "..", "..", "..", "p-shop-mcp", "writes"));
	return rows;
}

export function resolveWriteRoot(env = process.env) {
	for (const root of writeRootCandidates(env)) {
		try {
			if (existsSync(path.join(root, "manifest.json"))) return realpathSync(root);
		} catch {
			/* unreadable candidate: try the next */
		}
	}
	return "";
}

export function loadWriteManifest(root) {
	const m = JSON.parse(readFileSync(path.join(root, "manifest.json"), "utf8"));
	if (m == null || typeof m !== "object" || m.actions == null || typeof m.actions !== "object") {
		throw new Error("manifest-shape");
	}
	return m;
}

export function readWriteBody(root, entry) {
	const file = String(entry.file || "");
	if (!file || /[\\/]/.test(file)) throw new Error("recipe-file-shape");
	const real = realpathSync(path.join(root, file));
	const rootReal = realpathSync(root);
	if (real !== path.join(rootReal, path.basename(real))) throw new Error("recipe-escapes-root");
	if (!statSync(real).isFile()) throw new Error("recipe-not-file");
	const body = readFileSync(real, "utf8");
	return { body, file: real, sha256: createHash("sha256").update(body).digest("hex").slice(0, 16) };
}

/**
 * Only the fields the manifest names, only the types it names. A write recipe
 * that accepts a free-form object would be a way to smuggle intent past the
 * diff the human reads.
 */
export function checkWriteParams(entry, params) {
	const want = entry.params || {};
	for (const k of Object.keys(params)) {
		if (!Object.prototype.hasOwnProperty.call(want, k)) {
			throw new Error("param-not-allowed:" + k);
		}
	}
	for (const [k, type] of Object.entries(want)) {
		const v = params[k];
		if (v === undefined || v === null) throw new Error("param-missing:" + k);
		if (typeof v !== type) throw new Error("param-type:" + k + ":want-" + type);
	}
	return params;
}

/**
 * The blast-radius fence, in numbers the manifest declares rather than numbers
 * the recipe decides. `199 -> 1` is a plausible typo and passes every type
 * check, so somebody has to say out loud how far one write may move a value.
 */
export function checkGuard(entry, params, before) {
	const g = entry.guard;
	if (!g) return;
	const field = String(g.field || "");
	const v = Number(params[field]);
	if (!Number.isFinite(v)) throw new Error("guard-not-numeric:" + field);
	if (g.min !== undefined && v < Number(g.min)) throw new Error("guard-below-min:" + field + ":" + g.min);
	if (g.max !== undefined && v > Number(g.max)) throw new Error("guard-above-max:" + field + ":" + g.max);
	if (g.maxDelta !== undefined) {
		const from = Number(before && before[g.beforeKey || field]);
		if (!Number.isFinite(from)) throw new Error("guard-no-before:" + (g.beforeKey || field));
		if (Math.abs(v - from) > Number(g.maxDelta)) {
			throw new Error("guard-delta-too-big:" + Math.abs(v - from) + ">" + g.maxDelta);
		}
	}
}

export function auditPath(env = process.env) {
	return path.join(writeStateDir(env), "audit.jsonl");
}

export function readAudit(env = process.env) {
	try {
		return readFileSync(auditPath(env), "utf8")
			.split("\n")
			.filter(Boolean)
			.map((l) => {
				try {
					return JSON.parse(l);
				} catch {
					return null;
				}
			})
			.filter(Boolean);
	} catch {
		return [];
	}
}

export function appendAudit(row, env = process.env) {
	const dir = writeStateDir(env);
	mkdirSync(dir, { recursive: true });
	appendFileSync(auditPath(env), JSON.stringify(row) + "\n", { mode: 0o600 });
}

/** A runaway loop should hit a wall it did not choose. Counted from the log. */
export function checkRate(entry, manifest, env = process.env, now = Date.now()) {
	const max = Number(entry.maxPerHour || manifest.maxPerHour || DEFAULT_MAX_PER_HOUR);
	const since = now - 3600 * 1000;
	const n = readAudit(env).filter((r) => r && r.phase === "commit" && Number(r.atMs) >= since).length;
	if (n >= max) throw new Error("rate-limited:" + n + "/" + max + "-per-hour");
}

export function templatePath(recipe, env = process.env) {
	return path.join(writeStateDir(env), "templates", recipe + ".json");
}

export function readTemplate(recipe, env = process.env) {
	try {
		return JSON.parse(readFileSync(templatePath(recipe, env), "utf8"));
	} catch {
		return null;
	}
}

/**
 * A template is the page's own call, captured once. It is data on disk, so it is
 * checked like data: the api it would replay must be the one the manifest names.
 * Without this, swapping the file would change what a write does while the
 * approval panel still said 改库存.
 */
export function checkTemplate(entry, tpl) {
	if (!tpl || typeof tpl !== "object") throw new Error("template-missing");
	const api = String(tpl.api || "");
	if (!api) throw new Error("template-no-api");
	if (entry.api && api !== entry.api) throw new Error("template-api-mismatch:" + api);
	if (tpl.data === undefined) throw new Error("template-no-data");
	return tpl;
}

function evalInPage(deps, bridge, js, timeoutSec) {
	const r = bridgeCall(deps, bridge, "POST", "/eval", { js }, timeoutSec || 90);
	if (r.code === 401) return { ok: false, status: "bridge-bad-secret" };
	if (r.code === 0) return { ok: false, status: "bridge-down" };
	if (r.code !== 200 || !r.parsed) return { ok: false, status: "eval-failed", log: String(r.body || "").slice(-600) };
	if (r.parsed.ok !== true) return { ok: false, status: "eval-failed", error: String(r.parsed.error || "").slice(0, 400) };
	return { ok: true, value: r.parsed.value };
}

/** Call one named step of the recipe object inside the page. */
function callStep(deps, bridge, body, step, args, timeoutSec) {
	const js =
		"(async () => { const R = (\n" +
		body +
		"\n); if (typeof R[" +
		JSON.stringify(step) +
		"] !== 'function') return { ok: false, reason: 'no-step-" +
		step +
		"' }; return await R[" +
		JSON.stringify(step) +
		"](" +
		args.map((a) => JSON.stringify(a === undefined ? null : a)).join(", ") +
		") })()";
	return evalInPage(deps, bridge, js, timeoutSec);
}

export function planDigest(parts) {
	return createHash("sha256")
		.update(JSON.stringify(parts))
		.digest("hex")
		.slice(0, 32);
}

/**
 * args: { action: list|plan|commit|capture|log, recipe, params, ticket }
 */
export function runShopWrite(args, deps = {}) {
	const env = deps.env || process.env;
	const fail = (status, extra) => ({ ok: false, status, marker: MARKER, ...(extra || {}) });

	for (const k of RAW_JS_KEYS) {
		if (args && Object.prototype.hasOwnProperty.call(args, k)) {
			return fail("raw-js-refused", {
				hint: "shop_write runs named write actions only. There is no way to pass page JS.",
			});
		}
	}

	const action = String((args && args.action) || "list");
	const root = resolveWriteRoot(env);
	if (!root) return fail("no-write-root", { hint: "plant writes first: scripts/p-shop-mcp/plant-shop-recipes.sh" });

	let manifest;
	try {
		manifest = loadWriteManifest(root);
	} catch (e) {
		return fail("bad-manifest", { root, error: String(e.message || e) });
	}
	const common = { root, authority: rootAuthority(root, env) };

	if (action === "list") {
		const rows = Object.entries(manifest.actions).map(([id, e]) => ({
			id,
			title: e.title || "",
			api: e.api || null,
			params: e.params || {},
			guard: e.guard || null,
			captured: !!readTemplate(id, env),
		}));
		return { ok: true, status: "list", marker: MARKER, ...common, actions: rows };
	}
	if (action === "log") {
		const rows = readAudit(env).slice(-20);
		return { ok: true, status: "log", marker: MARKER, ...common, entries: rows };
	}
	if (!["plan", "commit", "capture"].includes(action)) return fail("unknown-action", common);

	const id = String((args && args.recipe) || "");
	if (!RECIPE_ID_RE.test(id)) return fail("bad-recipe-id", { ...common, id });
	const entry = manifest.actions[id];
	if (entry === undefined) return fail("unknown-action-id", { ...common, id, known: Object.keys(manifest.actions) });
	// Symmetry with the read tool: that one refuses writes:true, this one refuses
	// anything not marked a write, so neither can be talked into the other's job.
	if (entry.writes !== true) return fail("not-a-write-action", { ...common, id });

	let loaded;
	try {
		loaded = readWriteBody(root, entry);
	} catch (e) {
		return fail("bad-recipe-file", { ...common, id, error: String(e.message || e) });
	}

	const bridge = readBridge(env);
	if (!bridge.ok) {
		return fail(bridge.status, {
			...common,
			id,
			path: bridge.path,
			hint: "writes only run in the desk's own hidden view; open TDHarness. carrier=opencli is not offered for writes.",
		});
	}

	const page = ensurePageWebview(deps, bridge, {
		pageUrl: String(entry.page || ""),
		needMtop: !!entry.api,
		exactPage: !!entry.exactPage,
	});
	if (!page.ok) {
		return fail(page.reason, {
			...common,
			id,
			url: page.url || "",
			hint:
				page.reason === "not-logged-in"
					? "open TDHarness menu 店铺登录（后台窗口）and log in once; the agent cannot log in"
					: "check that TDHarness is running",
		});
	}

	// ---- capture: learn the page's own call, once, from a human doing it by hand ----
	if (action === "capture") {
		const r = callStep(deps, bridge, loaded.body, "capture", [], 60);
		if (!r.ok) return fail(r.status, { ...common, id, error: r.error || "", log: r.log || "" });
		const v = r.value || {};
		if (v.ok !== true) {
			// One status for three different problems was a real defect: every
			// failed capture read as "the human did not do it", including the two
			// cases where they did. Each cause now has its own name and its own
			// next step, and whatever the recorder DID see travels with it.
			const reason = String(v.reason || "");
			const byReason = {
				"recorder-absent": {
					status: "capture-no-recorder",
					hint: "this desk's hidden shop view is not the page that was used. Writes only work through TDHarness's own window.",
				},
				"no-edit-call-seen": {
					status: "capture-no-edit-call",
					hint: "the recorder holds no write-looking call. Either the edit happened before this page load (a reload clears the record), or it went out in a way the recorder does not see yet — check `saw`.",
				},
				"only-mtop-supported": {
					status: "capture-not-mtop",
					hint: "the edit was found but it is not an mtop call (the 改库存 drawer is its own origin). Phase 1 replays mtop only; this needs the frame-aimed replay, not another manual edit.",
				},
				"params-unreadable": {
					status: "capture-no-params",
					hint: "the call was seen but carried no readable body. Nothing to replay; do not guess the params.",
				},
			};
			const m = byReason[reason] || { status: "capture-not-seen", hint: "read `reason`" };
			return fail(m.status, {
				...common,
				id,
				reason,
				seen: v.seen,
				// What it actually looked at, so the next move is a decision and
				// not another blind manual edit.
				saw: v.saw || null,
				candidates: v.candidates || null,
				hint: m.hint,
			});
		}
		let tpl;
		try {
			tpl = checkTemplate(entry, v.template);
		} catch (e) {
			return fail("bad-template", { ...common, id, error: String(e.message || e), got: v.template && v.template.api });
		}
		const p = templatePath(id, env);
		mkdirSync(path.dirname(p), { recursive: true });
		writeFileSync(p, JSON.stringify(tpl, null, 1), { mode: 0o600 });
		return { ok: true, status: "captured", marker: MARKER, ...common, id, api: tpl.api, file: p, fields: v.fields || null };
	}

	let params;
	try {
		params = checkWriteParams(entry, validateParams(args && args.params));
	} catch (e) {
		return fail("bad-params", { ...common, id, error: String(e.message || e), want: entry.params || {} });
	}

	let tpl;
	try {
		tpl = checkTemplate(entry, readTemplate(id, env));
	} catch (e) {
		return fail("no-template", {
			...common,
			id,
			error: String(e.message || e),
			hint: "action=capture first: this write replays the page's own call and has not learned it on this desk yet",
		});
	}

	// ---- read the world as it is now ----
	const rd = callStep(deps, bridge, loaded.body, "read", [params, tpl], 90);
	if (!rd.ok) return fail(rd.status, { ...common, id, error: rd.error || "", log: rd.log || "" });
	const before = rd.value || {};
	if (before.ok !== true) {
		return fail("read-failed", { ...common, id, reason: before.reason || "", url: page.url });
	}
	if (typeof before.key !== "string" || !before.key) {
		return fail("read-no-key", { ...common, id, hint: "a write recipe's read() must return a stable key string" });
	}

	try {
		checkGuard(entry, params, before);
	} catch (e) {
		return fail("guard-refused", { ...common, id, error: String(e.message || e), before: before.show || null });
	}

	const digest = planDigest({
		recipe: id,
		script: loaded.sha256,
		api: tpl.api,
		params,
		key: before.key,
	});
	const lines = Array.isArray(before.lines) ? before.lines.map(String).slice(0, 12) : [];
	// An action whose api is not yet pinned in the manifest could be pointed at
	// anything the capture happened to grab. That is a thing for the person to
	// see in the panel, not a thing to decide for them.
	if (!entry.api) lines.push("注意：接口尚未固定，这次要重放的是捕获到的 " + tpl.api + "。确认它就是改库存再批。");
	const title = String(entry.title || id);

	if (action === "plan") {
		const t = bridgeCall(
			deps,
			bridge,
			"POST",
			"/write/new",
			{ recipe: id, title, lines: lines.length ? lines : ["(配方没给出差异说明，别批)"], digest, ttlSec: TICKET_TTL_SEC },
			30,
		);
		if (t.code === 403) {
			return fail("write-not-enabled-on-this-desk", {
				...common,
				id,
				hint: "phase 1 only the owner desk may write. Plant with SHOP_WRITE_OWNER=1 on that Mac.",
			});
		}
		if (t.code !== 200 || !t.parsed || t.parsed.ok !== true) {
			return fail("ticket-failed", { ...common, id, code: t.code, log: String(t.body || "").slice(-300) });
		}
		appendAudit({ atMs: Date.now(), at: new Date().toISOString(), phase: "plan", recipe: id, params, key: before.key, ticket: t.parsed.id, digest }, env);
		return {
			ok: true,
			status: "awaiting-approval",
			marker: MARKER,
			...common,
			id,
			ticket: t.parsed.id,
			ttlSec: t.parsed.ttlSec,
			api: tpl.api,
			before: before.show || null,
			lines,
			// Said in the result, not only in the docs: the model's job here is to
			// stop and tell the person to look at the app.
			next: "TDHarness 弹了确认窗，写的就是上面这几行。你点「同意执行」我再 commit；不点就是不改。",
		};
	}

	// ---- commit ----
	const ticket = String((args && args.ticket) || "");
	if (!/^[0-9a-f]{32}$/.test(ticket)) return fail("need-ticket", { ...common, id, hint: "run action=plan first" });

	try {
		checkRate(entry, manifest, env);
	} catch (e) {
		return fail("rate-limited", { ...common, id, error: String(e.message || e) });
	}

	const st = bridgeCall(deps, bridge, "POST", "/write/state", { id: ticket }, 30);
	const state = st.parsed && st.parsed.ok === true ? String(st.parsed.state || "") : "";
	if (state !== "approved") {
		return fail("not-approved", {
			...common,
			id,
			ticket,
			state: state || (st.parsed && st.parsed.error) || "unknown",
			hint:
				state === "pending"
					? "the confirm window is still open on the desk; nobody has clicked yet"
					: "expired or refused. Do not retry silently — plan again only if the person asks.",
		});
	}

	// The digest was computed from the state read a moment ago, which is also the
	// state the person read. If the shop moved in between, this refuses instead of
	// writing over a change nobody saw.
	const sp = bridgeCall(deps, bridge, "POST", "/write/consume", { id: ticket, digest }, 30);
	if (!sp.parsed || sp.parsed.ok !== true) {
		const err = String((sp.parsed && sp.parsed.error) || "consume-failed");
		return fail(err, {
			...common,
			id,
			ticket,
			hint:
				err === "digest-mismatch"
					? "店铺在批准之后变了（或参数变了），这张批准作废。重新 plan，让人再看一次。"
					: "an approval is single-use",
		});
	}
	const approver = String(sp.parsed.approver || "");

	const ap = callStep(deps, bridge, loaded.body, "apply", [params, tpl, before], 120);
	const applied = ap.ok ? ap.value || {} : null;
	if (!ap.ok || applied.ok !== true) {
		const row = {
			atMs: Date.now(),
			at: new Date().toISOString(),
			phase: "commit",
			recipe: id,
			params,
			ticket,
			approver,
			key: before.key,
			result: "failed",
			reason: (applied && (applied.reason || applied.ret)) || ap.status || "",
		};
		appendAudit(row, env);
		// 风控 looks exactly like this. It is a stop, not a thing to retry.
		const blocked = JSON.stringify(applied || {}).match(/滑块|验证|风控|FAIL_SYS_USER_VALIDATE/);
		return fail(blocked ? "blocked-needs-human" : "apply-failed", {
			...common,
			id,
			ticket,
			approver,
			detail: applied || { error: ap.error || ap.log || "" },
			hint: blocked
				? "淘宝要人过验证。打开 TDHarness 的店铺窗口自己点一次，然后重新 plan。不要重试。"
				: "nothing was retried automatically; read the detail before planning again",
		});
	}

	// Write-then-read. "The call said ok" and "the shop changed" are not the same
	// sentence, and only the second one is worth reporting to the person.
	const ck = callStep(deps, bridge, loaded.body, "check", [params, tpl, before], 90);
	const after = ck.ok ? ck.value || {} : {};
	const verified = after.ok === true && after.matched === true;
	appendAudit(
		{
			atMs: Date.now(),
			at: new Date().toISOString(),
			phase: "commit",
			recipe: id,
			params,
			ticket,
			approver,
			key: before.key,
			result: "applied",
			verified,
			after: after.show || null,
		},
		env,
	);
	return {
		ok: true,
		status: verified ? "applied-and-verified" : "applied-unverified",
		marker: MARKER,
		...common,
		id,
		ticket,
		approver,
		api: tpl.api,
		before: before.show || null,
		after: after.show || null,
		verified,
		hint: verified ? "" : "写调用返回成功，但回读没看到新值。去店铺窗口刷新确认，不要再写一次。",
	};
}
