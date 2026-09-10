#!/usr/bin/env node
// Apply patches onto a throwaway copy of a gold prefix. Does not write gold.
// Green: PATCH_PROVE_OK=1
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.resolve(__dirname, '..');
function resolveGold() {
  const pinned = process.env.KERNEL_PREFIX
    ? [process.env.KERNEL_PREFIX]
    : [
        path.join(os.homedir(), '.tdh-coding-prefix'),
        path.join(os.homedir(), 'dsh-kernel', '0-1-1-rc-2'),
      ];
  for (const gold of pinned) {
    const unix = path.join(gold, 'lib', 'node_modules', '@deepseek-ai', 'dsh');
    const win = path.join(gold, 'node_modules', '@deepseek-ai', 'dsh');
    for (const p of [unix, win]) {
      if (fs.existsSync(path.join(p, 'package.json'))) return { gold, src: p };
    }
  }
  console.error(
    'PROVE_FAIL=gold-missing|set KERNEL_PREFIX or run scripts/setup.sh (prefix ~/.tdh-coding-prefix)'
  );
  process.exit(1);
}
const { gold, src } = resolveGold();
console.log('PROVE_GOLD=' + gold);

const LIB_FILES = [
  path.join('node_modules', '@deepseek-ai', 'dsh-sandbox-local', 'lib', 'index.js'),
  path.join('node_modules', '@deepseek-ai', 'dsh-skill-filesystem', 'lib', 'index.js'),
  path.join('node_modules', '@deepseek-ai', 'dsh-fs-local', 'lib', 'index.js'),
  path.join('node_modules', '@deepseek-ai', 'dsh-goal', 'lib', 'index.js'),
  path.join('node_modules', '@deepseek-ai', 'dsh-app-boot', 'lib', 'index.js'),
  path.join('node_modules', '@deepseek-ai', 'dsh-tool-fs-search', 'lib', 'index.js'),
  path.join('node_modules', '@deepseek-ai', 'dsh-session-persistence-jsonl', 'lib', 'index.js'),
];
const SANDBOX_FILE = LIB_FILES[0];
const BOOT_FILE = LIB_FILES[4];

// 0.1.2 moved presets out of the dsh package config/ tree into the
// dsh-agent-presets package, and no longer ships a `code` preset. Resolve
// whichever place the gold keeps; a preset absent from gold is skipped,
// matching the patcher's own PRESET_*_SKIP behavior.
function presetCandidates(name) {
  return [
    path.join('config', 'agent-presets', name, 'agent.cordis.yml'),
    path.join('node_modules', '@deepseek-ai', 'dsh-agent-presets', 'presets', name, 'agent.cordis.yml'),
  ];
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tdh-coding-patch-'));
const dst = path.join(tmp, 'lib', 'node_modules', '@deepseek-ai', 'dsh');
fs.mkdirSync(dst, { recursive: true });
fs.copyFileSync(path.join(src, 'package.json'), path.join(dst, 'package.json'));
for (const rel of LIB_FILES) {
  const from = path.join(src, rel);
  if (!fs.existsSync(from)) {
    console.error('PROVE_FAIL=gold-file-missing|' + rel);
    process.exit(1);
  }
  const to = path.join(dst, rel);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
}
for (const name of ['standard', 'code']) {
  const rel = presetCandidates(name).find((rel) => fs.existsSync(path.join(src, rel)));
  if (!rel) {
    console.log('PROVE_PRESET_SKIP=' + name + '|absent-from-gold');
    continue;
  }
  const to = path.join(dst, rel);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(path.join(src, rel), to);
}

execFileSync(process.execPath, [path.join(root, 'patches', 'apply-kernel-patches.js'), tmp], {
  stdio: 'inherit',
});

const boot = fs.readFileSync(path.join(dst, BOOT_FILE), 'utf8');
const marks = [
  ['JUNCTION_V3', boot.includes('company-win-junction-mklink-v3') || boot.includes('companyWinJunction')],
  ['JUNCTION_V4', boot.includes('SystemRoot') || boot.includes('company-win-junction-mklink-v4')],
  ['SANDBOX', fs.readFileSync(path.join(dst, SANDBOX_FILE), 'utf8').includes('company-sandbox-local-drive-v2')],
];
let bad = 0;
for (const [name, ok] of marks) {
  console.log((ok ? 'MARK_OK=' : 'MARK_FAIL=') + name);
  if (!ok) bad = 1;
}

execFileSync(process.execPath, [path.join(root, 'scripts', 'prove-unc.js'),
  '--sandbox-file', path.join(dst, SANDBOX_FILE)], {
  stdio: 'inherit',
});
execFileSync(process.execPath, [path.join(root, 'scripts', 'prove-windows-drives.js'),
  '--sandbox-file', path.join(dst, SANDBOX_FILE)], { stdio: 'inherit' });

if (bad) {
  console.error('PATCH_PROVE_OK=0');
  process.exit(1);
}
console.log('PATCH_PROVE_OK=1');
console.log('PROVE_TMP=' + tmp);
