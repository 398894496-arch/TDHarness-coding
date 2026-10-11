// company-watch-video-v1
// Let the agent watch a video: the file goes to the model that takes video
// whole (picture and sound), through the company gateway. The chat wire the
// desk talks on cannot carry video, so this is a tool, not an attachment kind.
//
// Size rule, measured against the vendor on 2026-10-04: uploads of 169 MB went
// through, 177 MB and up were refused. 150 MB is the line with margin. A file
// over it is re-encoded with ffmpeg to fit under it first, then sent the same way.

import { spawn } from "node:child_process";
import { createReadStream, existsSync, mkdtempSync, rmSync, statSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import { URL } from "node:url";

export const VIDEO_SAFE_BYTES = 150 * 1024 * 1024;
// The vendor also drops an upload that takes too long on its side ("Auth
// context expired"), and how long a file takes depends on the line that day:
// a 135 MB file that went through in the afternoon was refused in the evening.
// So a refused upload is not final. The file is cut down to this size and sent
// once more; at this size an upload takes well under a minute on a slow line.
export const VIDEO_RETRY_BYTES = 40 * 1024 * 1024;
export const VIDEO_EXT = /\.(mp4|mov|m4v|webm|mkv|avi)$/i;

// What to aim for when shrinking. The container adds a little on top of the
// two streams, and encoders overshoot a bitrate target, so aim below the line.
const AIM = 0.9;
// Encoders in the order we want them. Builds differ in what they ship: the
// LGPL Windows build has no libx264 but can use the system's H.264 encoder.
const ENCODERS = ["libx264", "h264_mf", "h264_videotoolbox", "libopenh264", "libsvtav1", "mpeg4"];

function run(cmd, args, timeoutMs) {
	return new Promise((resolve) => {
		let out = "";
		let err = "";
		let child;
		try {
			child = spawn(cmd, args, { windowsHide: true });
		} catch (e) {
			resolve({ code: -1, out: "", err: String((e && e.message) || e) });
			return;
		}
		const timer = setTimeout(() => { try { child.kill(); } catch {} }, timeoutMs);
		child.stdout.on("data", (c) => { if (out.length < 200000) out += c; });
		child.stderr.on("data", (c) => { if (err.length < 200000) err += c; });
		child.on("error", (e) => { clearTimeout(timer); resolve({ code: -1, out, err: String((e && e.message) || e) }); });
		child.on("close", (code) => { clearTimeout(timer); resolve({ code: code == null ? -1 : code, out, err }); });
	});
}

/** Length in seconds, or 0 when ffprobe is missing or cannot read the file. */
export async function probeSeconds(file) {
	const r = await run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", file], 60000);
	const n = r.code === 0 ? parseFloat(String(r.out).trim()) : 0;
	return n > 0 ? n : 0;
}

/**
 * How to re-encode a file so it lands under the line, or null when it already
 * fits. Throws when no bitrate that still shows a picture would fit.
 */
export function shrinkPlan(bytes, seconds, limitBytes = VIDEO_SAFE_BYTES) {
	if (bytes <= limitBytes) return null;
	if (!(seconds > 0)) throw new Error("video-length-unknown");
	const totalKbps = Math.floor((limitBytes * AIM * 8) / 1000 / seconds);
	const audioKbps = totalKbps >= 1200 ? 96 : 64;
	const videoKbps = totalKbps - audioKbps;
	if (videoKbps < 150) throw new Error("video-too-long-to-fit");
	const height = videoKbps >= 4000 ? 1080 : videoKbps >= 1200 ? 720 : 480;
	return { videoKbps, audioKbps, height };
}

async function pickEncoder() {
	const r = await run("ffmpeg", ["-hide_banner", "-encoders"], 30000);
	if (r.code !== 0) throw new Error("ffmpeg-missing");
	for (const name of ENCODERS) {
		if (new RegExp("^\\s*V\\S*\\s+" + name + "\\s", "m").test(r.out)) return name;
	}
	throw new Error("ffmpeg-no-video-encoder");
}

async function shrink(file, plan, outFile, encoder) {
	const args = [
		"-y", "-hide_banner", "-loglevel", "error", "-i", file,
		"-vf", "scale=-2:'min(" + plan.height + ",ih)'",
		"-c:v", encoder, "-b:v", plan.videoKbps + "k", "-maxrate", plan.videoKbps + "k", "-bufsize", plan.videoKbps * 2 + "k",
		"-pix_fmt", "yuv420p",
		"-c:a", "aac", "-b:a", plan.audioKbps + "k",
		"-movflags", "+faststart", outFile,
	];
	const r = await run("ffmpeg", args, 30 * 60 * 1000);
	if (r.code !== 0 || !existsSync(outFile)) throw new Error("ffmpeg-failed: " + String(r.err).trim().split(/\r?\n/).slice(-2).join(" ").slice(0, 300));
}

/** A copy of `file` that is under the line. Returns the original when it already is. */
export async function fitUnderLine(file, limitBytes = VIDEO_SAFE_BYTES) {
	const bytes = statSync(file).size;
	if (bytes <= limitBytes) return { file, bytes, shrunk: false, cleanup() {} };
	const seconds = await probeSeconds(file);
	if (!(seconds > 0)) throw new Error("ffmpeg-missing-or-unreadable-video");
	let plan = shrinkPlan(bytes, seconds, limitBytes);
	const encoder = await pickEncoder();
	const dir = mkdtempSync(path.join(os.tmpdir(), "tdh-video-"));
	const out = path.join(dir, "fit.mp4");
	const cleanup = () => { try { rmSync(dir, { recursive: true, force: true }); } catch {} };
	try {
		// An encoder may overshoot its target; step down and try again rather
		// than send a file the vendor will refuse two minutes into the upload.
		for (let pass = 0; pass < 3; pass++) {
			await shrink(file, plan, out, encoder);
			const got = statSync(out).size;
			if (got <= limitBytes) return { file: out, bytes: got, shrunk: true, from: bytes, encoder, cleanup };
			const videoKbps = Math.floor(plan.videoKbps * 0.8 * (limitBytes / got));
			if (videoKbps < 150) break;
			plan = { videoKbps, audioKbps: plan.audioKbps, height: videoKbps >= 1200 ? plan.height : Math.min(plan.height, 480) };
		}
		throw new Error("video-would-not-fit");
	} catch (e) {
		cleanup();
		throw e;
	}
}

function request(url, opts, write) {
	return new Promise((resolve, reject) => {
		const u = new URL(url);
		const lib = u.protocol === "http:" ? http : https;
		const req = lib.request({
			protocol: u.protocol,
			hostname: u.hostname,
			port: u.port || (u.protocol === "http:" ? 80 : 443),
			path: u.pathname + u.search,
			method: opts.method,
			headers: opts.headers,
			rejectUnauthorized: false,
			timeout: opts.timeoutMs,
		}, (res) => {
			const chunks = [];
			res.on("data", (c) => chunks.push(c));
			res.on("end", () => {
				const raw = Buffer.concat(chunks).toString("utf8");
				let obj = null;
				try { obj = JSON.parse(raw); } catch { obj = null; }
				resolve({ status: res.statusCode || 0, obj, raw });
			});
		});
		req.on("error", reject);
		req.on("timeout", () => req.destroy(new Error("timeout")));
		write(req);
	});
}

function authHeaders(token) {
	return token ? { authorization: "Bearer " + token } : {};
}

async function upload(gwBase, token, file, bytes) {
	const boundary = "----tdh" + Date.now().toString(16) + Math.random().toString(16).slice(2);
	const name = path.basename(file).replace(/[^\w.\-]+/g, "_") || "video.mp4";
	const head = Buffer.from(
		"--" + boundary + "\r\nContent-Disposition: form-data; name=\"purpose\"\r\n\r\nassistants\r\n" +
		"--" + boundary + "\r\nContent-Disposition: form-data; name=\"file\"; filename=\"" + name + "\"\r\nContent-Type: video/mp4\r\n\r\n",
		"utf8",
	);
	const tail = Buffer.from("\r\n--" + boundary + "--\r\n", "utf8");
	const res = await request(gwBase + "/v1/files", {
		method: "POST",
		headers: Object.assign({
			"content-type": "multipart/form-data; boundary=" + boundary,
			"content-length": head.length + bytes + tail.length,
		}, authHeaders(token)),
		timeoutMs: 15 * 60 * 1000,
	}, (req) => {
		req.write(head);
		const stream = createReadStream(file);
		stream.on("error", (e) => req.destroy(e));
		stream.on("end", () => req.end(tail));
		stream.pipe(req, { end: false });
	});
	const id = res.obj && typeof res.obj.id === "string" ? res.obj.id : "";
	if (res.status !== 200 || !id) throw new Error("upload-refused http=" + res.status + " " + String(res.raw).slice(0, 160));
	return id;
}

async function ask(gwBase, token, model, fileId, question) {
	const body = Buffer.from(JSON.stringify({
		model,
		input: [{ role: "user", content: [{ type: "input_text", text: question }, { type: "input_file", file_id: fileId }] }],
	}), "utf8");
	const res = await request(gwBase + "/v1/responses", {
		method: "POST",
		headers: Object.assign({ "content-type": "application/json", "content-length": body.length }, authHeaders(token)),
		timeoutMs: 10 * 60 * 1000,
	}, (req) => req.end(body));
	if (res.status !== 200 || !res.obj) throw new Error("model-refused http=" + res.status + " " + String(res.raw).slice(0, 200));
	const parts = [];
	for (const item of Array.isArray(res.obj.output) ? res.obj.output : []) {
		for (const c of Array.isArray(item && item.content) ? item.content : []) {
			if (c && typeof c.text === "string" && c.text) parts.push(c.text);
		}
	}
	if (!parts.length) throw new Error("model-returned-no-text");
	return parts.join("\n");
}

async function forget(gwBase, token, fileId) {
	try {
		await request(gwBase + "/v1/files/" + encodeURIComponent(fileId), { method: "DELETE", headers: authHeaders(token), timeoutMs: 60000 }, (req) => req.end());
	} catch {}
}

/**
 * Answer `question` about the video at `file`.
 * @returns what the model said, and what was done to the file to get it there.
 */
export async function watchVideo({ file, question, gwBase, token, model, limitBytes = VIDEO_SAFE_BYTES }) {
	if (typeof file !== "string" || !path.isAbsolute(file)) return { ok: false, status: "need-absolute-path" };
	if (!existsSync(file) || !statSync(file).isFile()) return { ok: false, status: "file-not-found", path: file };
	if (!VIDEO_EXT.test(file)) return { ok: false, status: "not-a-video", path: file };
	const ask1 = String(question || "").trim() || "Describe what happens in this video, including what is said.";
	let fit = null;
	let fileId = "";
	let retried = false;
	try {
		fit = await fitUnderLine(file, limitBytes);
		try {
			fileId = await upload(gwBase, token, fit.file, fit.bytes);
		} catch (e) {
			if (fit.bytes <= VIDEO_RETRY_BYTES || String((e && e.message) || e).indexOf("upload-refused") !== 0) throw e;
			fit.cleanup();
			fit = await fitUnderLine(file, VIDEO_RETRY_BYTES);
			retried = true;
			fileId = await upload(gwBase, token, fit.file, fit.bytes);
		}
		const answer = await ask(gwBase, token, model, fileId, ask1);
		const original = statSync(file).size;
		// Every field always has a value: the kernel refuses a tool result that
		// would not survive a JSON round trip, and `undefined` does not.
		return {
			ok: true,
			status: "watched",
			model,
			answer,
			sentMB: Math.round(fit.bytes / 104857.6) / 10,
			originalMB: Math.round(original / 104857.6) / 10,
			shrunk: fit.shrunk,
			retried,
		};
	} catch (e) {
		return { ok: false, status: "failed", hint: String((e && e.message) || e).slice(0, 300) };
	} finally {
		if (fileId) await forget(gwBase, token, fileId);
		if (fit) fit.cleanup();
	}
}
