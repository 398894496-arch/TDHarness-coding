#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');

const aclFixture = [
  'async function copyFileDaclWin32(source, destination) {',
  '\tconst descriptor = await readFileDaclWin32(source);',
  '\tconst api = await win32();',
  '\tif (api.setFileSecurityW(toNamespacedPath(destination), 2147483652, descriptor) === 0) throw win32Error("SetFileSecurityW", api.getLastError(), destination);',
  '}', '',
].join('\n');
const skillsFixture = [
  'class Skills {',
  '\tlist() { const roots = [];',
  '\t\troots.push(...this.customSkillDirs.map((path) => ({',
  '\t\t\tpath,',
  '\t\t\tsource: "custom",',
  '\t\t\trank: CUSTOM_RANK',
  '\t\t})));',
  '\treturn roots; }',
  '\tasync get(locator, candidate, options = {}) {',
  '\t\tconst parsed = await parseSkillFile(locator.path, this.ctx, options.signal, candidate.source === "bundled");',
  '\treturn parsed; }',
  '}', 'globalThis.Skills = Skills;', '',
].join('\n');

async function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tdh-privilege-'));
  try {
    const kernel = path.join(tmp, 'lib/node_modules/@deepseek-ai/dsh');
    const target = (pkg) => path.join(kernel, 'node_modules/@deepseek-ai', pkg, 'lib/index.js');
    for (const [pkg, content] of [['dsh-fs-local', aclFixture], ['dsh-skill-filesystem', skillsFixture]]) {
      fs.mkdirSync(path.dirname(target(pkg)), { recursive: true });
      fs.writeFileSync(target(pkg), content);
    }
    fs.writeFileSync(path.join(kernel, 'package.json'), '{"version":"0.1.2-rc.1"}');
    const apply = (marks) => execFileSync(process.execPath,
      [path.join(__dirname, '../patches/apply-kernel-patches.js'), tmp, '--only', marks], { stdio: 'pipe' });
    const mark = 'company-fs-unc-acl-v2';
    apply(mark);
    const source = fs.readFileSync(target('dsh-fs-local'), 'utf8');
    apply(mark);
    assert.equal(fs.readFileSync(target('dsh-fs-local'), 'utf8'), source);
    const unc = String.raw`\\server.example\share\file`;
    const local = String.raw`C:\file`;
    let reads = 0, writes = 0, readError, setError = 0;
    const context = vm.createContext({
      readFileDaclWin32: async () => { reads++; if (readError) throw readError; return 'descriptor'; },
      win32: async () => ({ setFileSecurityW: () => { writes++; return setError ? 0 : 1; }, getLastError: () => setError }),
      toNamespacedPath: (p) => p,
      win32Error: (_name, code) => Object.assign(new Error('native failure'), { win32Code: code }),
    });
    vm.runInContext(source, context);
    for (const p of [unc, '//server/share/file', String.raw`\\?\UNC\server\share\file`]) {
      assert.equal(context.companyFsIsUnc(p), true);
      reads = writes = 0;
      await context.copyFileDaclWin32(p, unc);
      assert.equal(reads + writes, 0, 'UNC-only pair retains the share exception');
    }
    for (const p of [local, String.raw`\\?\C:\file`, String.raw`\\.\C:\file`, '\\\\server']) {
      assert.equal(context.companyFsIsUnc(p), false, p);
      for (const pair of [[p, p], [p, unc], [unc, p]]) {
        reads = writes = 0; setError = 0; readError = undefined;
        await context.copyFileDaclWin32(...pair);
        assert.equal(reads, 1); assert.equal(writes, 1);
        for (const code of [5, 32]) {
          setError = code;
          await assert.rejects(context.copyFileDaclWin32(...pair), (e) => e.win32Code === code);
        }
        setError = 0;
        for (const error of [Object.assign(new Error('read denied'), { code: 'EACCES' }), Object.assign(new Error('read denied'), { win32Code: 5 })]) {
          readError = error;
          await assert.rejects(context.copyFileDaclWin32(...pair), (e) => e === error);
        }
      }
    }
    // Prove the trusted-host flags are a deliberate privilege boundary.
    apply('company-skill-custom-trusted-v1,company-skill-get-custom-trusted-v1');
    const skillContext = vm.createContext({ CUSTOM_RANK: 1, parseSkillFile: async (p, _ctx, _signal, trusted) => ({ p, trusted }) });
    vm.runInContext(fs.readFileSync(target('dsh-skill-filesystem'), 'utf8'), skillContext);
    const provider = new skillContext.Skills();
    provider.customSkillDirs = ['/outside-workspace/admin-skills'];
    assert.equal(provider.list()[0].trustedHost, true);
    assert.equal((await provider.get({ path: '/outside-workspace/admin-skills/SKILL.md' }, { source: 'custom' })).trusted, true);
    assert.equal((await provider.get({ path: '/workspace/SKILL.md' }, { source: 'workspace' })).trusted, false);
    for (const file of ['setup.sh', 'setup.ps1']) {
      const text = fs.readFileSync(path.join(__dirname, file), 'utf8');
      const list = text.match(/(?:CODING_MARKS|\$CodingMarks)\s*=\s*"([^"]+)"/);
      assert.ok(list, 'coding marks must be explicit');
      for (const privileged of ['company-skill-custom-trusted-v1', 'company-skill-get-custom-trusted-v1', mark, 'company-fs-unc-acl-v1']) {
        assert.ok(!list[1].split(',').includes(privileged), file + ': privileged mark excluded');
      }
    }
    fs.writeFileSync(target('dsh-fs-local'), aclFixture + '// company-fs-unc-acl-v1\n');
    assert.throws(() => apply(mark), (err) => String(err.stderr).includes('PATCH_FAIL=legacy-acl-patch'));
    assert.equal(fs.readFileSync(target('dsh-fs-local'), 'utf8'), aclFixture + '// company-fs-unc-acl-v1\n');
    console.log('PRIVILEGE_PATCHES_PROVE_OK=1');
  } finally {
    assert.equal(path.dirname(tmp), path.resolve(os.tmpdir()));
    assert.ok(path.basename(tmp).startsWith('tdh-privilege-'));
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
main().catch((err) => { console.error(err); process.exitCode = 1; });
