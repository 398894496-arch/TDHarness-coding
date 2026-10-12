#!/usr/bin/env node
// Boot: copy company _skills onto a local cache, then point overlay/preset at it.
// The session catalog must not scan the share (SMB list is ~1s) or cwd/_skills
// (personal clone goes stale: missing company-access / old company-web).
"use strict";

const fs = require("fs");
const path = require("path");

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  return fallback || "";
}

function copyTree(src, dest) {
  if (!src || !fs.existsSync(src)) return 0;
  fs.mkdirSync(dest, { recursive: true });
  let n = 0;
  for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
    if (ent.name === ".DS_Store" || ent.name.startsWith("._")) continue;
    const from = path.join(src, ent.name);
    const to = path.join(dest, ent.name);
    if (ent.isDirectory()) n += copyTree(from, to);
    else {
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.copyFileSync(from, to);
      n += 1;
    }
  }
  return n;
}

function rewriteCatalog(file, cache) {
  if (!file || !fs.existsSync(file)) return false;
  let t = fs.readFileSync(file, "utf8");
  const prev = t;
  t = t.split("__DESK_SKILLS__").join(cache);
  t = t.replace(/bundledSkillDir:[^\n]*/g, "bundledSkillDir: " + cache);
  t = t.replace(/(customSkillDirs:\r?\n)(?:[ \t]*- [^\n]*\r?\n)+/g, "$1      - " + cache + "\n");
  t = t.replace(/^[ \t]*- [^\n]*\/_skills[ \t]*\r?\n/gm, "");
  t = t.replace(/^[ \t]*- _skills[ \t]*\r?\n/gm, "");
  if (t === prev) return false;
  fs.writeFileSync(file, t);
  return true;
}

function countSkills(dir) {
  if (!dir || !fs.existsSync(dir)) return 0;
  let n = 0;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!ent.isDirectory()) continue;
    if (fs.existsSync(path.join(dir, ent.name, "SKILL.md"))) n += 1;
  }
  return n;
}

const cache = path.resolve(arg("--cache"));
const share = arg("--share") ? path.resolve(arg("--share")) : "";
const seed = arg("--seed") ? path.resolve(arg("--seed")) : "";
const overlay = arg("--overlay");
const preset = arg("--preset");
if (!cache) {
  process.stderr.write("usage: sync-skills.js --cache DIR [--share DIR] [--seed DIR] [--overlay FILE] [--preset FILE]\n");
  process.exit(2);
}

fs.mkdirSync(cache, { recursive: true });
let src = "";
if (share && fs.existsSync(share) && countSkills(share) >= 1) src = share;
else if (seed && fs.existsSync(seed) && countSkills(seed) >= 1) src = seed;
const copied = src ? copyTree(src, cache) : 0;
const n = countSkills(cache);
process.stdout.write("SKILLS_CACHE=" + cache + "\n");
process.stdout.write("SKILLS_SRC=" + (src || "none") + "\n");
process.stdout.write("SKILLS_COPIED=" + copied + "\n");
process.stdout.write("SKILLS_COUNT=" + n + "\n");
if (overlay) process.stdout.write("SKILLS_OVERLAY=" + (rewriteCatalog(overlay, cache) ? "1" : "0") + "\n");
if (preset) process.stdout.write("SKILLS_PRESET=" + (rewriteCatalog(preset, cache) ? "1" : "0") + "\n");
if (n < 1) process.exit(2);
