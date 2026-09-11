#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync, spawnSync } = require('node:child_process');

const git = process.env.TDH_TEST_GIT || 'git';
const bash = process.env.TDH_TEST_BASH || 'bash';
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tdh-secret-proof-'));
const source = path.resolve(__dirname, '..');
try {
  fs.mkdirSync(path.join(root, 'scripts'));
  for (const file of ['prove-scan.sh', 'scan-secrets.js']) {
    fs.copyFileSync(path.join(source, 'scripts', file), path.join(root, 'scripts', file));
  }
  const gitRun = (args) => execFileSync(git, args, { cwd: root, stdio: 'pipe' });
  gitRun(['init', '--quiet']);
  fs.writeFileSync(path.join(root, '.gitignore'), '.env\n.env.*\n');
  gitRun(['add', 'scripts', '.gitignore']);
  const scan = () => {
    const result = spawnSync(bash, ['scripts/prove-scan.sh'], {
      cwd: root, encoding: 'utf8', windowsHide: true, timeout: 30000,
    });
    assert.ifError(result.error);
    return { status: result.status, output: result.stdout + result.stderr };
  };
  const clean = scan();
  assert.equal(clean.status, 0, clean.output);
  assert.match(clean.output, /SECRET_SCAN_OK=1/);
  assert.match(clean.output, /\bSCAN_OK=1/);

  // Values are generated only in the temporary repository. No real credentials.
  const cases = [
    ['github', 'note.txt', 'gh' + 'p_' + 'A1b2'.repeat(9)],
    ['github-fine', 'nested/file with spaces.txt', 'github_' + 'pat_' + 'aB3_'.repeat(22)],
    ['vendor', 'config.txt', 's' + 'k-' + 'a1b2'.repeat(8)],
    ['vendor-project', 'config.txt', 's' + 'k-proj-' + 'aB3_'.repeat(24)],
    ['cloud', 'config.txt', 'AK' + 'IA' + 'A1B2'.repeat(4)],
    ['temporary-cloud', 'config.txt', 'AS' + 'IA' + 'A1B2'.repeat(4)],
    ['private-key', 'key.txt', '-----BEGIN ' + 'PRIVATE KEY-----'],
    ['env', '.env', 'PASSWORD=ordinary-text'],
    ['env-production', 'nested/.env.production', 'SETTING=ordinary-text'],
    ['secret-in-template', '.env.example', 's' + 'k-' + 'a1b2'.repeat(8)],
  ];
  for (const [name, file, value] of cases) {
    const full = path.join(root, file);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, value + '\n');
    gitRun(['add', '--force', '--', file]);
    const result = scan();
    assert.equal(result.status, 1, name + ': ' + result.output);
    assert.match(result.output, /SECRET_HIT=/, name);
    assert.doesNotMatch(result.output, /\bSCAN_OK=1/, name);
    assert.ok(!result.output.includes(value), name + ': secret must be redacted');
    gitRun(['rm', '--force', '--', file]);
  }
  const shell = fs.readFileSync(path.join(source, 'scripts/prove-scan.sh'), 'utf8');
  const block = shell.match(/needles=\(([\s\S]*?)\)/);
  assert.ok(block, 'office needle list remains present');
  const needles = [...block[1].matchAll(/'([^']+)'/g)].map((m) => m[1].replace(/\\(.)/g, '$1'));
  assert.equal(needles.length, 7, 'all original office needles retained');
  for (const value of needles) {
    fs.writeFileSync(path.join(root, 'office.txt'), value + '\n');
    gitRun(['add', 'office.txt']);
    const result = scan();
    assert.equal(result.status, 1, 'office needle must fail');
    assert.match(result.output, /SCAN_HIT=/);
    assert.doesNotMatch(result.output, /\bSCAN_OK=1/);
    gitRun(['rm', '--force', 'office.txt']);
  }
  fs.writeFileSync(path.join(root, '.env.example'), 'DEEPSEEK_API_KEY=your-key\n');
  gitRun(['add', '--force', '.env.example']);
  assert.equal(scan().status, 0, 'placeholder templates remain allowed');
  // A missing tracked file and an invalid Git executable are operational errors.
  fs.unlinkSync(path.join(root, '.env.example'));
  assert.notEqual(scan().status, 0, 'unreadable tracked file must not pass');
  const invalidGit = spawnSync(process.execPath, [path.join(root, 'scripts/scan-secrets.js')], {
    cwd: root, encoding: 'utf8', env: { ...process.env, TDH_TEST_GIT: path.join(root, 'not-a-git') },
  });
  assert.equal(invalidGit.status, 2);
  console.log('SECRET_SCAN_PROVE_OK=1');
} finally {
  assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
  assert.ok(path.basename(root).startsWith('tdh-secret-proof-'));
  fs.rmSync(root, { recursive: true, force: true });
}
