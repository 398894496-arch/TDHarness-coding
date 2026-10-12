#!/usr/bin/env node
// Compare this install's BUILD.json mark to 8443 /client/version.json.
// Fail open: no file, no net, no pop. Runs on every launch, before login, and
// the window waits for it, so it must stay fast: no tree hashing here.
//
// It also finishes what an older updater could not:
// - Windows: a running TDHarness.exe cannot be overwritten, so the updater
//   stages TDHarness.exe.new. Renaming a running exe is allowed, so swap it in
//   here; the next launch runs the new one.
// - Parts the old updater did not copy (windows-mcp/, peekaboo/, opencli/,
//   skills/) are listed in BUILD.json but missing on disk: report
//   UPDATE_AVAILABLE=1 with UPDATE_REASON=incomplete:<parts> so the current
//   updater fetches them.
"use strict";

const fs = require("fs");
const https = require("https");
const http = require("http");
const path = require("path");
const os = require("os");

function out(s) {
  process.stdout.write(s + "\n");
}

function parseArgs(argv) {
  const o = { root: "", url: "", served: "", defer: "", timeoutMs: 4000 };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--root" && argv[i + 1]) o.root = argv[++i];
    else if (argv[i] === "--url" && argv[i + 1]) o.url = argv[++i];
    else if (argv[i] === "--served" && argv[i + 1]) o.served = argv[++i];
    else if (argv[i] === "--defer" && argv[i + 1]) o.defer = argv[++i];
  }
  return o;
}

function platKey() {
  return process.platform === "darwin" ? "mac" : "win";
}

function skipPath() {
  const home = process.env.HOME || process.env.USERPROFILE || os.homedir();
  return path.join(home, ".dsh-company-rc8", "pack-update.skip");
}

function readSkip() {
  try {
    return fs.readFileSync(skipPath(), "utf8").replace(/^\uFEFF/, "").trim();
  } catch {
    return "";
  }
}

function fetchText(url, timeoutMs) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith("https:") ? https : http;
    const req = lib.get(url, { rejectUnauthorized: false, timeout: timeoutMs }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error("http-" + res.statusCode));
        return;
      }
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    });
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("timeout"));
    });
    req.on("error", reject);
  });
}

function loadServed(args) {
  if (args.served) {
    return Promise.resolve(fs.readFileSync(args.served, "utf8"));
  }
  if (!args.url) return Promise.reject(new Error("no-url"));
  return fetchText(args.url, args.timeoutMs);
}

function writeSkip(mark) {
  const dest = skipPath();
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, mark + "\n", "utf8");
}


const PARTS = ["windows-mcp/", "peekaboo/", "opencli/", "skills/"];

function incompleteParts(root, build) {
  const files = build && build.files && typeof build.files === "object" ? Object.keys(build.files) : [];
  const missing = [];
  for (const part of PARTS) {
    const rows = files.filter((f) => f.startsWith(part)).sort();
    if (!rows.length) continue;
    const sample = [rows[0], rows[Math.floor(rows.length / 2)], rows[rows.length - 1]];
    if (sample.some((rel) => !fs.existsSync(path.join(root, rel)))) missing.push(part.replace(/\/$/, ""));
  }
  return missing;
}

function swapStagedExe(root) {
  if (process.platform !== "win32") return;
  const exe = path.join(root, "TDHarness.exe");
  const staged = exe + ".new";
  for (const name of fs.readdirSync(root)) {
    if (/^TDHarness\.exe\.old-\d+$/.test(name)) {
      try { fs.unlinkSync(path.join(root, name)); } catch { /* still running */ }
    }
  }
  if (!fs.existsSync(staged)) return;
  const old = exe + ".old-" + Date.now();
  try {
    if (fs.existsSync(exe)) fs.renameSync(exe, old);
    fs.renameSync(staged, exe);
    out("EXE_SWAPPED=1");
  } catch (err) {
    try { if (!fs.existsSync(exe) && fs.existsSync(old)) fs.renameSync(old, exe); } catch { /* */ }
    out("EXE_SWAP_ERR=" + String(err && err.code || err).slice(0, 40));
  }
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.defer && /^[0-9a-f]{32}$/.test(args.defer)) {
    writeSkip(args.defer);
    out("UPDATE_DEFERRED=1");
    process.exit(0);
  }
  const root = path.resolve(args.root || ".");
  try { swapStagedExe(root); } catch { /* never block the check */ }
  const manPath = path.join(root, "BUILD.json");
  if (!fs.existsSync(manPath)) {
    out("UPDATE_SKIP=1");
    out("UPDATE_REASON=no-local-build");
    process.exit(0);
  }
  let local;
  try {
    local = JSON.parse(fs.readFileSync(manPath, "utf8"));
  } catch {
    out("UPDATE_SKIP=1");
    out("UPDATE_REASON=local-unparseable");
    process.exit(0);
  }
  const localMark = String((local && local.mark) || "");
  out("LOCAL_MARK=" + localMark);
  if (!/^[0-9a-f]{32}$/.test(localMark)) {
    out("UPDATE_SKIP=1");
    out("UPDATE_REASON=local-mark-bad");
    process.exit(0);
  }

  let raw;
  try {
    raw = await loadServed(args);
  } catch (err) {
    out("UPDATE_SKIP=1");
    out("UPDATE_REASON=" + String(err && err.message || err).replace(/\s+/g, "-").slice(0, 60));
    process.exit(0);
  }

  let served;
  try {
    served = JSON.parse(raw);
  } catch {
    out("UPDATE_SKIP=1");
    out("UPDATE_REASON=served-unparseable");
    process.exit(0);
  }
  const row = served && served[platKey()];
  const servedMark = String((row && row.mark) || "");
  out("SERVED_MARK=" + servedMark);
  if (!/^[0-9a-f]{32}$/.test(servedMark)) {
    out("UPDATE_SKIP=1");
    out("UPDATE_REASON=served-mark-bad");
    process.exit(0);
  }
  const skipped = readSkip();
  if (servedMark === localMark) {
    const missing = incompleteParts(root, local);
    if (!missing.length) {
      out("UPDATE_AVAILABLE=0");
      process.exit(0);
    }
    if (skipped === servedMark) {
      out("UPDATE_AVAILABLE=0");
      out("UPDATE_DEFERRED=1");
      process.exit(0);
    }
    out("UPDATE_REASON=incomplete:" + missing.join(","));
    out("UPDATE_AVAILABLE=1");
    process.exit(0);
  }
  if (skipped === servedMark) {
    out("UPDATE_AVAILABLE=0");
    out("UPDATE_DEFERRED=1");
    process.exit(0);
  }
  out("UPDATE_AVAILABLE=1");
  process.exit(0);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  main().catch((err) => {
    out("UPDATE_SKIP=1");
    out("UPDATE_REASON=crash");
    out("UPDATE_ERR=" + String(err && err.message || err).slice(0, 80));
    process.exit(0);
  });
}

module.exports = { platKey, skipPath };
