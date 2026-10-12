import { spawn, spawnSync } from "node:child_process";
import { existsSync, openSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import https from "node:https";
import os from "node:os";
import path from "node:path";

const NPM_URL = "https://registry.npmjs.org/@deepseek-ai/dsh";
const GH_URL = "https://api.github.com/repos/deepseek-ai/deepseek-harness/releases?per_page=15";
const FRESH_MS = 45000;

function rcDir() {
	return process.env.DSH_COMPANY_RC || path.join(os.homedir(), ".dsh-company-rc8");
}

function statePath() {
	return path.join(rcDir(), "kernel-watch.json");
}

function readJson(p) {
	try {
		return JSON.parse(readFileSync(p, "utf8"));
	} catch {
		return null;
	}
}

function pinYmlPaths() {
	return [
		process.env.DSH_KERNEL_YML,
		path.join("D:", "dsh", "runtime", "dsh-kernel.yml"),
		path.join(os.homedir(), "dsh-kernel.yml"),
		path.join(maintainerRepo(), "scripts", "p-product-base", "dsh-kernel.yml"),
	].filter(Boolean);
}

function pinFromYml() {
	for (const yml of pinYmlPaths()) {
		try {
			const text = readFileSync(yml, "utf8");
			const id = text.match(/^id:\s*(\S+)\s*$/m);
			const candidate = text.match(/^candidate:\s*(\S+)\s*$/m);
			const rollback = text.match(/^rollback_id:\s*(\S+)\s*$/m);
			if (!id) continue;
			return {
				pin: id[1],
				candidate: candidate ? candidate[1] : "",
				rollback: rollback ? rollback[1] : "",
			};
		} catch {
			/* next */
		}
	}
	return { pin: "", candidate: "", rollback: "" };
}

function lanSite() {
	return process.platform === "win32" && existsSync(path.join("D:", "dsh", "site.yml"));
}

function pkgVer(p) {
	const meta = readJson(p);
	return meta && meta.version ? String(meta.version) : "";
}

function liveKernelVersion() {
	const files = [];
	if (process.platform === "win32") {
		try {
			for (const name of readdirSync("C:/Users")) {
				files.push(path.join("C:/Users", name, "TDH", "CompanyDesk", "prefix", "node_modules", "@deepseek-ai", "dsh", "package.json"));
				files.push(path.join("C:/Users", name, "TDH", "CompanyDesk", "prefix", "lib", "node_modules", "@deepseek-ai", "dsh", "package.json"));
			}
		} catch {
			/* */
		}
	} else {
		const home = os.homedir();
		files.push(path.join(home, "dsh-kernel", "0-1-7-rc-2", "lib", "node_modules", "@deepseek-ai", "dsh", "package.json"));
	}
	for (const f of files) {
		const v = pkgVer(f);
		if (v) return v;
	}
	return "";
}

function localPrefixes() {
	const out = [];
	const roots = [path.join(os.homedir(), "dsh-kernel")];
	if (process.platform === "win32") roots.push(path.join("D:", "dsh", "runtime"));
	for (const root of roots) {
		let names = [];
		try {
			names = readdirSync(root);
		} catch {
			continue;
		}
		for (const name of names) {
			if (name.indexOf("dsh-") !== 0 && !/^\d/.test(name)) continue;
			const pkgs = [
				path.join(root, name, "lib/node_modules/@deepseek-ai/dsh/package.json"),
				path.join(root, name, "node_modules/@deepseek-ai/dsh/package.json"),
			];
			for (const pkg of pkgs) {
				const meta = readJson(pkg);
				if (!meta || !meta.version) continue;
				out.push({ dir: name, version: String(meta.version) });
				break;
			}
		}
	}
	return out;
}

function httpsJson(url) {
	return new Promise((resolve) => {
		const req = https.get(url, {
			headers: { "user-agent": "dsh-company-kernel-watch", accept: "application/vnd.github+json, application/json" },
			timeout: 8000,
		}, (res) => {
			const chunks = [];
			res.on("data", (c) => chunks.push(c));
			res.on("end", () => {
				try {
					resolve({ status: res.statusCode || 0, json: JSON.parse(Buffer.concat(chunks).toString("utf8")) });
				} catch {
					resolve({ status: res.statusCode || 0, json: null });
				}
			});
		});
		req.on("timeout", () => {
			req.destroy();
			resolve({ status: 0, json: null });
		});
		req.on("error", () => resolve({ status: 0, json: null }));
	});
}

function loadState() {
	return readJson(statePath()) || {};
}

function saveState(st) {
	writeFileSync(statePath(), JSON.stringify(st, null, 2));
}

function tagVer(tag) {
	return String(tag || "").replace(/^dsh-v/, "");
}

function verKey(v) {
	const m = String(v || "").match(/^(\d+)\.(\d+)\.(\d+)(?:-([A-Za-z]+)\.?(\d+)?)?/);
	if (!m) return [0, 0, 0, 0, 0];
	const rank = { alpha: 1, beta: 2, rc: 3 };
	return [Number(m[1]), Number(m[2]), Number(m[3]), m[4] ? (rank[m[4]] || 0) : 9, m[5] ? Number(m[5]) : (m[4] ? 0 : 0)];
}

function newerThan(a, b) {
	const pa = verKey(a);
	const pb = verKey(b);
	for (let i = 0; i < pa.length; i++) {
		if (pa[i] !== pb[i]) return pa[i] > pb[i];
	}
	return false;
}

function fmtSize(n) {
	const num = Number(n || 0);
	if (!num) return "—";
	if (num < 1048576) return (num / 1024).toFixed(0) + " KB";
	return (num / 1048576).toFixed(1) + " MB";
}

export async function kernelWatchSnapshot(force) {
	const pin = pinFromYml();
	let st = loadState();
	const age = Date.now() - Number(st.checkedAt || 0);
	if (force || !st.checkedAt || age > FRESH_MS) {
		const [npmHit, ghHit] = await Promise.all([httpsJson(NPM_URL), httpsJson(GH_URL)]);
		const doc = npmHit.json || {};
		const versions = doc.versions || {};
		const dist = {};
		for (const ver of Object.keys(versions)) {
			const d = versions[ver] && versions[ver].dist;
			if (!d) continue;
			dist[ver] = {
				sha: String(d.shasum || "").slice(0, 12),
				size: Number(d.unpackedSize || d.size || 0),
			};
		}
		const releases = Array.isArray(ghHit.json) ? ghHit.json.map((r) => ({
			tag: String(r.tag_name || ""),
			version: tagVer(r.tag_name),
			at: String(r.published_at || ""),
		})) : (st.releases || []);
		st = {
			...st,
			checkedAt: Date.now(),
			npm: doc["dist-tags"] && doc["dist-tags"].latest ? String(doc["dist-tags"].latest) : (st.npm || ""),
			npmStatus: npmHit.status,
			dist,
			releases,
			githubTag: releases[0] ? releases[0].tag : (st.githubTag || ""),
			githubAt: releases[0] ? releases[0].at : (st.githubAt || ""),
			githubStatus: ghHit.status,
		};
		saveState(st);
	}
	let plug = st.plug || null;
	if (plug && plug.running && plug.pid) {
		let alive = true;
		try {
			process.kill(plug.pid, 0);
		} catch {
			alive = false;
		}
		if (!alive) {
			const log = plug.log && existsSync(plug.log) ? readFileSync(plug.log, "utf8") : "";
			const failLine = !log.trim() ? "no-output" : (log.match(/SELFTEST_FAIL=[^\r\n]*/) || log.match(/(?:selftest-failed|npm-install-failed|kernel-patch-failed|strip-failed|dsh-version[^\r\n]*|node-missing|npm-missing|patch-js-missing|desk-missing|runner-missing)/) || [""])[0];
			plug = {
				...plug,
				running: false,
				ok: log.indexOf("KERNEL_PLUG_OK=1") >= 0,
				why: failLine,
				finishedAt: Date.now(),
			};
			const upgrade = st.upgrade && st.upgrade.version === plug.version ? st.upgrade : null;
			saveState({ ...st, plug, upgrade });
			if (upgrade && upgrade.phase === "plug" && plug.ok) {
				const hit = kernelWatchCutover(plug.version);
				saveState({
					...loadState(),
					upgrade: { version: plug.version, phase: hit.ok ? "planted" : "plant-failed", error: hit.error || "" },
				});
			}
		}
	}
	const dist = st.dist || {};
	const npmNames = {};
	for (const name of Object.keys(dist)) npmNames[name] = 1;
	const stored = localPrefixes().map((row) => {
		const meta = dist[row.version] || {};
		return {
			version: row.version,
			dir: row.dir,
			sha: meta.sha || "—",
			size: fmtSize(meta.size),
			onNpm: !!npmNames[row.version],
		};
	});
	const found = (st.releases || []).filter((r) => r.version && pin.pin && newerThan(r.version, pin.pin)).map((r) => ({
		version: r.version,
		tag: r.tag,
		at: r.at,
		onNpm: !!npmNames[r.version],
	}));
	const live = liveKernelVersion();
	let cutover = st.cutover || null;
	if (cutover && cutover.log && existsSync(cutover.log)) {
		const text = readFileSync(cutover.log, "utf8");
		const done = text.indexOf("KERNEL_CUTOVER_OK=1") >= 0;
		const reverted = text.indexOf("KERNEL_CUTOVER_REVERTED=") >= 0;
		cutover = { ...cutover, done, reverted, why: (text.match(/SELFTEST_FAIL=[^\r\n]*/) || text.match(/cutover-failed[^\r\n]*/) || [""])[0] };
	}
	return {
		ok: true,
		pin: pin.pin || live,
		live: live || pin.pin,
		lan: lanSite(),
		tag: (pin.pin || live) ? "dsh-v" + (pin.pin || live) : "",
		candidate: pin.candidate,
		rollback: pin.rollback,
		npm: st.npm || "",
		githubTag: st.githubTag || "",
		githubAt: st.githubAt || "",
		checkedAt: st.checkedAt || 0,
		stored,
		found,
		plug,
		cutover,
		publish: lanSite() ? null : publishState(st),
		behindNpm: !!(pin.pin && st.npm && pin.pin !== st.npm),
		note: lanSite() ? "升级只换这台局域网服务器和本机 8443 下载包。" : "一键升级只换这台。发版才上 8443，员工下次打开才换。",
	};
}

function publishState(st) {
	const pub = st.publish || null;
	if (!pub) return null;
	if (pub.running && pub.pid) {
		let alive = true;
		try { process.kill(pub.pid, 0); } catch { alive = false; }
		if (!alive) {
			const log = pub.log && existsSync(pub.log) ? readFileSync(pub.log, "utf8") : "";
			const done = {
				...pub,
				running: false,
				ok: log.indexOf("PUBLISH_DESK_OK=1") >= 0,
				finishedAt: Date.now(),
				tail: log.slice(-500),
			};
			saveState({ ...loadState(), publish: done });
			return done;
		}
	}
	let tail = "";
	if (pub.log && existsSync(pub.log)) {
		const log = readFileSync(pub.log, "utf8");
		tail = log.slice(-500);
	}
	return { ...pub, tail };
}

const VER = /^[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.]+)?$/;

// A detached PowerShell 5.1 exits at once without running anything, and an
// attached one dies with the desk's kernel, which a kernel switch stops. So a
// detached node runs the script and PowerShell is attached to that node.
function winRunner() {
	return path.join("D:", "dsh", "runtime", "ps-runner.mjs");
}

function runDetachedPs(script, args, log) {
	const runner = winRunner();
	if (!existsSync(runner)) return { ok: false, error: "runner-missing" };
	writeFileSync(log, "");
	const child = spawn(process.execPath, [runner, log, script, ...args], {
		detached: true,
		stdio: "ignore",
		windowsHide: true,
	});
	child.unref();
	return { ok: true, pid: child.pid };
}

// On a Mac the kernel and the office packages are built from the maintainer's own checkout
// (its scripts/p-product-base and scripts/p-client-app), named by TDH_MAINTAINER_REPO. Without
// it those three buttons answer "script missing"; a Windows server uses D:\\dsh\\runtime.
function maintainerRepo() {
	return String(process.env.TDH_MAINTAINER_REPO || "").trim() || path.join(os.tmpdir(), "tdh-no-maintainer-repo");
}

export function kernelWatchPlug(version) {
	const want = String(version || "").trim();
	if (!VER.test(want)) return { ok: false, error: "bad-version" };
	const st = loadState();
	if (st.plug && st.plug.running) return { ok: false, error: "plug-busy", plug: st.plug };
	const log = path.join(rcDir(), "kernel-plug.log");
	if (process.platform === "win32") {
		const script = path.join("D:", "dsh", "runtime", "win-kernel-plug-lan.ps1");
		if (!existsSync(script)) return { ok: false, error: "plug-script-missing" };
		const run = runDetachedPs(script, ["-Want", want], log);
		if (!run.ok) return run;
		const plug = { running: true, version: want, pid: run.pid, startedAt: Date.now(), log };
		saveState({ ...st, plug });
		return { ok: true, plug };
	}
	const logFd = openSync(log, "w");
	let child;
	{
		const root = maintainerRepo();
		const script = path.join(root, "scripts/p-product-base/kernel-plug.sh");
		if (!existsSync(script)) return { ok: false, error: "plug-script-missing" };
		child = spawn("bash", [script, want], {
			cwd: root,
			detached: true,
			stdio: ["ignore", logFd, logFd],
		});
	}
	child.unref();
	const plug = { running: true, version: want, pid: child.pid, startedAt: Date.now(), log };
	saveState({ ...st, plug });
	return { ok: true, plug };
}

function prefixFor(version) {
	const safe = String(version).replace(/[./]/g, "-");
	if (process.platform === "win32") return path.join("D:", "dsh", "runtime", "dsh-" + safe);
	return path.join(os.homedir(), "dsh-kernel", safe);
}

function prefixVersion(prefix) {
	for (const rel of [["node_modules"], ["lib", "node_modules"]]) {
		try {
			return JSON.parse(readFileSync(path.join(prefix, ...rel, "@deepseek-ai", "dsh", "package.json"), "utf8")).version || "";
		} catch {
			/* next layout */
		}
	}
	return "";
}

function dshBin(prefix) {
	const bins = [
		path.join(prefix, "dsh.cmd"),
		path.join(prefix, "bin", "dsh.cmd"),
		path.join(prefix, "bin", "dsh"),
	];
	for (const b of bins) {
		if (existsSync(b)) return b;
	}
	return "";
}

function writePin(version, rollback) {
	const hit = pinYmlPaths().find((p) => existsSync(p)) || path.join("D:", "dsh", "runtime", "dsh-kernel.yml");
	let text = "";
	try {
		text = readFileSync(hit, "utf8");
	} catch {
		text = "id: " + version + "\npackage: \"@deepseek-ai/dsh\"\ncandidate: " + version + "\nrollback_id: \nrollback_prefix: \n";
	}
	if (!/^id:/m.test(text)) text = "id: " + version + "\n" + text;
	text = text.replace(/^id:\s*\S+\s*$/m, "id: " + version);
	if (/^candidate:/m.test(text)) text = text.replace(/^candidate:\s*\S+\s*$/m, "candidate: " + version);
	else text += "candidate: " + version + "\n";
	if (rollback && rollback.version && rollback.version !== version) {
		if (/^rollback_id:/m.test(text)) text = text.replace(/^rollback_id:\s*\S+\s*$/m, "rollback_id: " + rollback.version);
		else text += "rollback_id: " + rollback.version + "\n";
		if (/^rollback_prefix:/m.test(text)) text = text.replace(/^rollback_prefix:\s*\S+\s*$/m, "rollback_prefix: " + rollback.prefix);
		else text += "rollback_prefix: " + rollback.prefix + "\n";
	}
	writeFileSync(hit, text);
}

export function kernelWatchCutover(version) {
	const want = String(version || "").trim();
	if (!VER.test(want)) return { ok: false, error: "bad-version" };
	const prefix = prefixFor(want);
	const bin = dshBin(prefix);
	if (!bin) return { ok: false, error: "prefix-missing", prefix };
	// Read the version from the package rather than running `dsh --version`:
	// that launcher calls whatever "node" is on PATH, and the desk ships its
	// own node, so on a desk machine the command fails and the switch was
	// refused although the kernel was fine.
	const got = prefixVersion(prefix);
	if (got !== want) return { ok: false, error: "version-mismatch", got };
	const pin = pinFromYml();
	const prev = pin.pin && pin.pin !== want ? { version: pin.pin, prefix: prefixFor(pin.pin) } : null;
	// The record changes only after the switch held: a switch whose self-test
	// fails puts the previous kernel back, and the record must keep naming it.
	if (process.platform === "win32") {
		// The switch stops this kernel, so it runs on its own and records the
		// result itself (the version record and kernel-cutover.log); the next
		// desk start reads that log.
		const script = path.join("D:", "dsh", "runtime", "win-kernel-cutover-lan.ps1");
		if (!existsSync(script)) return { ok: false, error: "cutover-script-missing" };
		const log = path.join(rcDir(), "kernel-cutover.log");
		const run = runDetachedPs(script, ["-Want", want], log);
		if (!run.ok) return run;
		saveState({ ...loadState(), cutover: { version: want, from: pin.pin || "", log, startedAt: Date.now() } });
		return { ok: true, phase: "switching", version: want, next: "正在换成 " + want + "：TDHarness 会自动关闭，换好并试启动通过后再打开就是新版；没通过会自动换回 " + (pin.pin || "原版本") + "。" };
	}
	const root = maintainerRepo();
	const script = path.join(root, "scripts/p-product-base/plant-mac-kernel.sh");
	const planted = spawnSync("bash", [script], { cwd: root, encoding: "utf8", timeout: 180000 });
	const out = String(planted.stdout || "") + String(planted.stderr || "");
	if (planted.status !== 0 || out.indexOf("MAC_KERNEL_PLANT_OK=1") < 0) {
		return { ok: false, error: "plant-failed", log: out.slice(-800) };
	}
	writePin(want, prev);
	return { ok: true, version: want, rollback: prev ? prev.version : pin.rollback, next: "关掉 TDHarness 再打开，这台才会换成 " + want };
}

export async function kernelWatchUpgrade(version) {
	const snap = await kernelWatchSnapshot(true);
	const asked = String(version || "").trim();
	let target = "";
	if (VER.test(asked) && asked !== snap.pin) {
		const known = (snap.found || []).some((row) => row.version === asked) || snap.npm === asked;
		if (!known) return { ok: false, error: "not-on-npm", version: asked };
		target = asked;
	}
	if (!target) {
		const onNpm = (snap.found || []).filter((row) => row.onNpm && row.version && row.version !== snap.pin);
		target = onNpm.length ? onNpm[0].version : (snap.behindNpm ? snap.npm : "");
	}
	if (!target) return { ok: false, error: "already-current" };
	const bin = dshBin(prefixFor(target));
	if (bin) {
		const hit = kernelWatchCutover(target);
		return hit.ok ? { ...hit, phase: "planted" } : hit;
	}
	const st = loadState();
	saveState({ ...st, upgrade: { version: target, phase: "plug" } });
	const plug = kernelWatchPlug(target);
	if (!plug.ok) return plug;
	return { ok: true, phase: "plug", version: target, next: "正在试插 " + target + "：安装、打公司补丁，再用这台的配置试启动一次。全部通过才会换上，换的时候 TDHarness 会自动关闭，再打开就是新版；不通过就不换。" };
}

export function kernelWatchPublish() {
	const st = loadState();
	if (st.publish && st.publish.running) return { ok: false, error: "publish-busy", publish: st.publish };
	const root = maintainerRepo();
	const script = path.join(root, "scripts/p-client-app/publish-from-desk.sh");
	if (!existsSync(script)) return { ok: false, error: "publish-script-missing" };
	const log = path.join(rcDir(), "kernel-publish.log");
	const logFd = openSync(log, "w");
	const child = spawn("bash", [script], {
		cwd: root,
		detached: true,
		stdio: ["ignore", logFd, logFd],
	});
	child.unref();
	const publish = { running: true, pid: child.pid, startedAt: Date.now(), log };
	saveState({ ...st, publish });
	return { ok: true, publish, next: "正在发版。员工要等 8443 上的 version.json 换了，下次打开才更新。" };
}
