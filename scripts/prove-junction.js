#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');

if (process.platform !== 'win32') {
  console.log('JUNCTION_PROVE_SKIP=requires-Windows');
  process.exit(0);
}

async function worker(root) {
  const calls = [];
  const originalSpawn = cp.spawnSync;
  // Observe the real process invocation, without replacing mklink with a mock.
  cp.spawnSync = function (file, args, options) {
    calls.push({ file, args, cwd: options.cwd });
    return originalSpawn.apply(this, arguments);
  };
  require('../runtime/win-junction-shim.cjs');
  const target = path.join(root, 'target with spaces');
  fs.mkdirSync(target);
  fs.writeFileSync(path.join(target, 'proof.txt'), 'junction-proof');
  for (const mode of ['sync', 'async']) {
    const link = path.join(root, mode + ' link');
    if (mode === 'sync') fs.symlinkSync(target, link, 'junction');
    else await fs.promises.symlink(target, link, 'junction');
    assert.equal(fs.lstatSync(link).isSymbolicLink(), true);
    assert.equal(fs.realpathSync.native(link), fs.realpathSync.native(target));
    assert.equal(fs.readFileSync(path.join(link, 'proof.txt'), 'utf8'), 'junction-proof');
    fs.writeFileSync(path.join(link, mode + '.txt'), mode);
    assert.equal(fs.readFileSync(path.join(target, mode + '.txt'), 'utf8'), mode);
    // Unlink only the junction, then prove that its target survived.
    fs.unlinkSync(link);
    assert.equal(fs.existsSync(link), false);
    assert.equal(fs.readFileSync(path.join(target, 'proof.txt'), 'utf8'), 'junction-proof');
  }
  assert.equal(calls.length, 2, 'both APIs must invoke the shim');
  for (const call of calls) {
    assert.equal(call.file.toLowerCase(), 'cmd.exe');
    assert.deepEqual(call.args.slice(0, 3), ['/c', 'mklink', '/J']);
    assert.equal(path.resolve(call.cwd).toLowerCase(),
      path.resolve(process.env.SystemRoot || 'C:\\Windows').toLowerCase());
  }
  console.log('JUNCTION_WORKER_OK=1');
}

if (process.argv[2] === '--worker') {
  worker(process.argv[3]).catch((err) => { console.error(err); process.exitCode = 1; });
} else {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tdh-junction-'));
  try {
    const result = cp.spawnSync(process.execPath, [__filename, '--worker', root], {
      cwd: root, encoding: 'utf8', windowsHide: true, timeout: 30000,
    });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /JUNCTION_WORKER_OK=1/);
  } finally {
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('tdh-junction-'));
    // Remove any junction left by a failing assertion before recursive cleanup.
    for (const name of ['sync link', 'async link']) {
      const link = path.join(root, name);
      if (fs.existsSync(link) && fs.lstatSync(link).isSymbolicLink()) fs.unlinkSync(link);
    }
    fs.rmSync(root, { recursive: true, force: true });
  }
  console.log('JUNCTION_UNC_SKIP=no-real-share-tested');
  console.log('JUNCTION_PROVE_OK=1');
}
