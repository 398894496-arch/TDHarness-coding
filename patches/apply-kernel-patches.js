#!/usr/bin/env node
// Shape a pinned @deepseek-ai/dsh prefix. Coding-tree patches, not a live hot fix.
//
// Run against a prefix you own, after `npm install -g --prefix` and before
// `dsh` uses it. Never point this at a running node_modules.
//
// Why anchored edits and not a vendored copy of the whole file: a full-file
// copy silently reverts every upstream fix the next time the kernel is bumped,
// and nothing reports it. Here an anchor that no longer matches is a hard
// failure, so a kernel bump forces someone to look at the patch again.
//
// usage: node patches/apply-kernel-patches.js <prefix>
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const prefix = process.argv[2];
if (!prefix) {
  console.error('usage: apply-kernel-patches.js <prefix> [--only <mark>]');
  process.exit(2);
}
const onlyIdx = process.argv.indexOf('--only');
const onlyMark = onlyIdx >= 0 ? String(process.argv[onlyIdx + 1] || '') : '';

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
refuseLivePrefix(prefix);

// npm lays the tree out differently on Windows than on macOS/Linux.
const CANDIDATE_ROOTS = [
  path.join(prefix, 'lib', 'node_modules', '@deepseek-ai', 'dsh'),
  path.join(prefix, 'node_modules', '@deepseek-ai', 'dsh'),
];

function resolveKernelRoot() {
  for (const root of CANDIDATE_ROOTS) {
    if (fs.existsSync(path.join(root, 'package.json'))) return root;
  }
  console.error('PATCH_FAIL=kernel-not-found|' + CANDIDATE_ROOTS.join(' , '));
  process.exit(1);
}

const MARK = 'company-sandbox-local-unc-v1';
const SKILL_MARK = 'company-skill-custom-trusted-v1';

const HELPERS = `

// --- ${MARK} (company patch; see scripts/p-product-base/apply-kernel-patches.js) ---
function companyWorkspaceIsNetworkPath(p) {
	return typeof p === "string" && (p.startsWith("\\\\\\\\") || p.startsWith("//"));
}
function companyWorkspaceHint(workspaceRoot) {
	return "workspace-write confinement is granted by an NTFS ACL on the volume that holds the workspace. "
		+ "\\"" + workspaceRoot + "\\" is not on a local volume, so there is no volume here to grant on and this "
		+ "sandbox cannot confine anything on it. Put the agent workspace on a local disk and mount the company "
		+ "share separately: the share is access-controlled on the server (per-person SMB account plus per-dept "
		+ "NTFS ACL), not by this sandbox.";
}
function companyAssertLocalWorkspace(workspaceRoot) {
	if (!companyWorkspaceIsNetworkPath(workspaceRoot)) return;
	const err = new Error("sandbox-local: refusing workspace-write on a network workspace. " + companyWorkspaceHint(workspaceRoot));
	err.code = "COMPANY_WORKSPACE_NOT_LOCAL";
	throw err;
}
function companyGrantError(workspaceRoot, cause) {
	// Mapped network drives look like a normal drive letter, so the path check
	// above cannot catch them; they surface here instead. State the hint as a
	// likely cause rather than a verdict, and keep the original error.
	const err = new Error(
		"sandbox-local: windows-acl workspace grant failed for \\"" + workspaceRoot + "\\". "
		+ "If this workspace is on a mapped network drive or a UNC path, that is the likely cause: "
		+ companyWorkspaceHint(workspaceRoot),
		{ cause }
	);
	err.code = "COMPANY_WORKSPACE_GRANT_FAILED";
	return err;
}
`;

const PATCHES = [
  {
    file: path.join('node_modules', '@deepseek-ai', 'dsh-sandbox-local', 'lib', 'index.js'),
    mark: MARK,
    append: HELPERS,
    edits: [
      {
        name: 'materializeAclGrant-precheck',
        // Anchors run to the line terminator on purpose. Without the trailing
        // newline an upstream edit that only appends to the anchored line still
        // matches, and the patch lands against source it was never reviewed
        // against.
        from:
          '\tmaterializeAclGrant(sessionId, workspaceRoot) {\n' +
          '\t\tassertTempRootOutsideWorkspace(workspaceRoot, tmpdir());\n',
        to:
          '\tmaterializeAclGrant(sessionId, workspaceRoot) {\n' +
          '\t\tcompanyAssertLocalWorkspace(workspaceRoot);\n' +
          '\t\tassertTempRootOutsideWorkspace(workspaceRoot, tmpdir());\n',
      },
      {
        name: 'workspace-grant-diagnosis',
        from:
          '\t\t\t\tthrow error;\n' +
          '\t\t\t}\n' +
          '\t\t\tthis.workspaceGrants.set(workspaceRoot, grant);\n',
        to:
          '\t\t\t\tthrow companyGrantError(workspaceRoot, error);\n' +
          '\t\t\t}\n' +
          '\t\t\tthis.workspaceGrants.set(workspaceRoot, grant);\n',
      },
    ],
  },
  {
    // customSkillDirs are provisioned by overlay (company _skills on the
    // share). The plugin otherwise lists them through ctx.fs, which is the
    // workspace sandbox: a UNC path outside emp-* is FS_NOT_FOUND, so the
    // skill tool catalog stays empty even when NTFS grants read. bundled
    // roots already set trustedHost and go through Node fs; custom roots
    // need the same, or the share-root pack is unreachable from an
    // employee workspace.
    file: path.join('node_modules', '@deepseek-ai', 'dsh-skill-filesystem', 'lib', 'index.js'),
    mark: SKILL_MARK,
    append:
      '\n// --- ' + SKILL_MARK + ' (company patch; see scripts/p-product-base/apply-kernel-patches.js) ---\n',
    edits: [
      {
        name: 'custom-dirs-trusted-host',
        from:
          '\t\troots.push(...this.customSkillDirs.map((path) => ({\n' +
          '\t\t\tpath,\n' +
          '\t\t\tsource: "custom",\n' +
          '\t\t\trank: CUSTOM_RANK\n' +
          '\t\t})));\n',
        to:
          '\t\troots.push(...this.customSkillDirs.map((path) => ({\n' +
          '\t\t\tpath,\n' +
          '\t\t\tsource: "custom",\n' +
          '\t\t\trank: CUSTOM_RANK,\n' +
          '\t\t\ttrustedHost: true\n' +
          '\t\t})));\n',
      },
    ],
  },
  {
    // list() can see a trustedHost custom root, but get() still read through
    // ctx.fs and treated the UNC / install-dir pack as absent. Same error
    // the model reports: skill "..." is unknown or no longer available.
    file: path.join('node_modules', '@deepseek-ai', 'dsh-skill-filesystem', 'lib', 'index.js'),
    mark: 'company-skill-get-custom-trusted-v1',
    append:
      '\n// --- company-skill-get-custom-trusted-v1 (company patch; see scripts/p-product-base/apply-kernel-patches.js) ---\n',
    edits: [
      {
        name: 'get-custom-trusted-host',
        from:
          '\t\tconst parsed = await parseSkillFile(locator.path, this.ctx, options.signal, candidate.source === "bundled");\n',
        to:
          '\t\tconst parsed = await parseSkillFile(locator.path, this.ctx, options.signal, candidate.source === "bundled" || candidate.source === "custom");\n',
      },
    ],
  },
  {
    // One unreadable custom root (SMB EACCES) used to throw out of list()
    // and skip the whole filesystem provider, so bundled / workspace packs
    // never reached available_skills.
    file: path.join('node_modules', '@deepseek-ai', 'dsh-skill-filesystem', 'lib', 'index.js'),
    mark: 'company-skill-root-eacces-v1',
    append:
      '\n// --- company-skill-root-eacces-v1 (company patch; see scripts/p-product-base/apply-kernel-patches.js) ---\n',
    edits: [
      {
        name: 'node-list-eacces-empty',
        from:
          '\t} catch (error) {\n' +
          '\t\t/* v8 ignore else -- Native non-absence directory failures are provider-dependent; the ctx.fs path pins incomplete discovery. */\n' +
          '\t\tif (isAbsentSkillPathError(error)) return [];\n' +
          '\t\t/* v8 ignore next -- Same native error branch as above. */\n' +
          '\t\tthrow error;\n' +
          '\t}\n',
        to:
          '\t} catch (error) {\n' +
          '\t\t/* v8 ignore else -- Native non-absence directory failures are provider-dependent; the ctx.fs path pins incomplete discovery. */\n' +
          '\t\tif (isAbsentSkillPathError(error) || hasErrorCode(error, "EACCES") || hasErrorCode(error, "EPERM")) return [];\n' +
          '\t\t/* v8 ignore next -- Same native error branch as above. */\n' +
          '\t\tthrow error;\n' +
          '\t}\n',
      },
    ],
  },
  {
    // Company SMB (UNC) cannot take a copied DACL. Official write stages a
    // temp file then SetFileSecurityW; Win32 5 on \\host\share aborts the
    // whole Edit/Write even though the bytes already landed. Skip the ACL
    // copy on UNC and treat ACCESS_DENIED as "inherit from the share".
    file: path.join('node_modules', '@deepseek-ai', 'dsh-fs-local', 'lib', 'index.js'),
    mark: 'company-fs-unc-acl-v1',
    append:
      '\n// --- company-fs-unc-acl-v1 (company patch; see scripts/p-product-base/apply-kernel-patches.js) ---\n' +
      'function companyFsIsUnc(p) {\n' +
      '\tconst s = String(p || "").replace(/\\//g, "\\\\");\n' +
      '\treturn s.startsWith("\\\\\\\\") || s.startsWith("\\\\\\\\?\\\\UNC\\\\");\n' +
      '}\n',
    edits: [
      {
        name: 'copy-dacl-unc-skip',
        from:
          'async function copyFileDaclWin32(source, destination) {\n' +
          '\tconst descriptor = await readFileDaclWin32(source);\n' +
          '\tconst api = await win32();\n' +
          '\tif (api.setFileSecurityW(toNamespacedPath(destination), 2147483652, descriptor) === 0) throw win32Error("SetFileSecurityW", api.getLastError(), destination);\n' +
          '}\n',
        to:
          'async function copyFileDaclWin32(source, destination) {\n' +
          '\tif (companyFsIsUnc(source) || companyFsIsUnc(destination)) return;\n' +
          '\ttry {\n' +
          '\t\tconst descriptor = await readFileDaclWin32(source);\n' +
          '\t\tconst api = await win32();\n' +
          '\t\tif (api.setFileSecurityW(toNamespacedPath(destination), 2147483652, descriptor) === 0) {\n' +
          '\t\t\tconst code = api.getLastError();\n' +
          '\t\t\tif (code === ERROR_ACCESS_DENIED) return;\n' +
          '\t\t\tthrow win32Error("SetFileSecurityW", code, destination);\n' +
          '\t\t}\n' +
          '\t} catch (error) {\n' +
          '\t\tif (error && (error.win32Code === ERROR_ACCESS_DENIED || error.code === "EACCES")) return;\n' +
          '\t\tthrow error;\n' +
          '\t}\n' +
          '}\n',
      },
    ],
  },
  {
    // Official publish of an existing file uses ReplaceFileW. Company SMB
    // often returns Win32 5, so Edit of an old UNC file fails while create
    // still works. Skip ReplaceFileW on UNC and fall back to rename on EACCES.
    file: path.join('node_modules', '@deepseek-ai', 'dsh-fs-local', 'lib', 'index.js'),
    mark: 'company-fs-unc-replace-v1',
    append:
      '\n// --- company-fs-unc-replace-v1 (company patch; see scripts/p-product-base/apply-kernel-patches.js) ---\n',
    edits: [
      {
        name: 'unc-skip-replacefilew',
        from:
          '\t\telse if (platform === "win32" && mode !== void 0) try {\n' +
          '\t\t\tawait replaceFile(absolutePath, tempPath);\n' +
          '\t\t} catch (error) {\n' +
          '\t\t\tif (!isENOENT(error)) throw error;\n' +
          '\t\t\tawait rename(tempPath, absolutePath);\n' +
          '\t\t}\n',
        to:
          '\t\telse if (platform === "win32" && mode !== void 0) try {\n' +
          '\t\t\tconst unc = String(absolutePath || "").replace(/\\//g, "\\\\").startsWith("\\\\\\\\");\n' +
          '\t\t\tif (unc) await rename(tempPath, absolutePath);\n' +
          '\t\t\telse await replaceFile(absolutePath, tempPath);\n' +
          '\t\t} catch (error) {\n' +
          '\t\t\tif (!isENOENT(error) && !(error && (error.code === "EACCES" || error.win32Code === 5))) throw error;\n' +
          '\t\t\tawait rename(tempPath, absolutePath);\n' +
          '\t\t}\n',
      },
    ],
  },
  {
    // Model retries resume on a goal that is already the live armed one.
    // Official throws GOAL_INVALID_TRANSITION and the turn dies. Resume of
    // an already-armed goal is a no-op.
    file: path.join('node_modules', '@deepseek-ai', 'dsh-goal', 'lib', 'index.js'),
    mark: 'company-goal-resume-armed-v1',
    append:
      '\n// --- company-goal-resume-armed-v1 (company patch; see scripts/p-product-base/apply-kernel-patches.js) ---\n',
    edits: [
      {
        name: 'resume-already-armed-noop',
        from:
          '\t\t\tif (current.phase === "active" && cache.activation === "armed") throw new GoalError(`goal "${current.id}" is already active and armed`, "GOAL_INVALID_TRANSITION");\n',
        to:
          '\t\t\tif (current.phase === "active" && cache.activation === "armed") {\n' +
          '\t\t\t\tconst view = this.view(cache);\n' +
          '\t\t\t\tif (view === void 0) throw new GoalError(`goal "${current.id}" is already active and armed`, "GOAL_INVALID_TRANSITION");\n' +
          '\t\t\t\treturn view;\n' +
          '\t\t\t}\n',
      },
    ],
  },
  {
    // Node 22 fs.symlinkSync(..., "junction") still uses CreateSymbolicLinkW
    // on some builds, which is EPERM without Developer Mode. cmd mklink /J
    // is a real NTFS junction and does not need that privilege. Employee
    // desks boot with cwd on the company share; this must still work.
    file: path.join('node_modules', '@deepseek-ai', 'dsh-app-boot', 'lib', 'index.js'),
    mark: 'company-win-junction-mklink-v3',
    already: ['company-win-junction-mklink-v2', 'company-win-junction-mklink-v3'],
    append:
      '\n// --- company-win-junction-mklink-v3 (company patch; see scripts/p-product-base/apply-kernel-patches.js) ---\n',
    edits: [
      {
        name: 'win-junction-mklink',
        // Official ensureSymlink (rc.2). v1/v2 already-applied is skipped
        // via `already`. Do not require packing on Windows.
        from:
          'function ensureSymlink(link, target) {\n' +
          '\tlet stat;\n' +
          '\ttry {\n' +
          '\t\tstat = lstatSync(link);\n' +
          '\t} catch {\n' +
          '\t\tstat = void 0;\n' +
          '\t}\n' +
          '\tif (stat !== void 0) {\n' +
          '\t\tif (!stat.isSymbolicLink()) throw new Error(`dsh: ${link} exists and is not a symlink; remove it so dsh can manage the installation fallback`);\n' +
          '\t\tif (readlinkSync(link) === target) return;\n' +
          '\t\tunlinkSync(link);\n' +
          '\t}\n' +
          '\ttry {\n' +
          '\t\tsymlinkSync(target, link, "junction");\n' +
          '\t} catch (error) {\n' +
          '\t\t/* v8 ignore next 4 */\n' +
          '\t\tif (error.code !== "EEXIST" || !lstatSync(link).isSymbolicLink() || readlinkSync(link) !== target) throw error;\n' +
          '\t}\n' +
          '}\n',
        to:
          'function companyWinJunction(link, target) {\n' +
          '\tconst { spawnSync } = createRequire(import.meta.url)("node:child_process");\n' +
          '\tmkdirSync(dirname(link), { recursive: true });\n' +
          '\tconst r = spawnSync("cmd.exe", ["/c", "mklink", "/J", link, target], { encoding: "utf8", windowsHide: true });\n' +
          '\treturn r.status === 0;\n' +
          '}\n' +
          'function ensureSymlink(link, target) {\n' +
          '\tlet stat;\n' +
          '\ttry {\n' +
          '\t\tstat = lstatSync(link);\n' +
          '\t} catch {\n' +
          '\t\tstat = void 0;\n' +
          '\t}\n' +
          '\tif (stat !== void 0) {\n' +
          '\t\tif (!stat.isSymbolicLink()) throw new Error(`dsh: ${link} exists and is not a symlink; remove it so dsh can manage the installation fallback`);\n' +
          '\t\tif (readlinkSync(link) === target) return;\n' +
          '\t\tunlinkSync(link);\n' +
          '\t}\n' +
          '\tif (process.platform === "win32") {\n' +
          '\t\tif (companyWinJunction(link, target)) return;\n' +
          '\t\tthrow new Error("dsh: win-junction-failed " + link + " -> " + target);\n' +
          '\t}\n' +
          '\ttry {\n' +
          '\t\tsymlinkSync(target, link, "junction");\n' +
          '\t} catch (error) {\n' +
          '\t\tif (error.code === "EEXIST" && readlinkSync(link) === target) return;\n' +
          '\t\t/* v8 ignore next 4 */\n' +
          '\t\tif (error.code !== "EEXIST" || !lstatSync(link).isSymbolicLink() || readlinkSync(link) !== target) throw error;\n' +
          '\t}\n' +
          '}\n',
      },
    ],
  },
  {
    // cmd.exe refuses UNC as cwd ("CMD does not support UNC paths as
    // current directories"). AppHost starts the desk with WorkingDirectory
    // on the company share, so mklink inherited that and returned 1.
    file: path.join('node_modules', '@deepseek-ai', 'dsh-app-boot', 'lib', 'index.js'),
    mark: 'company-win-junction-mklink-v4',
    already: ['company-win-junction-mklink-v4'],
    append:
      '\n// --- company-win-junction-mklink-v4 (company patch; see scripts/p-product-base/apply-kernel-patches.js) ---\n',
    edits: [
      {
        name: 'win-junction-mklink-local-cwd',
        from:
          '\tconst r = spawnSync("cmd.exe", ["/c", "mklink", "/J", link, target], { encoding: "utf8", windowsHide: true });\n',
        to:
          '\tconst r = spawnSync("cmd.exe", ["/c", "mklink", "/J", link, target], { encoding: "utf8", windowsHide: true, cwd: process.env.SystemRoot || "C:\\\\Windows" });\n',
      },
    ],
  },
  {
    // rg exit 2 + "IO error ... os error 2" means the search root is gone
    // (broken junction, leftover prefix path). Official maps that to a
    // hard SEARCH_FAILED. Empty result lets the model continue.
    file: path.join('node_modules', '@deepseek-ai', 'dsh-tool-fs-search', 'lib', 'index.js'),
    mark: 'company-glob-missing-root-v1',
    append:
      '\n// --- company-glob-missing-root-v1 (company patch; see scripts/p-product-base/apply-kernel-patches.js) ---\n' +
      'function companyRgPathMissing(stderr) {\n' +
      '\tconst t = String(stderr || "");\n' +
      '\treturn /IO error/i.test(t) && (/os error 2/i.test(t) || t.includes("\\u7cfb\\u7edf\\u627e\\u4e0d\\u5230\\u6307\\u5b9a\\u7684\\u6587\\u4ef6") || /cannot find the (file|path)/i.test(t));\n' +
      '}\n',
    edits: [
      {
        name: 'rg-missing-root-empty',
        from:
          '\tif (outcome.exitCode !== 0 && outcome.exitCode !== 1) throw classifyRunFailure(toolName, outcome.exitCode, stderr.text, stderr.lossy);\n',
        to:
          '\tif (outcome.exitCode !== 0 && outcome.exitCode !== 1) {\n' +
          '\t\tif (companyRgPathMissing(stderr.text)) return {\n' +
          '\t\t\tstdout: "",\n' +
          '\t\t\tnoMatches: true,\n' +
          '\t\t\tworkdir\n' +
          '\t\t};\n' +
          '\t\tthrow classifyRunFailure(toolName, outcome.exitCode, stderr.text, stderr.lossy);\n' +
          '\t}\n',
      },
    ],
  },
  {
    // Official new-session publish is fs.link(tmp, final). macOS smbfs
    // returns ENOTSUP (hard links). Win uses MoveFileExW so it does not
    // hit this. Same-volume rename works on the share. Directory fsync
    // after a successful publish can also ENOTSUP; swallow that or the
    // next line still dies.
    file: path.join('node_modules', '@deepseek-ai', 'dsh-session-persistence-jsonl', 'lib', 'index.js'),
    mark: 'company-session-smbfs-rename-v1',
    append:
      '\n// --- company-session-smbfs-rename-v1 (company patch; see scripts/p-product-base/apply-kernel-patches.js) ---\n',
    edits: [
      {
        name: 'import-rename',
        from:
          'import { link, mkdir, mkdtemp, open, readFile, readdir, realpath, rm, stat, truncate } from "node:fs/promises";\n',
        to:
          'import { link, mkdir, mkdtemp, open, readFile, readdir, realpath, rename, rm, stat, truncate } from "node:fs/promises";\n',
      },
      {
        name: 'link-fallback-rename',
        from:
          '\t\tlet linked = false;\n' +
          '\t\ttry {\n' +
          '\t\t\tawait link(tmp, finalPath);\n' +
          '\t\t\tlinked = true;\n' +
          '\t\t} finally {\n' +
          '\t\t\t/* v8 ignore next -- link failure is the TOCTOU/IO race guarded above; not reachable in test */\n' +
          '\t\t\tif (!linked) await rm(tmp, { force: true });\n' +
          '\t\t}\n',
        to:
          '\t\tlet linked = false;\n' +
          '\t\ttry {\n' +
          '\t\t\ttry {\n' +
          '\t\t\t\tawait link(tmp, finalPath);\n' +
          '\t\t\t} catch (error) {\n' +
          '\t\t\t\tif (error && (error.code === "ENOTSUP" || error.code === "EXDEV")) {\n' +
          '\t\t\t\t\tawait rename(tmp, finalPath);\n' +
          '\t\t\t\t} else throw error;\n' +
          '\t\t\t}\n' +
          '\t\t\tlinked = true;\n' +
          '\t\t} finally {\n' +
          '\t\t\t/* v8 ignore next -- link failure is the TOCTOU/IO race guarded above; not reachable in test */\n' +
          '\t\t\tif (!linked) await rm(tmp, { force: true });\n' +
          '\t\t}\n',
      },
      {
        name: 'syncdir-enotsup',
        from:
          '\tasync syncDirPosix(dir) {\n' +
          '\t\tconst handle = await open(dir, "r");\n' +
          '\t\ttry {\n' +
          '\t\t\tawait handle.sync();\n' +
          '\t\t} finally {\n' +
          '\t\t\tawait handle.close();\n' +
          '\t\t}\n' +
          '\t}\n',
        to:
          '\tasync syncDirPosix(dir) {\n' +
          '\t\tconst handle = await open(dir, "r");\n' +
          '\t\ttry {\n' +
          '\t\t\tawait handle.sync();\n' +
          '\t\t} catch (error) {\n' +
          '\t\t\tif (!error || (error.code !== "ENOTSUP" && error.code !== "EINVAL")) throw error;\n' +
          '\t\t} finally {\n' +
          '\t\t\tawait handle.close();\n' +
          '\t\t}\n' +
          '\t}\n',
      },
    ],
  },
];

const kernelRoot = resolveKernelRoot();
console.log('PATCH_KERNEL_ROOT=' + kernelRoot);

let applied = 0;
let skipped = 0;

for (const patch of PATCHES) {
  if (onlyMark && patch.mark !== onlyMark) continue;
  const target = path.join(kernelRoot, patch.file);
  if (!fs.existsSync(target)) {
    console.error('PATCH_FAIL=target-missing|' + target);
    process.exit(1);
  }
  let text = fs.readFileSync(target, 'utf8');

  const already = [patch.mark].concat(patch.already || []);
  if (already.some((m) => m && text.includes(m))) {
    console.log('PATCH_ALREADY=' + patch.file + '|' + already.find((m) => text.includes(m)));
    skipped += 1;
    continue;
  }
  if (patch.winOnly && process.platform !== 'win32') {
    console.log('PATCH_SKIP_PLATFORM=' + patch.file + '|' + patch.mark);
    skipped += 1;
    continue;
  }

  for (const edit of patch.edits) {
    const hits = text.split(edit.from).length - 1;
    if (hits !== 1) {
      // The kernel moved. Do not guess -- a patch that half-applies to a
      // sandbox is worse than one that refuses to apply at all.
      console.error(
        'PATCH_FAIL=anchor-not-unique|' + patch.file + '|' + edit.name +
        '|expected=1|got=' + hits +
        '|kernel bumped? re-review this patch against the new source'
      );
      process.exit(1);
    }
    text = text.replace(edit.from, edit.to);
  }
  text = text.trimEnd() + '\n' + patch.append;

  fs.writeFileSync(target, text, 'utf8');
  try {
    execFileSync(process.execPath, ['--check', target], { stdio: 'pipe' });
  } catch (err) {
    console.error('PATCH_FAIL=syntax|' + patch.file + '|' + String(err.stderr || err));
    process.exit(1);
  }
  console.log('PATCHED=' + patch.file + '|' + patch.edits.map((e) => e.name).join(','));
  applied += 1;
}

if (onlyMark) {
  console.log('PATCH_APPLIED=' + applied);
  console.log('PATCH_SKIPPED=' + skipped);
  console.log('KERNEL_PATCHES_OK=1');
  process.exit(applied + skipped > 0 ? 0 : 1);
}

const presetRel = path.join('config', 'agent-presets', 'standard', 'agent.cordis.yml');
const presetPath = path.join(kernelRoot, presetRel);
const PRESET_MARK = 'company-preset-skills-v1';
const PRESET_FROM = "- id: skill-filesystem\n  name: '@deepseek-ai/dsh-skill-filesystem'\n";
const PRESET_TO =
  "- id: skill-filesystem\n" +
  "  name: '@deepseek-ai/dsh-skill-filesystem'\n" +
  "  config:\n" +
  "    includeDefaultRoots: false\n" +
  "    watch: false\n" +
  "    bundledSkillDir: __DESK_SKILLS__\n" +
  "    customSkillDirs:\n" +
  "      - __DESK_SKILLS__\n" +
  "# --- " + PRESET_MARK + " ---\n";
if (!fs.existsSync(presetPath)) {
  console.error('PATCH_FAIL=preset-missing|' + presetPath);
  process.exit(1);
}
{
  let preset = fs.readFileSync(presetPath, 'utf8');
  if (preset.includes(PRESET_MARK)) {
    console.log('PATCH_ALREADY=' + presetRel + '|' + PRESET_MARK);
    skipped += 1;
  } else {
    const hits = preset.split(PRESET_FROM).length - 1;
    if (hits !== 1) {
      console.error('PATCH_FAIL=preset-anchor|' + presetRel + '|expected=1|got=' + hits);
      process.exit(1);
    }
    preset = preset.replace(PRESET_FROM, PRESET_TO);
    fs.writeFileSync(presetPath, preset, 'utf8');
    console.log('PATCHED=' + presetRel + '|preset-skills');
    applied += 1;
  }
}

// Host overlay `tool-web.fetch: true` does not register the model tool.
// `web_fetch` is owned by the session preset; official standard/code keep
// `fetch: false`. Pin the product prefix so dump-config session tools
// actually contain web_fetch.
function pinPresetFetch(presetRel) {
  const presetPath = path.join(kernelRoot, presetRel);
  const mark = 'company-preset-web-fetch-v1';
  const mark2 = 'company-preset-web-fetch-v2';
  if (!fs.existsSync(presetPath)) {
    console.log('PRESET_FETCH_SKIP=' + presetRel + '|missing');
    return;
  }
  let text = fs.readFileSync(presetPath, 'utf8');
  const want =
    "- id: tool-web\n" +
    "  name: '@deepseek-ai/dsh-tool-web'\n" +
    "  config:\n" +
    "    fetch: true\n" +
    "    searchTimeoutMs: 60000\n" +
    "    fetchTimeoutMs: 90000\n";
  if (text.includes(mark2) && text.includes('fetchTimeoutMs: 90000')) {
    console.log('PATCH_ALREADY=' + presetRel + '|' + mark2);
    skipped += 1;
    return;
  }
  if (text.includes(mark)) {
    const fromV1 =
      "- id: tool-web\n" +
      "  name: '@deepseek-ai/dsh-tool-web'\n" +
      "  config:\n" +
      "    fetch: true\n" +
      "    searchTimeoutMs: 60000\n";
    if (text.split(fromV1).length - 1 !== 1) {
      console.error('PATCH_FAIL=preset-fetch-v2-anchor|' + presetRel);
      process.exit(1);
    }
    text = text.replace(fromV1, want);
    if (!text.includes(mark2)) text = text.replace('# --- ' + mark + ' ---', '# --- ' + mark + ' ---\n# --- ' + mark2 + ' ---');
    fs.writeFileSync(presetPath, text, 'utf8');
    console.log('PATCHED=' + presetRel + '|web-fetch-timeout');
    applied += 1;
    return;
  }
  const from =
    "- id: tool-web\n" +
    "  name: '@deepseek-ai/dsh-tool-web'\n" +
    "  config:\n" +
    "    fetch: false\n" +
    "    searchTimeoutMs: 60000\n";
  const to = want + "# --- " + mark + " ---\n# --- " + mark2 + " ---\n";
  const hits = text.split(from).length - 1;
  if (hits !== 1) {
    console.error('PATCH_FAIL=preset-fetch-anchor|' + presetRel + '|expected=1|got=' + hits);
    process.exit(1);
  }
  fs.writeFileSync(presetPath, text.replace(from, to), 'utf8');
  console.log('PATCHED=' + presetRel + '|web-fetch');
  applied += 1;
}

pinPresetFetch(path.join('config', 'agent-presets', 'standard', 'agent.cordis.yml'));
pinPresetFetch(path.join('config', 'agent-presets', 'code', 'agent.cordis.yml'));

// HOST overlay agent-instructions does not cover the session loader.
// Official standard/code mount their own row; missing markers default to
// [.git] and walk this Mac from ~/company up to $HOME/AGENTS.md.
function pinPresetInstrRoot(presetRel) {
  const presetPath = path.join(kernelRoot, presetRel);
  const mark = 'company-preset-instr-root-v1';
  if (!fs.existsSync(presetPath)) {
    console.log('PRESET_INSTR_SKIP=' + presetRel + '|missing');
    return;
  }
  let text = fs.readFileSync(presetPath, 'utf8');
  if (text.includes(mark)) {
    console.log('PATCH_ALREADY=' + presetRel + '|' + mark);
    skipped += 1;
    return;
  }
  if (/id: agent-instructions[\s\S]*?projectRootMarkers:[\s\S]*?\.company-root/.test(text)) {
    fs.writeFileSync(presetPath, text.replace(/\s*$/, '') + '\n# --- ' + mark + ' ---\n', 'utf8');
    console.log('PATCHED=' + presetRel + '|instr-root-mark');
    applied += 1;
    return;
  }
  const from =
    "- id: agent-instructions\n" +
    "  name: '@deepseek-ai/dsh-agent-instructions'\n" +
    "  config:\n" +
    "    maxBytes: 65536\n";
  const to =
    from +
    "    projectRootMarkers:\n" +
    "      - .company-root\n" +
    "# --- " + mark + " ---\n";
  const hits = text.split(from).length - 1;
  if (hits !== 1) {
    console.error('PATCH_FAIL=preset-instr-anchor|' + presetRel + '|expected=1|got=' + hits);
    process.exit(1);
  }
  fs.writeFileSync(presetPath, text.replace(from, to), 'utf8');
  console.log('PATCHED=' + presetRel + '|instr-root');
  applied += 1;
}

pinPresetInstrRoot(path.join('config', 'agent-presets', 'standard', 'agent.cordis.yml'));
pinPresetInstrRoot(path.join('config', 'agent-presets', 'code', 'agent.cordis.yml'));
pinPresetInstrRoot(path.join('config', 'agent-presets', 'company-think', 'agent.cordis.yml'));
pinPresetInstrRoot(path.join('config', 'agent-presets', 'company-think-eval', 'agent.cordis.yml'));

console.log('PATCH_APPLIED=' + applied);
console.log('PATCH_SKIPPED=' + skipped);
console.log('KERNEL_PATCHES_OK=1');
