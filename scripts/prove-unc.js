#!/usr/bin/env node
// Behavior proof for the real sandbox path helpers. No KERNEL_PREFIX required.
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const helpers = require('../patches/lib/network-path');

const cases = [
  ['UNC_BACKSLASH', String.raw`\\host\share`, true],
  ['UNC_FORWARD', '//host/share', true],
  ['UNC_NAMESPACED', String.raw`\\?\UNC\host\share`, true],
  ['LOCAL_WINDOWS', String.raw`C:\Users\dev\proj`, false],
  ['LOCAL_WINDOWS_NAMESPACED', String.raw`\\?\C:\Users\dev\proj`, false],
  ['LOCAL_POSIX', '/Users/dev/proj', false],
];

function proveHelpers(api) {
  for (const [name, input, network] of cases) {
    assert.equal(api.companyWorkspaceIsNetworkPath(input), network, name);
    if (network) {
      assert.throws(() => api.companyAssertLocalWorkspace(input), (err) =>
        err.code === 'COMPANY_WORKSPACE_NOT_LOCAL' && err.message.includes(input), name);
    } else {
      assert.doesNotThrow(() => api.companyAssertLocalWorkspace(input, { platform: 'linux' }), name);
    }
  }
  const cause = new Error('test grant failure');
  const error = api.companyGrantError('C:\\proj', cause);
  assert.equal(error.code, 'COMPANY_WORKSPACE_GRANT_FAILED');
  assert.equal(error.cause, cause);
}

// A minimal kernel fixture containing the two pinned patch anchors. Running
// the actual patcher catches a missing/misordered call as well as bad helpers.
// This is not a Windows ACL integration test; prove-patches checks the real pin.
const fixture = [
  'class Sandbox {',
  '\tmaterializeAclGrant(sessionId, workspaceRoot) {',
  '\t\tassertTempRootOutsideWorkspace(workspaceRoot, tmpdir());',
  '\t\t\tlet grant;',
  '\t\t\ttry {',
  '\t\t\t\tgrant = grantWorkspace(workspaceRoot);',
  '\t\t\t} catch (error) {',
  '\t\t\t\tthrow error;',
  '\t\t\t}',
  '\t\t\tthis.workspaceGrants.set(workspaceRoot, grant);',
  '\t}',
  '}',
  'globalThis.Sandbox = Sandbox;',
  '',
].join('\n');

function provePatchedSource(source, options = {}) {
  const calls = [];
  const context = vm.createContext({
    process: options.process || { platform: 'linux' },
    spawnSync: options.spawnSync,
    assertTempRootOutsideWorkspace: () => calls.push('temp-check'),
    tmpdir: () => '/tmp',
    grantWorkspace: () => { calls.push('grant'); return 'test-grant'; },
  });
  vm.runInContext(source, context);
  proveHelpers(context);
  const sandbox = new context.Sandbox();
  sandbox.workspaceGrants = new Map();
  for (const [name, input, network] of options.cases || cases) {
    calls.length = 0;
    if (network) {
      assert.throws(() => sandbox.materializeAclGrant('test', input),
        (err) => err.code === 'COMPANY_WORKSPACE_NOT_LOCAL', name);
      assert.deepEqual(calls, [], name + ': refused before side effects');
      assert.equal(sandbox.workspaceGrants.has(input), false, name);
    } else {
      sandbox.materializeAclGrant('test', input);
      assert.deepEqual(calls, ['temp-check', 'grant'], name);
      assert.equal(sandbox.workspaceGrants.get(input), 'test-grant', name);
    }
  }
}

// Optional integration check: execute the method extracted from the actual
// patched kernel. A sentinel stops local paths at the original first operation,
// so this checks ordering without granting ACLs or needing Windows privileges.
function proveKernelSource(source, options = {}) {
  const method = source.match(/^\tmaterializeAclGrant\(sessionId, workspaceRoot\) \{[\s\S]*?^\t\}/m);
  assert.ok(method, 'pinned materializeAclGrant method exists');
  const marker = '// --- company-sandbox-local-drive-v2';
  const helperStart = source.indexOf(marker);
  assert.ok(helperStart >= 0, 'sandbox helpers are embedded');
  const reachedOriginalOperation = new Error('reached original kernel operation');
  const context = vm.createContext({
    process: options.process || { platform: 'linux' },
    spawnSync: options.spawnSync,
    tmpdir: () => '/tmp',
    assertTempRootOutsideWorkspace: () => { throw reachedOriginalOperation; },
  });
  vm.runInContext(source.slice(helperStart) + '\n'
    + 'globalThis.sandbox = ({' + method[0] + '\n});', context);
  proveHelpers(context);
  for (const [name, input, network] of options.cases || cases) {
    assert.throws(() => context.sandbox.materializeAclGrant('test', input),
      (err) => network ? err.code === 'COMPANY_WORKSPACE_NOT_LOCAL' : err === reachedOriginalOperation,
      name + ': actual kernel method');
  }
  console.log('UNC_KERNEL_PROVE_OK=1');
}
function createPatchedFixture() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tdh-unc-'));
  try {
    const kernel = path.join(tmp, 'lib', 'node_modules', '@deepseek-ai', 'dsh');
    const target = path.join(kernel, 'node_modules', '@deepseek-ai', 'dsh-sandbox-local', 'lib', 'index.js');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(path.join(kernel, 'package.json'), '{}');
    fs.writeFileSync(target, fixture);
    const apply = () => execFileSync(process.execPath,
      [path.join(__dirname, '..', 'patches', 'apply-kernel-patches.js'),
        tmp, '--only', 'company-sandbox-local-drive-v2'], { stdio: 'pipe' });
    apply();
    const patched = fs.readFileSync(target, 'utf8');
    apply();
    assert.equal(fs.readFileSync(target, 'utf8'), patched, 'reapplying v2 is idempotent');
    const legacy = fixture + '\n// company-sandbox-local-unc-v1\n';
    fs.writeFileSync(target, legacy);
    assert.throws(apply, (err) => String(err.stderr).includes('PATCH_FAIL=legacy-sandbox-patch'));
    assert.equal(fs.readFileSync(target, 'utf8'), legacy, 'legacy prefix is left untouched');
    return patched;
  } finally {
    assert.equal(path.dirname(tmp), path.resolve(os.tmpdir()));
    assert.ok(path.basename(tmp).startsWith('tdh-unc-'));
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

if (require.main === module) {
  proveHelpers(helpers);
  const fileIdx = process.argv.indexOf('--sandbox-file');
  if (fileIdx >= 0) proveKernelSource(fs.readFileSync(process.argv[fileIdx + 1], 'utf8'));
  const patched = createPatchedFixture();
  provePatchedSource(patched);

  // Negative controls: prove this harness detects a disabled check and a
  // disconnected check, even when all patch marker comments remain present.
  const disabled = patched.replace('function companyWorkspaceIsNetworkPath(p) {',
    'function companyWorkspaceIsNetworkPath(p) { return false;');
  assert.notEqual(disabled, patched);
  assert.throws(() => provePatchedSource(disabled), { code: 'ERR_ASSERTION' });
  const disconnected = patched.replace('\t\tcompanyAssertLocalWorkspace(workspaceRoot);\n', '');
  assert.notEqual(disconnected, patched);
  assert.throws(() => provePatchedSource(disconnected), { code: 'ERR_ASSERTION' });
  console.log('UNC_PROVE_OK=1');
}

module.exports = { createPatchedFixture, provePatchedSource, proveKernelSource };
