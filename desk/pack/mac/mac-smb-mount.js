#!/usr/bin/env node
// SMB helpers for mac-mount-company.sh. Bundled node. No python3 / CLT.
"use strict";

const { spawnSync } = require("child_process");
const fs = require("fs");

const cmd = process.argv[2];

if (cmd === "who") {
  const mnt = process.argv[3];
  if (!mnt) process.exit(2);
  const r = spawnSync("/sbin/mount", [], { encoding: "utf8" });
  const needle = " on " + mnt + " ";
  const text = String((r && r.stdout) || "");
  for (const line of text.split("\n")) {
    if (line.indexOf(needle) < 0) continue;
    if (line.indexOf("smbfs") < 0) continue;
    const left = line.split(" on ")[0].trim();
    if (left.indexOf("//") === 0 && left.indexOf("@") >= 0) {
      process.stdout.write(left.slice(2).split("@")[0] + "\n");
    }
    break;
  }
  process.exit(0);
}

if (cmd === "mount") {
  const host = process.argv[3];
  const share = process.argv[4];
  const mnt = process.argv[5];
  const user = process.argv[6];
  const pf = process.argv[7];
  if (!host || !share || !mnt || !user || !pf) process.exit(2);
  const pw = fs.readFileSync(pf, { encoding: "ascii" }).trim();
  if (!pw) {
    process.stderr.write("BLOCKED=passfile-empty\n");
    process.exit(2);
  }
  const auth = encodeURIComponent(user) + ":" + encodeURIComponent(pw);
  const url = "//" + auth + "@" + host + "/" + share;
  const r = spawnSync("/sbin/mount_smbfs", ["-N", url, mnt], { encoding: "utf8" });
  const scrub = (s) => String(s || "").split(pw).join("***");
  if (r.status) {
    process.stderr.write("BLOCKED=mount-failed\n");
    const err = scrub(r.stderr);
    const out = scrub(r.stdout);
    if (err) process.stderr.write(err);
    if (out) process.stderr.write(out);
    process.exit(2);
  }
  process.exit(0);
}

process.exit(2);
