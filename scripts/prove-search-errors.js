#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync, spawnSync } = require('node:child_process');
const mark = 'company-glob-missing-root-v2';
const anchor = '\tif (outcome.exitCode !== 0 && outcome.exitCode !== 1) throw classifyRunFailure(toolName, outcome.exitCode, stderr.text, stderr.lossy);\n';
const fixture = 'function run(outcome, stderr, stdout, argv) {\nconst toolName="glob", workdir="/test";\n'
  + anchor + 'return {stdout: stdout.text, noMatches: outcome.exitCode === 1};\n}\n';
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tdh-search-'));
try {
  const kernel = path.join(root, 'lib/node_modules/@deepseek-ai/dsh');
  const target = path.join(kernel, 'node_modules/@deepseek-ai/dsh-tool-fs-search/lib/index.js');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(path.join(kernel, 'package.json'), '{"version":"0.1.2-rc.1"}');
  fs.writeFileSync(target, fixture);
  const apply = () => execFileSync(process.execPath,
    [path.join(__dirname, '../patches/apply-kernel-patches.js'), root, '--only', mark], { stdio: 'pipe' });
  apply();
  const source = fs.readFileSync(target, 'utf8');
  apply();
  assert.equal(fs.readFileSync(target, 'utf8'), source);
  const context = vm.createContext({ classifyRunFailure: () => Object.assign(new Error('search failed'), { code: 'SEARCH_FAILED' }) });
  vm.runInContext(source, context);
  const missing = (p, message = 'No such file or directory (os error 2)') =>
    `rg: ${p}: IO error for operation on ${p}: ${message}\n`;
  const run = (text, overrides = {}) => context.run({ exitCode: overrides.exitCode ?? 2 },
    { text, lossy: overrides.stderrLossy ?? false },
    { text: overrides.stdout ?? '', lossy: overrides.stdoutLossy ?? false },
    overrides.argv || ['--files', '--', 'missing']);
  for (const text of [missing('missing'), 'missing: No such file or directory (os error 2)\n', missing('missing', '\u7cfb\u7edf\u627e\u4e0d\u5230\u6307\u5b9a\u7684\u6587\u4ef6\u3002 (os error 2)')]) {
    assert.equal(run(text).noMatches, true);
  }
  const failures = [
    [missing('missing', 'Not a directory (os error 20)')],
    [missing('missing', 'Permission denied (os error 13)')],
    [missing('missing') + 'rg: private: Permission denied (os error 13)\n'],
    [missing('missing') + 'regex parse error: invalid pattern\n'],
    [missing('missing/child')], ['IO error: cannot find the file'], [''],
    [missing('missing'), { exitCode: 3 }],
    [missing('missing'), { stderrLossy: true }],
    [missing('missing'), { stdoutLossy: true }],
    [missing('missing'), { stdout: 'partial match\n' }],
    [missing('missing'), { argv: ['--files'] }],
  ];
  for (const [text, options] of failures) assert.throws(() => run(text, options), { code: 'SEARCH_FAILED' });
  assert.equal(run('', { exitCode: 1 }).noMatches, true);
  assert.equal(run('', { exitCode: 0, stdout: 'file.txt' }).stdout, 'file.txt');
  // A disabled predicate must be detected even if the marker remains present.
  vm.runInContext(source.replace('function companyRgPathMissing(stderr, argv) {',
    'function companyRgPathMissing(stderr, argv) { return true;'), context);
  assert.equal(run(missing('missing', 'Permission denied (os error 13)')).noMatches, true);
  vm.runInContext(source, context);
  const rg = process.env.TDH_TEST_RG || 'rg';
  const absent = path.join(root, 'missing folder');
  const result = spawnSync(rg, ['--files', '--', absent], { encoding: 'utf8', windowsHide: true });
  assert.ifError(result.error);
  assert.equal(result.status, 2, result.stderr);
  console.log('RG_MISSING_DIAGNOSTIC=' + JSON.stringify(result.stderr));
  assert.equal(run(result.stderr, { argv: ['--files', '--', absent] }).noMatches, true);
  fs.writeFileSync(target, fixture + '// company-glob-missing-root-v1\n');
  assert.throws(apply, (err) => String(err.stderr).includes('PATCH_FAIL=legacy-search-patch'));
  assert.equal(fs.readFileSync(target, 'utf8'), fixture + '// company-glob-missing-root-v1\n');
  console.log('SEARCH_ERRORS_PROVE_OK=1');
} finally {
  assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
  assert.ok(path.basename(root).startsWith('tdh-search-'));
  fs.rmSync(root, { recursive: true, force: true });
}
