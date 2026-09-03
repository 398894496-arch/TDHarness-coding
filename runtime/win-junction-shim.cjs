// Loaded by AppHost via `node --require`. On Windows, official dsh-app-boot
// calls fs.symlinkSync(..., "junction") which still needs Developer Mode on
// Node 22. Replace it with cmd mklink /J (NTFS junction, no privilege).
"use strict";
if (process.platform !== "win32") return;

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

function winJunction(link, target) {
  try {
    fs.mkdirSync(path.dirname(link), { recursive: true });
  } catch (_) {}
  try {
    const st = fs.lstatSync(link);
    if (st.isSymbolicLink() || st.isFile()) fs.unlinkSync(link);
    else if (st.isDirectory()) fs.rmSync(link, { recursive: true, force: true });
  } catch (_) {}
  const r = spawnSync("cmd.exe", ["/c", "mklink", "/J", link, target], {
    encoding: "utf8",
    windowsHide: true,
    cwd: process.env.SystemRoot || "C:\\Windows",
  });
  if (r.status === 0) return;
  const err = new Error(
    "dsh: win-junction-failed " +
      link +
      " -> " +
      target +
      " " +
      String(r.stderr || r.stdout || "").replace(/\s+/g, " ").slice(0, 160)
  );
  err.code = "EPERM";
  throw err;
}

fs.symlinkSync = function (target, link) {
  winJunction(link, target);
};
if (fs.promises) {
  fs.promises.symlink = async function (target, link) {
    winJunction(link, target);
  };
}
