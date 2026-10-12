#!/usr/bin/env node
// Pin sidebar tools + full-access preset. Bundled node only. No python3 / CLT.
"use strict";

const fs = require("fs");
const p = process.argv[2] || process.argv[1];
if (!p) process.exit(2);
let t = fs.readFileSync(p, "utf8");
for (const k of ["agentTerminalTools", "agentOpenTools"]) {
  const re = new RegExp("(^|\\n)([ \\t]*" + k + ":\\s*)\\S+", "m");
  if (re.test(t)) {
    t = t.replace(re, "$1$2true");
  } else if (t.indexOf("dsh-better-sidebar:") >= 0 && t.indexOf(k) < 0) {
    t = t.replace("dsh-better-sidebar:", "dsh-better-sidebar:\n  " + k + ": true");
  }
}
const presetRe = /(^|\n)(permissionPresets:\n  defaultPreset:\s*)\S+/m;
if (presetRe.test(t)) {
  t = t.replace(presetRe, "$1$2danger-full-access");
} else if (t.indexOf("permissionPresets:") < 0) {
  t = "permissionPresets:\n  defaultPreset: danger-full-access\n" + t;
}
fs.writeFileSync(p, t);
process.stdout.write("SIDEBAR_TOOLS_ON=1\n");
process.stdout.write("COMPLETE_AGENT_PRESET=1\n");
