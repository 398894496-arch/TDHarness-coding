"use strict";
if (process.platform !== "win32") return;
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
  var r = spawnSync("cmd.exe", ["/c", "mklink", "/J", link, target], { encoding: "utf8", windowsHide: true, cwd: process.env.SystemRoot || "C:\\Windows" });
  if (r.status === 0) return;
  var err = new Error("dsh: win-junction-failed " + link + " -> " + target);
  err.code = "EPERM";
  throw err;
}
fs.symlinkSync = function (target, link) { winJunction(link, target); };
if (fs.promises) fs.promises.symlink = async function (target, link) { winJunction(link, target); };
