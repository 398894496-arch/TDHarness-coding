#!/usr/bin/env node
'use strict';

// The kernel page's "running" version is the kernel this desk process runs, not a fixed
// install path. Builds a stand-in kernel (@deepseek-ai/dsh/lib/bin.js + package.json),
// loads the patched kernel-watch.js from it, and reads the version back. Needs a pack's
// kernel-watch.js: KERNEL_WATCH=<path>, or the one inside client/CompanyDesk-win.zip.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tdh-kernel-live-'));

function source() {
  if (process.env.KERNEL_WATCH) return fs.readFileSync(process.env.KERNEL_WATCH, 'utf8');
  const zip = path.join(ROOT, 'client', 'CompanyDesk-win.zip');
  const r = spawnSync('unzip', ['-p', zip, 'CompanyDesk/plugins/company-shell/lib/kernel-watch.js'], { encoding: 'utf8', maxBuffer: 8 << 20 });
  if (r.status !== 0 || !r.stdout) return '';
  return r.stdout;
}

const py = ['python3', 'python'].find((n) => spawnSync(n, ['--version']).status === 0);
const raw = source();
if (!raw || !py) {
  console.log('KERNEL_LIVE_SKIPPED=' + (!raw ? 'no-pack-source (git lfs pull, or KERNEL_WATCH=)' : 'no-python'));
  process.exit(0);
}
const kw = path.join(dir, 'kernel-watch.js');
fs.writeFileSync(kw, raw);
const p = spawnSync(py, ['-I', path.join(ROOT, 'server', 'site-patches', 'patch_kernel_watch.py'), kw], { encoding: 'utf8' });
assert.equal(p.status, 0, p.stderr);
assert.match(p.stdout, /patched-kernel-live/);
const again = spawnSync(py, ['-I', path.join(ROOT, 'server', 'site-patches', 'patch_kernel_watch.py'), kw], { encoding: 'utf8' });
assert.match(again.stdout, /already/);

// Stand-in kernel: the module is loaded from inside it, as the desk loads its plugins.
const pkg = path.join(dir, 'node_modules', '@deepseek-ai', 'dsh');
fs.mkdirSync(path.join(pkg, 'lib'), { recursive: true });
fs.writeFileSync(path.join(pkg, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh', version: '9.8.7-test.1' }));
const mod = path.join(dir, 'kw.mjs');
fs.writeFileSync(mod, fs.readFileSync(kw, 'utf8') + '\nexport { liveKernelVersion as __live };\n');
fs.writeFileSync(path.join(pkg, 'lib', 'bin.js'),
  'import(' + JSON.stringify('file://' + mod.replace(/\\/g, '/')) + ').then((m) => console.log("LIVE=" + m.__live()));\n');
fs.writeFileSync(path.join(pkg, 'lib', 'package.json'), JSON.stringify({ type: 'module' }));
const run = spawnSync(process.execPath, [path.join(pkg, 'lib', 'bin.js')], { encoding: 'utf8', env: Object.assign({}, process.env, { HOME: dir, USERPROFILE: dir }) });
assert.equal(run.status, 0, run.stderr);
assert.equal(run.stdout.trim(), 'LIVE=9.8.7-test.1', 'the running kernel, not ~/dsh-kernel/0-1-7-rc-2');
console.log('KERNEL_LIVE_PROVE_OK=1');
