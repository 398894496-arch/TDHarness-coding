#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const h = require('../patches/lib/network-path');
const { createPatchedFixture, provePatchedSource, proveKernelSource } = require('./prove-unc');

const local = { driveType: 3, target: String.raw`\Device\HarddiskVolume3`, queryError: 0 };
const remote = { driveType: 4, target: String.raw`\Device\LanmanRedirector\server\share`, queryError: 0 };
const subst = { driveType: 3, target: String.raw`\??\C:\example`, queryError: 0 };
const patched = createPatchedFixture();
const windows = { platform: 'win32', env: { SystemRoot: 'C:\\Windows' } };

for (const root of ['C:/proj', String.raw`\\?\C:\proj`, '//?/c:/proj']) {
  assert.equal(h.companyWindowsDriveRoot(root), 'C:');
  assert.doesNotThrow(() => h.companyAssertLocalWorkspace(root, { platform: 'win32', probe: () => local }));
}
for (const info of [remote, subst, { ...remote, target: '', queryError: 2 },
  { ...local, target: String.raw`\Device\Mup\server\share` }]) {
  for (const root of ['Z:/proj', String.raw`\\?\Z:\proj`]) {
    assert.throws(() => h.companyAssertLocalWorkspace(root, { platform: 'win32', probe: () => info }),
      { code: 'COMPANY_WORKSPACE_NOT_LOCAL' });
  }
  const options = { process: windows, spawnSync: () => ({ status: 0, stdout: JSON.stringify(info) }),
    cases: [['MAPPED_OR_SUBST', 'Z:/proj', true], ['NAMESPACED_ALIAS', String.raw`\\?\Z:\proj`, true]] };
  provePatchedSource(patched, options);
  // A disabled drive classifier must be caught even if all patch marks remain.
  const broken = patched.replace('function companyWindowsWorkspaceKind(p, probe = companyProbeWindowsDrive) {',
    "function companyWindowsWorkspaceKind(p, probe = companyProbeWindowsDrive) { return 'local';");
  assert.notEqual(broken, patched);
  assert.throws(() => provePatchedSource(broken, options), { code: 'ERR_ASSERTION' });
}

for (const info of [null, {}, { ...local, queryError: 5 }, { ...local, target: '' },
  { ...local, driveType: 0 }, { ...local, driveType: 1 }, { ...local, target: 'unrecognized' }]) {
  assert.throws(() => h.companyAssertLocalWorkspace('Z:/proj', { platform: 'win32', probe: () => info }),
    { code: 'COMPANY_WORKSPACE_PROBE_FAILED' });
}
assert.throws(() => h.companyAssertLocalWorkspace('C:relative', { platform: 'win32' }),
  { code: 'COMPANY_WORKSPACE_PROBE_FAILED' });
let probeCalls = 0;
h.companyAssertLocalWorkspace('/mnt/cifs/project', { platform: 'linux', probe: () => { probeCalls++; } });
assert.equal(probeCalls, 0, 'Linux mount detection remains C2b');
assert.throws(() => h.companyProbeWindowsDrive("C:';bad", () => { throw Error('must not spawn'); }), /Invalid drive/);

// Exercise the embedded process boundary: errors, timeouts, malformed responses
// must stop before the original ACL operation (whose sentinel throws otherwise).
for (const result of [undefined, { status: 1, stdout: '' },
  { status: null, error: Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' }) },
  { status: 0, stdout: 'not-json' }]) {
  assert.throws(() => h.companyProbeWindowsDrive('C:', () => result));
}
// Validation of JSON fields belongs to companyWindowsWorkspaceKind, not transport.
const vm = require('node:vm');
for (const result of [{ status: 1 }, { status: 0, stdout: '{}' }, { status: 0, stdout: 'not-json' },
  { status: null, error: new Error('timeout') }]) {
  let originalCalls = 0;
  const context = vm.createContext({ process: windows, spawnSync: () => result,
    tmpdir: () => '/tmp', assertTempRootOutsideWorkspace: () => { originalCalls++; } });
  vm.runInContext(patched, context);
  assert.throws(() => new context.Sandbox().materializeAclGrant('test', 'C:/proj'),
    (err) => err.code === 'COMPANY_WORKSPACE_PROBE_FAILED');
  assert.equal(originalCalls, 0);
}
console.log('WINDOWS_DRIVE_UNIT_OK=1');

if (process.platform !== 'win32') {
  console.log('WINDOWS_DRIVE_INTEGRATION_SKIP=requires-Windows');
  process.exit(0);
}

// Reserve an unused DOS device, including checking disconnected mappings.
// Never delete a pre-existing drive mapping or a mapping replaced by somebody else.
const nativeSubst = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'subst.exe');
let drive;
for (const letter of ['R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z']) {
  const info = h.companyProbeWindowsDrive(letter + ':');
  if (info.queryError === 2 && info.driveType === 1 && info.target === '') { drive = letter + ':'; break; }
}
assert.ok(drive, 'an unused DOS device is required for the SUBST integration test');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tdh-drive-'));
let ownsMapping = false;
try {
  execFileSync(nativeSubst, [drive, tmp], { windowsHide: true });
  ownsMapping = true;
  assert.equal(h.companyWindowsWorkspaceKind(drive + '\\'), 'subst');
  assert.equal(h.companyWindowsWorkspaceKind(tmp), 'local');
  const integrationCases = [
    ['REAL_SUBST', drive + '\\', true],
    ['REAL_NAMESPACED_SUBST', '\\\\?\\' + drive + '\\', true],
    ['REAL_LOCAL', tmp, false],
    ['REAL_NAMESPACED_LOCAL', '\\\\?\\' + tmp, false],
  ];
  if (process.env.TDH_TEST_MAPPED_ROOT) {
    assert.equal(h.companyWindowsWorkspaceKind(process.env.TDH_TEST_MAPPED_ROOT), 'mapped');
    integrationCases.push(['REAL_MAPPED', process.env.TDH_TEST_MAPPED_ROOT, true]);
  } else {
    console.log('MAPPED_DRIVE_INTEGRATION_SKIP=set-TDH_TEST_MAPPED_ROOT-to-an-existing-mapping');
  }
  const options = { process, spawnSync, cases: integrationCases };
  provePatchedSource(patched, options);
  const fileIdx = process.argv.indexOf('--sandbox-file');
  if (fileIdx >= 0) proveKernelSource(fs.readFileSync(process.argv[fileIdx + 1], 'utf8'), options);
  console.log('WINDOWS_DRIVE_PROVE_OK=1');
} finally {
  if (ownsMapping) {
    assert.equal(fs.realpathSync.native(drive + '\\'), fs.realpathSync.native(tmp),
      'mapping changed ownership; refusing to remove it');
    execFileSync(nativeSubst, [drive, '/d'], { windowsHide: true });
  }
  assert.equal(path.dirname(tmp), path.resolve(os.tmpdir()));
  assert.ok(path.basename(tmp).startsWith('tdh-drive-'));
  fs.rmSync(tmp, { recursive: true, force: true });
}
