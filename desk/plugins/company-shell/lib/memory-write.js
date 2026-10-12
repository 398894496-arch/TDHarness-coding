import { existsSync, mkdirSync, writeFileSync, readFileSync, appendFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export const LAYERS = [
	"01-projects",
	"02-methods",
	"03-evidence",
	"04-reviews",
	"05-logs",
	"90-system",
];

const LAYER_SET = new Set(LAYERS);
const SLUG_RE = /^[a-z0-9][a-z0-9._-]{0,80}$/;
const MAX_BYTES = 200 * 1024;

export function findCompanyRoot(cwd, extra) {
	const tryMark = (dir) => {
		if (!dir) return "";
		const n = path.resolve(String(dir));
		if (existsSync(path.join(n, ".company-root"))) return n;
		return "";
	};
	let cur = path.resolve(cwd || process.cwd());
	for (let i = 0; i < 10; i++) {
		const hit = tryMark(cur);
		if (hit) return hit;
		const parent = path.dirname(cur);
		if (parent === cur) break;
		cur = parent;
	}
	const candidates = [
		process.env.COMPANY_ROOT,
		extra,
		path.join(os.homedir(), "company"),
		"D:/dsh/company",
	];
	for (const c of candidates) {
		const hit = tryMark(c);
		if (hit) return hit;
	}
	return "";
}

export function personalRel(role, loginName) {
	const name = String(loginName || "").trim();
	if (role === "admin" || name === "boss") return "_office";
	if (name) return path.join("content", "emp-" + name.replace(/[^A-Za-z0-9._-]/g, ""));
	return "_office";
}

function canWriteShared(role) {
	return role === "admin" || role === "director";
}

function asciiSlug(name) {
	let s = String(name || "").trim().toLowerCase();
	if (s.endsWith(".md")) s = s.slice(0, -3);
	s = s.replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
	if (!SLUG_RE.test(s)) return "";
	return s;
}

export function resolveTarget(opts) {
	const role = String(opts.role || "employee");
	const zone = String(opts.zone || "personal");
	const layer = String(opts.layer || "");
	const mode = String(opts.mode || "replace");
	const root = opts.companyRoot || findCompanyRoot(opts.cwd, opts.extraRoot);
	if (!root) return { ok: false, status: "no-company-root" };
	if (zone !== "personal" && zone !== "shared") return { ok: false, status: "bad-zone" };
	if (zone === "shared" && !canWriteShared(role)) {
		return { ok: false, status: "shared-denied", role };
	}
	if (!LAYER_SET.has(layer)) return { ok: false, status: "bad-layer" };
	if (mode !== "replace" && mode !== "append") return { ok: false, status: "bad-mode" };
	const slug = asciiSlug(opts.name);
	if (!slug) return { ok: false, status: "bad-name" };
	const zoneRel = zone === "shared" ? path.join("_shared", "_memory") : path.join(personalRel(role, opts.loginName), "_memory");
	const abs = path.resolve(root, zoneRel, layer, slug + ".md");
	const zoneRoot = path.resolve(root, zoneRel);
	const rel = path.relative(zoneRoot, abs);
	if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) {
		return { ok: false, status: "path-escape" };
	}
	return {
		ok: true,
		status: "ok",
		abs,
		zoneRoot,
		rel: path.join(layer, slug + ".md").replace(/\\/g, "/"),
		zone,
		layer,
		slug,
		mode,
		role,
		root,
	};
}

function wrapContent(opts, target) {
	let body = String(opts.content || "");
	if (Buffer.byteLength(body, "utf8") > MAX_BYTES) {
		return { ok: false, status: "too-large" };
	}
	if (target.mode === "append") return { ok: true, body };
	if (/^---\s*\n/.test(body)) return { ok: true, body };
	const now = new Date().toISOString().slice(0, 10);
	const title = String(opts.title || target.slug);
	const head = [
		"---",
		"title: " + title,
		"status: active",
		"confidence: confirmed",
		"source_ref: desk",
		"verified_at: " + now,
		"---",
		"",
		"# " + title,
		"",
	].join("\n");
	return { ok: true, body: head + body.replace(/^\uFEFF/, "") };
}

export function writeMemory(opts) {
	const target = resolveTarget(opts);
	if (!target.ok) return target;
	const packed = wrapContent(opts, target);
	if (!packed.ok) return packed;
	mkdirSync(path.dirname(target.abs), { recursive: true });
	// Direct write. Official write uses link/rename and ENOTSUP on smbfs.
	if (target.mode === "append") {
		let extra = packed.body;
		if (extra && !extra.endsWith("\n")) extra += "\n";
		if (existsSync(target.abs)) {
			const prev = readFileSync(target.abs, "utf8");
			if (prev && !prev.endsWith("\n")) appendFileSync(target.abs, "\n");
			appendFileSync(target.abs, extra);
		} else {
			writeFileSync(target.abs, extra, "utf8");
		}
	} else {
		writeFileSync(target.abs, packed.body.endsWith("\n") ? packed.body : packed.body + "\n", "utf8");
	}
	return {
		ok: true,
		status: "written",
		zone: target.zone,
		path: target.rel,
		abs: target.abs,
		mode: target.mode,
		bytes: Buffer.byteLength(packed.body, "utf8"),
	};
}
