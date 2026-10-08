#!/usr/bin/env node
// Every change to main carries its version, its release notes and the front
// page together: VERSION is a date (YYYY.MM.DD, or .N for a second release
// that day), CHANGELOG.md starts with that version, README.md and docs/BRIEF.zh.md show it.
// With BASE_REF set (a pull request), the change must also bump VERSION and
// touch CHANGELOG.md. Prints RELEASE_NOTES_OK=1 or exits 1 with the reason.
"use strict";
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const root = path.resolve(__dirname, "..");
const fail = (why) => { console.error("RELEASE_NOTES_FAIL=" + why); process.exit(1); };
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");

const version = read("VERSION").trim();
if (!/^\d{4}\.\d{2}\.\d{2}(\.\d+)?$/.test(version)) fail("VERSION is not a date like 2026.10.07: " + version);
const first = (read("CHANGELOG.md").match(/^## (.+)$/m) || [])[1];
if ((first || "").trim() !== version) fail("CHANGELOG.md must start with a section for " + version + " (found " + first + ")");
// Exact version line, not a substring: 2026.10.08 is inside 2026.10.08.2.
const shown = (text, re) => { const m = text.match(re); return m ? m[1] : ""; };
const readmeV = shown(read("README.md"), /Version:\s*([0-9.]+)\*\*/);
if (readmeV !== version) fail("README.md version line shows " + readmeV + ", expected " + version);
const briefV = shown(read("docs/BRIEF.zh.md"), /当前版本：([0-9.]+)/);
if (briefV !== version) fail("docs/BRIEF.zh.md version line shows " + briefV + ", expected " + version);

const base = process.env.BASE_REF;
if (base) {
	const sh = (c) => execSync(c, { cwd: root, encoding: "utf8" }).trim();
	const changed = sh("git diff --name-only origin/" + base + "...HEAD").split("\n").filter(Boolean);
	if (changed.length) {
		if (!changed.includes("VERSION")) fail("this change does not bump VERSION");
		if (!changed.includes("CHANGELOG.md")) fail("this change does not add release notes to CHANGELOG.md");
		let old = "";
		try { old = sh("git show origin/" + base + ":VERSION"); } catch { old = ""; }
		// Numeric per part: 2026.10.07.10 comes after 2026.10.07.9.
		const parts = (v) => v.split(".").map(Number);
		const newer = (a, b) => { const x = parts(a), y = parts(b); for (let i = 0; i < Math.max(x.length, y.length); i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); } return false; };
		if (old && !newer(version, old)) fail("VERSION must move forward from " + old);
	}
}
console.log("RELEASE_NOTES_OK=1 version=" + version);
