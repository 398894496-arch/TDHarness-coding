import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const name = "company-edit-pos";
export const inject = ["tools", "webServer"];

function storeDir() {
	const home = process.env.DSH_HOME;
	if (!home) throw new Error("company-edit-pos: DSH_HOME missing");
	return join(home, "edit-pos");
}

function keyOf(path) {
	return createHash("sha256").update(String(path)).digest("hex").slice(0, 16) + ".json";
}

function cleanPath(raw) {
	let path = String(raw || "").trim().replace(/\\/g, "/");
	if (path === "" || path.split("/").includes("..")) return "";
	const cwd = (process.cwd() || "").replace(/\\/g, "/");
	if (cwd !== "" && (path === cwd || path.startsWith(cwd + "/"))) {
		path = path.slice(cwd.length + 1);
	}
	return path;
}

async function writePos(record) {
	const path = cleanPath(record.path);
	if (path === "") return { ok: false, error: "bad-path" };
	const dir = storeDir();
	await mkdir(dir, { recursive: true });
	const body = {
		path,
		line: Number(record.line) || 1,
		ch: Number(record.ch) || 0,
		from: Number(record.from) || 0,
		to: Number(record.to) || 0,
		scrollTop: Number(record.scrollTop) || 0,
		updatedAt: new Date().toISOString(),
		sessionId: typeof record.sessionId === "string" ? record.sessionId : "",
	};
	await writeFile(join(dir, keyOf(path)), JSON.stringify(body) + "\n", "utf8");
	return { ok: true, value: body };
}

async function readPos(path) {
	const clean = cleanPath(path);
	if (clean === "") return { ok: false, error: "bad-path" };
	try {
		const text = await readFile(join(storeDir(), keyOf(clean)), "utf8");
		return { ok: true, value: JSON.parse(text) };
	} catch {
		return { ok: false, error: "missing" };
	}
}

async function listPos() {
	try {
		const dir = storeDir();
		const names = await readdir(dir);
		const rows = [];
		for (const name of names) {
			if (!name.endsWith(".json")) continue;
			try {
				rows.push(JSON.parse(await readFile(join(dir, name), "utf8")));
			} catch {}
		}
		rows.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
		return { ok: true, value: { positions: rows } };
	} catch {
		return { ok: true, value: { positions: [] } };
	}
}

function readJson(req) {
	return new Promise((resolve, reject) => {
		const chunks = [];
		req.on("data", (c) => chunks.push(c));
		req.on("end", () => {
			try {
				resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
			} catch (err) {
				reject(err);
			}
		});
		req.on("error", reject);
	});
}

function writeJson(res, status, body) {
	res.writeHead(status, { "content-type": "application/json" });
	res.end(JSON.stringify(body));
}

export function apply(ctx) {
	try {
	ctx.tools.register({
		name: "edit_pos",
		description:
			"Read where the user last edited a workspace file. Commands: list (every remembered path), read (one path). Use this at the start of a turn when continuing a markdown plan or any file the user edited in the right-hand editor.",
		parameters: {
			type: "object",
			properties: {
				command: { type: "string", enum: ["list", "read"] },
				path: { type: "string" },
			},
			required: ["command"],
		},
		output: {
			schema: { type: "string" },
			render: function (_args, value) {
				return [{ type: "text", text: String(value) }];
			},
		},
		async execute(args) {
			if (args.command === "list") {
				const out = await listPos();
				return JSON.stringify(out.value.positions);
			}
			const out = await readPos(args.path);
			if (!out.ok) return "edit_pos: " + out.error;
			return JSON.stringify(out.value);
		},
	});
	} catch (err) {
		console.error("company-edit-pos: tool register failed", err);
	}

	const skills = ctx.get("skills");
	if (skills !== undefined) {
		skills.register({
			name: "writing-plans",
			description:
				"Write markdown plans as real workspace files under plans/. Save in the right-hand editor. Call edit_pos before continuing a plan. Use the artifact tool only for self-contained HTML (charts, dashboards).",
			source: "runtime",
			content:
				"# Writing plans\n\n- Markdown plans are workspace files under `plans/`. They are real files, not chat text.\n- The user edits them in the right sidebar editor. Save writes the disk file.\n- Before editing a plan the user already touched, call `edit_pos` `read` with that path (or `list`) and continue from that line/selection.\n- Self-contained HTML charts go through the `artifact` tool. After write they open in the right sidebar by themselves. Do not offer a 产物 tab and do not replace the Files tree.",
		});
	}

	const prompt = ctx.get("systemPrompt");
	if (prompt !== undefined) {
		prompt.section({
			name: "edit-pos",
			order: 160,
			text:
				"Markdown plans belong in the workspace under plans/ as real files. HTML charts use the artifact tool and appear in the right sidebar after write. When continuing a file the user edited, call edit_pos first.",
		});
	}

	const web = ctx.get("webServer");
	if (web == null || typeof web.register !== "function") return;

	ctx.effect(() =>
		web.register({
			kind: "exact",
			path: "/company/edit-pos",
			handler: async (req, res) => {
				if (req.method !== "POST") {
					writeJson(res, 405, { ok: false, error: "method" });
					return;
				}
				try {
					const body = await readJson(req);
					const out = await writePos(body || {});
					writeJson(res, out.ok ? 200 : 400, out);
				} catch {
					writeJson(res, 400, { ok: false, error: "bad-json" });
				}
			},
		}),
	);
}
