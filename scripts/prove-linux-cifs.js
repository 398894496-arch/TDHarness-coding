#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const { companyAssertLinuxWorkspace } = require('../patches/lib/linux-cifs');
const mark = 'company-sandbox-linux-cifs-v1';

function proveLinuxKernelSource(source) {
  const method = source.match(/^\tconfine\(argv, policy\) \{[\s\S]*?^\t\}/m);
  assert.ok(method, 'real confine method present');
  const start = source.indexOf('// --- ' + mark);
  assert.ok(start >= 0, 'Linux helper embedded');
  for (const custom of [false, true]) {
    for (const type of [0xef53n, 0x794c7630n, 0xff534d42n, 0xfe534d42n, 0x517bn, BigInt.asIntN(32, 0xff534d42n)]) {
      const calls = [];
      const context = vm.createContext({
        process: { platform: 'linux' },
        companyStatfsSync: () => { calls.push('statfs'); return { type }; },
        bwrapProfileArgs: () => { calls.push('profile'); return []; },
        DENIAL_SIGNATURES: { runnerCommand: [], bwrap: [] }, RUNNER_FAILURE_RULES: { bwrap: [] },
      });
      vm.runInContext(source.slice(start) + '\nglobalThis.provider = ({' + method[0] + '\n});', context);
      const provider = context.provider;
      Object.defineProperty(provider, 'runnerCommand', { get() { calls.push('runner'); return custom ? ['custom'] : undefined; } });
      provider.selectRunner = () => { calls.push('select'); return { runner: 'bwrap', enforcement: 'full' }; };
      provider.runnerArgv = () => { calls.push('argv'); return ['bwrap']; };
      const policy = { mode: 'workspace-write', workspaceRoot: '/mnt/team' };
      if ([0xef53n, 0x794c7630n].includes(type)) {
        provider.confine(['true'], policy);
        assert.equal(calls[0], 'statfs');
        assert.ok(calls.includes(custom ? 'profile' : 'select'));
      } else {
        assert.throws(() => provider.confine(['true'], policy), (err) => err.code === 'COMPANY_WORKSPACE_NOT_LOCAL');
        assert.deepEqual(calls, ['statfs'], 'refuse before both runner paths');
      }
      calls.length = 0;
      provider.confine(['true'], { ...policy, mode: 'read-only' });
      assert.ok(!calls.includes('statfs'), 'read-only does not probe mounts');
      context.companyStatfsSync = () => { throw new Error('probe unavailable'); };
      calls.length = 0;
      assert.throws(() => provider.confine(['true'], policy), (err) => err.code === 'COMPANY_WORKSPACE_PROBE_FAILED');
      assert.deepEqual(calls, []);
    }
  }
}

function main() {
  const policy = { mode: 'workspace-write', workspaceRoot: '/mnt/team' };
  for (const response of [undefined, {}, { type: 'cifs' }, { type: 0xff534d42 }]) {
    assert.throws(() => companyAssertLinuxWorkspace(policy, 'linux', () => response), { code: 'COMPANY_WORKSPACE_PROBE_FAILED' });
  }
  for (const platform of ['win32', 'darwin']) {
    companyAssertLinuxWorkspace(policy, platform, () => { throw new Error('must not probe'); });
  }
  assert.throws(() => companyAssertLinuxWorkspace({ ...policy, workspaceRoot: 'relative' }, 'linux'), { code: 'COMPANY_WORKSPACE_PROBE_FAILED' });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tdh-cifs-'));
  try {
    const kernel = path.join(tmp, 'lib/node_modules/@deepseek-ai/dsh');
    const target = path.join(kernel, 'node_modules/@deepseek-ai/dsh-sandbox-local/lib/index.js');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(path.join(kernel, 'package.json'), '{"version":"0.1.2-rc.1"}');
    const fixture = 'import { spawnSync } from "node:child_process";\nclass Sandbox {\n'
      + '\tconfine(argv, policy) {\n'
      + '\t\tif (this.runnerCommand !== void 0) return bwrapProfileArgs(policy);\n'
      + '\t\treturn this.selectRunner(policy.mode);\n\t}\n}\n';
    fs.writeFileSync(target, fixture);
    const apply = () => execFileSync(process.execPath,
      [path.join(__dirname, '../patches/apply-kernel-patches.js'), tmp, '--only', mark], { stdio: 'pipe' });
    apply();
    const patched = fs.readFileSync(target, 'utf8');
    assert.match(patched, /import \{ statfsSync as companyStatfsSync \} from "node:fs";/);
    apply();
    assert.equal(fs.readFileSync(target, 'utf8'), patched);
    proveLinuxKernelSource(patched);
    const disconnected = patched.replace('\t\tcompanyAssertLinuxWorkspace(policy);\n', '');
    assert.notEqual(disconnected, patched);
    assert.throws(() => proveLinuxKernelSource(disconnected), { code: 'ERR_ASSERTION' });
    const fileIndex = process.argv.indexOf('--sandbox-file');
    if (fileIndex >= 0) {
      proveLinuxKernelSource(fs.readFileSync(process.argv[fileIndex + 1], 'utf8'));
      console.log('LINUX_CIFS_KERNEL_PROVE_OK=1');
    }
    if (process.platform === 'linux') {
      companyAssertLinuxWorkspace({ ...policy, workspaceRoot: tmp });
      const link = path.join(tmp, 'local-link');
      fs.symlinkSync(path.dirname(tmp), link);
      try { companyAssertLinuxWorkspace({ ...policy, workspaceRoot: link }); }
      finally { fs.unlinkSync(link); }
      assert.throws(() => companyAssertLinuxWorkspace({ ...policy, workspaceRoot: path.join(tmp, 'absent') }), { code: 'COMPANY_WORKSPACE_PROBE_FAILED' });
      if (process.env.TDH_TEST_CIFS_ROOT) {
        assert.throws(() => companyAssertLinuxWorkspace({ ...policy, workspaceRoot: process.env.TDH_TEST_CIFS_ROOT }), { code: 'COMPANY_WORKSPACE_NOT_LOCAL' });
        console.log('LINUX_CIFS_MOUNT_PROVE_OK=1');
      } else console.log('LINUX_CIFS_MOUNT_SKIP=no-existing-CIFS-root-provided');
      console.log('LINUX_STATFS_PROVE_OK=1');
    } else console.log('LINUX_STATFS_SKIP=requires-Linux');
    console.log('LINUX_CIFS_PROVE_OK=1');
  } finally {
    assert.equal(path.dirname(tmp), path.resolve(os.tmpdir()));
    assert.ok(path.basename(tmp).startsWith('tdh-cifs-'));
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
if (require.main === module) main();
module.exports = { proveLinuxKernelSource };
