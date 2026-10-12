// Detach the desk like Win Start-Process. nohup is not enough:
// the parent shell/app process group still gets SIGTERM.
"use strict";

const fs = require("fs");
const { spawn } = require("child_process");

const cwd = process.env.DESK_CWD || process.cwd();
const outPath = process.env.DESK_OUT || "/dev/null";
const errPath = process.env.DESK_ERR || "/dev/null";
const bin = process.argv[2];
const args = process.argv.slice(3);
if (!bin) {
  console.error("DESK_SPAWN_FAIL=no-bin");
  process.exit(2);
}
const out = fs.openSync(outPath, "a");
const err = fs.openSync(errPath, "a");
const child = spawn(process.execPath, [bin, ...args], {
  cwd,
  detached: true,
  stdio: ["ignore", out, err],
  env: process.env,
});
child.unref();
console.log("DESK_SPAWN=" + child.pid);
