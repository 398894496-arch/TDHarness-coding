#!/usr/bin/env node
// Runtime product-tree checker. Does not need the company watermark key:
// origin stays a pack-time concern. This only answers "did prefix/node/plugins
// change since sealing". Keep @@TREE_SCOPE in sync with tree-restore.ps1,
// tree-restore.sh, and build-stamp.py.
"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

// @@TREE_SCOPE (check). Restore overlays a wider set (whole prefix/ + node/).
const TREE_PREFIXES = [
  "prefix/lib/node_modules/@deepseek-ai/",
  "prefix/node_modules/@deepseek-ai/",
  "plugins/",
  "home/profiles/web/node_modules/",
];
const TREE_FILES = [
  "TDHarness.exe",
  "TDHarness",
  "start.ps1",
  "start.command",
  "CompanyDesk.vbs",
  "WebView2Loader.dll",
  "tree-check.js",
  "tree-restore.ps1",
  "tree-restore.sh",
  "pack-update-check.js",
  "sync-skills.js",
  "sync-desk-home.sh",
  "sync-desk-home.ps1",
  "mac-pin-settings.js",
  "mac-company-login.js",
  "mac-smb-mount.js",
  "desk-lease.js",
  "presets/cordis/preset.yml",
  "node/node.exe",
  "node/bin/node",
];

function out(s) {
  process.stdout.write(s + "\n");
}

function ignored(rel) {
  return rel.split("/").some((p) => p === "__MACOSX" || p.startsWith("._") || p === ".DS_Store");
}

function isPrefixProduct(rel) {
  return TREE_PREFIXES.some((p) => rel === p.slice(0, -1) || rel.startsWith(p));
}

function sha256(full) {
  const st = fs.lstatSync(full);
  if (st.isSymbolicLink()) {
    return crypto.createHash("sha256").update("symlink:" + fs.readlinkSync(full), "utf8").digest("hex");
  }
  const h = crypto.createHash("sha256");
  const fd = fs.openSync(full, "r");
  try {
    const buf = Buffer.alloc(1 << 20);
    let n;
    while ((n = fs.readSync(fd, buf, 0, buf.length, null)) > 0) h.update(buf.subarray(0, n));
  } finally {
    fs.closeSync(fd);
  }
  return h.digest("hex");
}

function walk(dir, relBase, acc) {
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch (_) {
    return;
  }
  for (const name of names) {
    const rel = relBase ? relBase + "/" + name : name;
    if (ignored(rel)) continue;
    const full = path.join(dir, name);
    let st;
    try {
      st = fs.lstatSync(full);
    } catch (_) {
      continue;
    }
    if (st.isDirectory()) walk(full, rel, acc);
    else if (st.isFile() || st.isSymbolicLink()) acc.push(rel.replace(/\\/g, "/"));
  }
}

function parseArgs(argv) {
  let root = path.dirname(process.argv[1]);
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--root" && argv[i + 1]) {
      root = argv[++i];
    }
  }
  return path.resolve(root);
}

function main() {
  const t0 = Date.now();
  const root = parseArgs(process.argv);
  const manPath = path.join(root, "BUILD.json");
  const prefixDir = path.join(root, "prefix");
  if (!fs.existsSync(manPath)) {
    if (fs.existsSync(prefixDir)) {
      out("TREE_OK=0");
      out("TREE_REASON=manifest-missing");
      process.exit(1);
    }
    out("TREE_SKIP=1");
    out("TREE_REASON=not-a-packaged-install");
    process.exit(0);
  }

  let body;
  try {
    body = JSON.parse(fs.readFileSync(manPath, "utf8"));
  } catch (e) {
    out("TREE_OK=0");
    out("TREE_REASON=manifest-unparseable");
    process.exit(1);
  }
  const entries = body.files || {};
  const productKeys = Object.keys(entries).filter((k) => isPrefixProduct(k) || TREE_FILES.indexOf(k) >= 0);

  const changed = [];
  const missing = [];
  for (const rel of productKeys) {
    const full = path.join(root, rel);
    let st = null;
    try {
      st = fs.lstatSync(full);
    } catch (_) {
      // DMG wrap moves the Mach-O to Contents/MacOS/TDHarness and deletes
      // the copy under Resources. The seal still lists Resources/TDHarness
      // because the zip root keeps it. That is not a dirty tree.
      if (rel === "TDHarness") {
        const moved = path.join(root, "..", "MacOS", "TDHarness");
        if (fs.existsSync(moved)) continue;
      }
      missing.push(rel);
      continue;
    }
    if (!(st.isFile() || st.isSymbolicLink())) {
      missing.push(rel);
      continue;
    }
    if (sha256(full) !== entries[rel]) changed.push(rel);
  }

  const now = [];
  for (const pfx of TREE_PREFIXES) {
    walk(path.join(root, pfx.replace(/\/$/, "")), pfx.replace(/\/$/, ""), now);
  }
  const extra = [];
  for (const rel of now) {
    if (ignored(rel)) continue;
    if (!isPrefixProduct(rel)) continue;
    if (!Object.prototype.hasOwnProperty.call(entries, rel)) extra.push(rel);
  }

  const ms = Date.now() - t0;
  out("TREE_CHECKED=" + productKeys.length);
  out("TREE_CHANGED=" + changed.length);
  out("TREE_MISSING=" + missing.length);
  out("TREE_EXTRA=" + extra.length);
  out("TREE_MS=" + ms);
  for (const k of changed.concat(missing, extra).slice(0, 20)) out("TREE_DIFF=" + k);
  if (changed.length || missing.length || extra.length) {
    out("TREE_OK=0");
    process.exit(1);
  }
  out("TREE_OK=1");
  process.exit(0);
}

main();
