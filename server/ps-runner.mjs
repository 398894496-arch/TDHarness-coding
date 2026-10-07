// Run one PowerShell script to completion with its output in a log file.
// Started detached by the desk's kernel, so it outlives that kernel (a kernel
// switch stops it); PowerShell itself is started attached here, because a
// detached PowerShell 5.1 exits at once without running anything.
//   node ps-runner.mjs <log> <script.ps1> [args...]
import { spawn } from "node:child_process";
import { openSync } from "node:fs";
const [log, script, ...rest] = process.argv.slice(2);
const fd = openSync(log, "a");
const child = spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script, ...rest], { stdio: ["ignore", fd, fd], windowsHide: true });
child.on("exit", (code) => process.exit(code == null ? 1 : code));
child.on("error", () => process.exit(1));
