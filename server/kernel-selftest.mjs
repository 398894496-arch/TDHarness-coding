#!/usr/bin/env node
// Boot one DSH kernel prefix against a copy of a desk's home and check that the
// desk would work on it, before anyone is switched to it.
//
//   node kernel-selftest.mjs --prefix <kernel prefix> --home <desk DSH_HOME> [--node <node.exe>] [--report <file>]
//
// To try something by hand on the same throwaway copy (it never sees the real
// conversations), keep it running for a while:
//   --hold <seconds> [--port <n>] [--key-file <gateway token file>] [--set-context <model>=<tokens>] [--hold-log <file>]
// --set-context declares a smaller context size for one model in the copy, so
// that automatic compaction can be watched happening in a short conversation.
// When the hold ends, COMPACTION_RECORDS= says how many compaction events the
// copy's conversations recorded.
//
// What "works" means here:
//   1. the composed configuration validates (--dump-config);
//   2. the kernel starts and serves its page;
//   3. every plugin the profile enables reaches the active phase;
//   4. the company shell answers (/company/me).
//
// The desk's sessions, storages and attachments are never touched: the home is
// copied without them into a throwaway folder, and any session/storage root the
// overlay points elsewhere is pointed into that folder too. The copy and the
// process are removed at the end. Prints SELFTEST_OK=1 or SELFTEST_FAIL=<why>.
import { spawn, spawnSync } from "node:child_process";
import { appendFileSync, cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import zlib from "node:zlib";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";

const args = {};
for (let i = 2; i < process.argv.length; i += 2) args[process.argv[i].replace(/^--/, "")] = process.argv[i + 1];
const prefix = args.prefix;
const home = args.home;
const node = args.node || process.execPath;
const BOOT_MS = Number(args["boot-ms"] || 120000);
// The shell must be active; other company plugins are checked with everything else.
const MUST = ["company-shell"];
// The same preload the Windows desk starts its kernel with: fs.symlink becomes
// a directory junction.
const JUNCTION_SHIM = `"use strict";
var fs = require("fs");
var path = require("path");
var spawnSync = require("child_process").spawnSync;
function winJunction(link, target) {
  try { fs.mkdirSync(path.dirname(link), { recursive: true }); } catch (e) {}
  try {
    var st = fs.lstatSync(link);
    if (st.isSymbolicLink() || st.isFile()) fs.unlinkSync(link);
    else if (st.isDirectory()) fs.rmSync(link, { recursive: true, force: true });
  } catch (e) {}
  var r = spawnSync("cmd.exe", ["/c", "mklink", "/J", link, target], { encoding: "utf8", windowsHide: true, cwd: process.env.SystemRoot || "C:\\\\Windows" });
  if (r.status === 0) return;
  var err = new Error("dsh: win-junction-failed " + link + " -> " + target);
  err.code = "EPERM";
  throw err;
}
fs.symlinkSync = function (target, link) { winJunction(link, target); };
if (fs.promises) fs.promises.symlink = async function (target, link) { winJunction(link, target); };
`;
// Folders that hold people's work, never copied into the sandbox.
const SKIP = new Set(["sessions", "storages", "attachments", "artifacts", "trash", "logs"]);

function binOf(dir) {
	for (const p of [
		path.join(dir, "lib", "node_modules", "@deepseek-ai", "dsh", "lib", "bin.js"),
		path.join(dir, "node_modules", "@deepseek-ai", "dsh", "lib", "bin.js"),
	]) if (existsSync(p)) return p;
	return "";
}

function versionOf(dir) {
	for (const p of [
		path.join(dir, "lib", "node_modules", "@deepseek-ai", "dsh", "package.json"),
		path.join(dir, "node_modules", "@deepseek-ai", "dsh", "package.json"),
	]) {
		try { return JSON.parse(readFileSync(p, "utf8")).version || ""; } catch { /* next */ }
	}
	return "";
}

function freePort() {
	return new Promise((resolve, reject) => {
		const s = net.createServer();
		s.listen(0, "127.0.0.1", () => {
			const port = s.address().port;
			s.close(() => resolve(port));
		});
		s.on("error", reject);
	});
}

function request(port, method, url, body) {
	return new Promise((resolve) => {
		const raw = body ? Buffer.from(JSON.stringify(body)) : null;
		const req = http.request({
			hostname: "127.0.0.1", port, path: url, method,
			headers: raw ? { "content-type": "application/json", "content-length": raw.length } : {},
			timeout: 20000,
		}, (res) => {
			const chunks = [];
			res.on("data", (c) => chunks.push(c));
			res.on("end", () => resolve({ status: res.statusCode || 0, text: Buffer.concat(chunks).toString("utf8") }));
		});
		req.on("error", () => resolve({ status: 0, text: "" }));
		req.on("timeout", () => { req.destroy(); resolve({ status: 0, text: "" }); });
		if (raw) req.end(raw); else req.end();
	});
}

function killTree(child) {
	if (!child || child.exitCode !== null) return;
	if (process.platform === "win32") spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
	else { try { process.kill(-child.pid, "SIGKILL"); } catch { try { child.kill("SIGKILL"); } catch { /* gone */ } } }
}

// Copy the desk home without people's work, and point any session / storage
// root the overlay names into the sandbox.
//
// profiles/node_modules is left out: the kernel links its own packages there
// when it starts, so the copy would point at the kernel the desk runs now
// instead of the one under test. Links anywhere else are copied as what they
// point at, because creating a link needs a right an ordinary Windows account
// does not have.
function sandboxHome(src, dest) {
	const kernelLinks = path.join(src, "profiles", "node_modules");
	for (const name of readdirSync(src)) {
		if (SKIP.has(name) || name.startsWith("._")) continue;
		cpSync(path.join(src, name), path.join(dest, name), {
			recursive: true,
			dereference: true,
			filter: (p) => !path.basename(p).startsWith("._") && path.resolve(p) !== path.resolve(kernelLinks),
		});
	}
	const overlay = path.join(dest, "profiles", "web", "overlay.yml");
	if (existsSync(overlay)) {
		const fwd = dest.replace(/\\/g, "/");
		const text = readFileSync(overlay, "utf8")
			.replace(/^(\s*root:\s*)["']?[^"'\r\n]*sessions["']?\s*$/gm, `$1"${fwd}/sessions"`)
			.replace(/^(\s*root:\s*)["']?[^"'\r\n]*storages["']?\s*$/gm, `$1"${fwd}/storages"`);
		writeFileSync(overlay, text);
	}
	return overlay;
}

// How many compaction events the conversations under `dir` hold. A session
// file is a run of compressed frames, one per append.
function compactionRecords(dir) {
	let n = 0;
	const walk = (d) => {
		let names = [];
		try { names = readdirSync(d); } catch { return; }
		for (const name of names) {
			const p = path.join(d, name);
			let st;
			try { st = statSync(p); } catch { continue; }
			if (st.isDirectory()) walk(p);
			else if (/\.jsonl\.zstd$/.test(name)) {
				try {
					const buf = readFileSync(p);
					let at = 0;
					while (at < buf.length) {
						const r = zlib.zstdDecompressSync(buf.subarray(at), { info: true });
						n += (r.buffer.toString("utf8").match(/"type":"compaction\/summary"/g) || []).length;
						if (!r.engine || !r.engine.bytesWritten) break;
						at += r.engine.bytesWritten;
					}
				} catch { /* a file being written is read next time */ }
			}
		}
	};
	walk(dir);
	return n;
}

async function main() {
	const fails = [];
	const report = { prefix, version: "", checks: {} };
	const bin = prefix ? binOf(prefix) : "";
	if (!bin) return finish(["prefix-missing"], report);
	if (!home || !existsSync(path.join(home, "profiles", "web", "overlay.yml"))) return finish(["home-missing"], report);
	report.version = versionOf(prefix);

	const box = mkdtempSync(path.join(os.tmpdir(), "tdh-selftest-"));
	let child = null;
	try {
		const overlay = sandboxHome(home, box);
		if (args["set-context"]) {
			// only in the copy: one model is declared smaller than it is
			const [model, size] = String(args["set-context"]).split("=");
			const patch = path.join(box, "profiles", "web", "cordis.patch.yml");
			if (existsSync(patch) && model && Number(size) > 0) {
				const lines = readFileSync(patch, "utf8").split(/\r?\n/);
				let inModel = false;
				for (let i = 0; i < lines.length; i++) {
					const m = /^\s*-\s*id:\s*(\S+)\s*$/.exec(lines[i]);
					if (m) inModel = m[1] === model;
					else if (inModel && /^\s*contextWindow:/.test(lines[i])) lines[i] = lines[i].replace(/contextWindow:.*/, "contextWindow: " + Number(size));
				}
				writeFileSync(patch, lines.join("\n"));
			}
		}
		// Start the kernel the way the Windows desk does: its links become
		// directory junctions, which an ordinary account may create.
		const preload = [];
		if (process.platform === "win32") {
			const shim = path.join(box, "junction-shim.cjs");
			writeFileSync(shim, JUNCTION_SHIM);
			preload.push("--require", shim);
		}
		let key = "selftest";
		if (args["key-file"] && existsSync(args["key-file"])) key = readFileSync(args["key-file"], "utf8").trim() || key;
		const env = { ...process.env, DSH_HOME: box, GROK_API_KEY: key, NO_PROXY: "*", NODE_USE_ENV_PROXY: "0", DSH_PERMISSION_MODE: "workspace-write" };
		delete env.DEEPSEEK_API_KEY;

		// 1. configuration
		const dump = spawnSync(node, [...preload, bin, "--profile", "web", "--patch", overlay, "--dump-config"], { env, cwd: box, encoding: "utf8", timeout: 120000 });
		const dumpText = String(dump.stdout || "") + String(dump.stderr || "");
		const bad = dumpText.split(/\r?\n/).filter((l) => /ValidationError|invalid config|did not activate/i.test(l));
		report.checks.config = bad.length ? bad.slice(0, 5) : "ok";
		if (dump.status !== 0 || bad.length) fails.push("config");

		// 2. boot
		const port = Number(args.port) || await freePort();
		const log = [];
		child = spawn(node, [...preload, bin, "--profile", "web", "--patch", overlay, "--host", "127.0.0.1", "--port", String(port), "--no-open", "--trusted-host", "127.0.0.1"], {
			env, cwd: box, detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
		});
		const up = await new Promise((resolve) => {
			const timer = setTimeout(() => resolve(false), BOOT_MS);
			const seen = (c) => {
				const t = String(c);
				log.push(t);
				// while held for a look by hand, what the kernel says is kept where it can be read
				if (args["hold-log"]) { try { appendFileSync(args["hold-log"], t); } catch { /* the log is a convenience */ } }
				if (/dsh web: http/.test(t)) { clearTimeout(timer); resolve(true); }
			};
			child.stdout.on("data", seen);
			child.stderr.on("data", seen);
			child.on("exit", () => { clearTimeout(timer); resolve(false); });
		});
		report.checks.boot = up ? "ok" : log.join("").slice(-1500);
		if (!up) {
			fails.push("boot");
		} else {
			const page = await request(port, "GET", "/");
			report.checks.page = page.status;
			if (page.status !== 200) fails.push("page");

			// 3. plugins
			const list = await request(port, "POST", "/api/pluginManager/listPlugins", {
				type: "client-request", rpcId: "selftest", method: "pluginManager/listPlugins", payload: { args: {} },
			});
			let rows = null;
			try { rows = JSON.parse(list.text).result.value; } catch { rows = null; }
			if (!Array.isArray(rows)) {
				report.checks.plugins = "list-unavailable " + list.status;
				fails.push("plugins");
			} else {
				const stuck = rows.filter((r) => r.enabled && r.fiberPhase !== "active").map((r) => r.moduleName + ":" + r.fiberPhase);
				const missing = MUST.filter((m) => !rows.some((r) => r.moduleName === m && r.enabled && r.fiberPhase === "active"));
				report.checks.plugins = { active: rows.filter((r) => r.fiberPhase === "active").length, stuck, missing };
				if (stuck.length || missing.length) fails.push("plugins");
			}

			// 4. company shell
			const me = await request(port, "GET", "/company/me");
			let meOk = false;
			try { meOk = JSON.parse(me.text).ok === true; } catch { meOk = false; }
			report.checks.shell = { me: me.status, meOk };
			if (!meOk) fails.push("shell");
			if (Number(args.hold) > 0) {
				process.stdout.write("SELFTEST_HOLD port=" + port + " seconds=" + Number(args.hold) + "\n");
				await new Promise((r) => setTimeout(r, Number(args.hold) * 1000));
				report.checks.compactionRecords = compactionRecords(box);
				process.stdout.write("COMPACTION_RECORDS=" + report.checks.compactionRecords + "\n");
			}
		}
	} finally {
		killTree(child);
		await new Promise((r) => setTimeout(r, 800));
		try { rmSync(box, { recursive: true, force: true }); } catch { /* left for the OS temp cleaner */ }
	}
	return finish(fails, report);
}

function finish(fails, report) {
	report.ok = fails.length === 0;
	report.fails = fails;
	if (args.report) {
		try { writeFileSync(args.report, JSON.stringify(report, null, 2)); } catch { /* report is optional */ }
	}
	process.stdout.write("SELFTEST_VERSION=" + (report.version || "?") + "\n");
	process.stdout.write(JSON.stringify(report.checks) + "\n");
	process.stdout.write(fails.length ? "SELFTEST_FAIL=" + fails.join(",") + "\n" : "SELFTEST_OK=1\n");
	process.exitCode = fails.length ? 1 : 0;
}

main().catch((err) => finish(["crash:" + String(err && err.message || err)], { checks: {} }));
