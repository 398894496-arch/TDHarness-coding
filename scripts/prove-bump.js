#!/usr/bin/env node
// Kernel bump dry-run (C5): install a GIVEN @deepseek-ai/dsh version into a
// throwaway prefix, apply this tree's patches, and print which marks still
// land. Nothing outside the temp prefix is written; the patcher's own
// refuse-live-prefix guard runs as a second gate.
//
// Green: BUMP_PROVE_OK=1. A moved anchor prints the patcher's per-edit
// PATCH_FAIL=anchor-not-unique line and exits 1 -- that is the review gate
// doing its job, not a script bug.
//
// usage: node scripts/prove-bump.js <version>   # e.g. 0.1.1-rc.2
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const version = process.argv[2];
if (!version || version.startsWith('-')) {
  console.error('usage: prove-bump.js <version>');
  process.exit(2);
}
// Strict shape: digits, dots and a prerelease tag. The version string is
// interpolated into the npm argument list, so keep shells nothing to chew on.
if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version)) {
  console.error('BUMP_FAIL=bad-version|' + version);
  process.exit(2);
}

const root = path.resolve(__dirname, '..');

// Same banned list as patches/apply-kernel-patches.js. This script only ever
// installs into its own mkdtemp prefix, so the check guards against future
// edits that let a caller pass a prefix in.
function refuseLivePrefix(raw) {
  const n = path.resolve(raw).replace(/\\/g, '/');
  const home = String(process.env.HOME || process.env.USERPROFILE || '').replace(/\\/g, '/');
  const banned = [];
  if (home) {
    banned.push(home + '/.local');
    banned.push(home + '/dsh-node-rc8');
  }
  const up = process.env.USERPROFILE;
  if (up) banned.push(String(up).replace(/\\/g, '/') + '/AppData/Roaming/npm');
  for (const b of banned) {
    if (b && (n === b || n.startsWith(b + '/'))) {
      console.error('BLOCKED=refuses-known-live-tree:' + n);
      process.exit(2);
    }
  }
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tdh-coding-bump-'));
refuseLivePrefix(tmp);
console.log('BUMP_VERSION=' + version);
console.log('BUMP_PREFIX=' + tmp + ' (throwaway)');

function cleanup() {
  fs.rmSync(tmp, { recursive: true, force: true });
}

// Node >= 20.12 refuses to spawn npm.cmd directly (EINVAL); run npm's own
// CLI script with the current node instead. Layouts differ: Windows keeps
// npm next to node.exe, POSIX keeps it under ../lib/node_modules.
function npmCli() {
  const nodeDir = path.dirname(process.execPath);
  const candidates =
    process.platform === 'win32'
      ? [path.join(nodeDir, 'node_modules', 'npm', 'bin', 'npm-cli.js')]
      : [path.resolve(nodeDir, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js')];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  console.error('BUMP_FAIL=npm-cli-missing|' + candidates.join(' , '));
  process.exit(1);
}
const install = spawnSync(
  process.execPath,
  [npmCli(), 'install', '-g', '@deepseek-ai/dsh@' + version, '--prefix', tmp],
  { stdio: 'inherit' }
);
if (install.status !== 0) {
  console.error('BUMP_FAIL=npm-install|@deepseek-ai/dsh@' + version + '|tag missing? registry unreachable?');
  cleanup();
  process.exit(1);
}

let patchOut = '';
let patchStatus = 0;
try {
  patchOut = execFileSync(process.execPath, [path.join(root, 'patches', 'apply-kernel-patches.js'), tmp], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
} catch (err) {
  patchOut = String(err.stdout || '');
  if (err.stderr) process.stderr.write(String(err.stderr));
  patchStatus = err.status == null ? 1 : err.status;
}
process.stdout.write(patchOut);

const marks = [];
for (const line of patchOut.split(/\r?\n/)) {
  const m = /^(PATCHED|PATCH_ALREADY|PATCH_SKIP_PLATFORM|PATCH_SKIP_KERNEL)=(.+)$/.exec(line);
  if (m) marks.push(m[1] + '|' + m[2]);
}
console.log('BUMP_MARKS=' + marks.length);
for (const m of marks) console.log('BUMP_MARK=' + m);

if (patchStatus !== 0) {
  console.error('BUMP_PROVE_OK=0');
  cleanup();
  process.exit(1);
}
console.log('BUMP_PROVE_OK=1');
cleanup();
