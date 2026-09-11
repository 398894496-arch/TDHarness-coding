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
const { sandboxPathHelperSource } = require('./lib/network-path');
const { companyRgPathMissing } = require('./lib/rg-missing-root');

const prefix = process.argv[2];
if (!prefix) {
  console.error('usage: apply-kernel-patches.js <prefix> [--only <mark>[,<mark>...]]');
  process.exit(2);
}
const onlyIdx = process.argv.indexOf('--only');
// --only takes one mark or a comma-separated list; preset pins are skipped
// in --only mode either way.
const onlyMarks = new Set(
  onlyIdx >= 0 ? String(process.argv[onlyIdx + 1] || '').split(',').filter(Boolean) : []
);

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

// One edit may carry several anchor variants: when a kernel bump rewrites
// the anchored source, the new shape is added next to the old one. Exactly
// one variant must match exactly once; anything else is a hard fail, same
// as a single anchor that lost its count.
function editVariants(edit) {
  if (Array.isArray(edit.variants) && edit.variants.length) return edit.variants;
  return [{ from: edit.from, to: edit.to }];
}

function applyEdit(text, edit, file) {
  const scored = editVariants(edit).map((v, i) => ({ i, v, n: text.split(v.from).length - 1 }));
  const matched = scored.filter((s) => s.n === 1);
  if (matched.length !== 1) {
    // The kernel moved. Do not guess -- a patch that half-applies to a
    // sandbox is worse than one that refuses to apply at all.
    const got = scored.length === 1 ? String(scored[0].n) : scored.map((s) => 'v' + s.i + '=' + s.n).join(',');
    console.error(
      'PATCH_FAIL=anchor-not-unique|' + file + '|' + edit.name +
      '|expected=1|got=' + got +
      '|kernel bumped? re-review this patch against the new source'
    );
    process.exit(1);
  }
  return text.replace(matched[0].v.from, matched[0].v.to);
}

// 0.1.2 moved the shipped presets out of the dsh package config/ tree into
// the dsh-agent-presets package. Resolve whichever place this kernel keeps.
function presetCandidates(name) {
  return [
    path.join('config', 'agent-presets', name, 'agent.cordis.yml'),
    path.join('node_modules', '@deepseek-ai', 'dsh-agent-presets', 'presets', name, 'agent.cordis.yml'),
  ];
}

function resolvePresetRel(name) {
  for (const rel of presetCandidates(name)) {
    if (fs.existsSync(path.join(kernelRoot, rel))) return rel;
  }
  return null;
}

const MARK = 'company-sandbox-local-drive-v2';
const SKILL_MARK = 'company-skill-custom-trusted-v1';

const MARKDOWN_SLOT_PATCH = {
    // 0.1.2 renders assistant markdown through a fixed MarkdownText
    // primitive; a plugin (company desk image rendering, syntax extensions)
    // cannot override it. Open a `conversation.assistant.markdown` render
    // slot with the official primitive as the fallback. Skipped on 0.1.1,
    // which ships no dsh-client-ui-chat package at all.
    file: path.join('node_modules', '@deepseek-ai', 'dsh-client-ui-chat', 'lib', 'client.js'),
    mark: 'company-assistant-markdown-slot-v1',
    minKernel: '0.1.2',
    append:
      '\n// --- company-assistant-markdown-slot-v1 (company patch; see scripts/p-product-base/apply-kernel-patches.js) ---\n',
    edits: [
      {
        name: 'markdown-render-prop',
        from: 'function AssistantMarkdown({ blocks, streaming, interrupted, renderMessageImages,',
        to: 'function AssistantMarkdown({ blocks, streaming, interrupted, renderMarkdown, renderMessageImages,',
      },
      {
        name: 'assistant-markdown-slot-render',
        from: '\t\t\t\t\t\trendered.push((0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.MarkdownText, {\n\t\t\t\t\t\t\ttext: block.text,\n\t\t\t\t\t\t\tstreaming,\n\t\t\t\t\t\t\tlabels,\n\t\t\t\t\t\t\tfileMentions: mentions\n\t\t\t\t\t\t}, i));',
        to: '\t\t\t\t\t\trendered.push((0, react_jsx_runtime.jsx)(react.Fragment, { children: renderMarkdown({ text: block.text, streaming, labels, fileMentions: mentions }) }, i));',
      },
      {
        name: 'assistant-node-render-slot',
        from: 'function AssistantNodeView({ node, useTurnData,',
        to: 'function AssistantNodeView({ node, renderSlot, useTurnData,',
      },
      {
        name: 'assistant-node-markdown-fallback',
        from: 'return (0, react_jsx_runtime.jsx)(AssistantMarkdown, {\n\t\t\t\tblocks: data.blocks,',
        to: 'return (0, react_jsx_runtime.jsx)(AssistantMarkdown, {\n\t\t\t\trenderMarkdown: (props) => renderSlot("conversation.assistant.markdown", props, { fallback: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.MarkdownText, props) }),\n\t\t\t\tblocks: data.blocks,',
      },
      {
        name: 'assistant-markdown-child-slot',
        from: 'key: "assistant-step",\n\t\t\t\tlocale: NS\n\t\t\t}, AssistantNodeView)',
        to: 'key: "assistant-step",\n\t\t\t\tlocale: NS,\n\t\t\t\tchildren: { "conversation.assistant.markdown": { kind: "single", scope: "session" } }\n\t\t\t}, AssistantNodeView)',
      },
    ],
};

const HELPERS = `

// --- ${MARK} (company patch; see patches/apply-kernel-patches.js) ---
${sandboxPathHelperSource()}
`;

const PATCHES = [
  MARKDOWN_SLOT_PATCH,
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
        variants: [
          {
            from:
              '\t\t\tif (current.phase === "active" && cache.activation === "armed") throw new GoalError(`goal "${current.id}" is already active and armed`, "GOAL_INVALID_TRANSITION");\n',
            to:
              '\t\t\tif (current.phase === "active" && cache.activation === "armed") {\n' +
              '\t\t\t\tconst view = this.view(cache);\n' +
              '\t\t\t\tif (view === void 0) throw new GoalError(`goal "${current.id}" is already active and armed`, "GOAL_INVALID_TRANSITION");\n' +
              '\t\t\t\treturn view;\n' +
              '\t\t\t}\n',
          },
          {
            // 0.1.2-rc.1: the resume path destructures `cache` into
            // [currentState, runtime] and reads runtime.activation.
            from:
              '\t\t\tif (current.phase === "active" && runtime.activation === "armed") throw new GoalError(`goal "${current.id}" is already active and armed`, "GOAL_INVALID_TRANSITION");\n',
            to:
              '\t\t\tif (current.phase === "active" && runtime.activation === "armed") {\n' +
              '\t\t\t\tconst view = this.view(currentState, runtime);\n' +
              '\t\t\t\tif (view === void 0) throw new GoalError(`goal "${current.id}" is already active and armed`, "GOAL_INVALID_TRANSITION");\n' +
              '\t\t\t\treturn view;\n' +
              '\t\t\t}\n',
          },
        ],
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
        variants: [
          {
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
          {
            // 0.1.2-rc.1: ensureSymlink also manages dsh module-proxy dirs
            // (readModuleProxyRecord / symlinkPointsTo replace readlinkSync).
            from:
              'function ensureSymlink(link, target) {\n' +
              '\tlet stat;\n' +
              '\ttry {\n' +
              '\t\tstat = lstatSync(link);\n' +
              '\t} catch {\n' +
              '\t\tstat = void 0;\n' +
              '\t}\n' +
              '\tif (stat !== void 0) {\n' +
              '\t\tif (!stat.isSymbolicLink()) {\n' +
              '\t\t\tif ((stat.isDirectory() ? readModuleProxyRecord(link) : void 0)?.dsh?.moduleFallback?.targets === void 0) throw new Error(`dsh: ${link} exists and is not a symlink or dsh-managed module proxy; remove it so dsh can manage the installation fallback`);\n' +
              '\t\t\trmSync(link, { recursive: true });\n' +
              '\t\t\tstat = void 0;\n' +
              '\t\t}\n' +
              '\t\tif (stat !== void 0) {\n' +
              '\t\t\tif (symlinkPointsTo(link, target)) return;\n' +
              '\t\t\tunlinkSync(link);\n' +
              '\t\t}\n' +
              '\t}\n' +
              '\ttry {\n' +
              '\t\tsymlinkSync(target, link, "junction");\n' +
              '\t} catch (error) {\n' +
              '\t\t/* v8 ignore next 4 */\n' +
              '\t\tif (error.code !== "EEXIST" || !lstatSync(link).isSymbolicLink() || !symlinkPointsTo(link, target)) throw error;\n' +
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
              '\t\tif (!stat.isSymbolicLink()) {\n' +
              '\t\t\tif ((stat.isDirectory() ? readModuleProxyRecord(link) : void 0)?.dsh?.moduleFallback?.targets === void 0) throw new Error(`dsh: ${link} exists and is not a symlink or dsh-managed module proxy; remove it so dsh can manage the installation fallback`);\n' +
              '\t\t\trmSync(link, { recursive: true });\n' +
              '\t\t\tstat = void 0;\n' +
              '\t\t}\n' +
              '\t\tif (stat !== void 0) {\n' +
              '\t\t\tif (symlinkPointsTo(link, target)) return;\n' +
              '\t\t\tunlinkSync(link);\n' +
              '\t\t}\n' +
              '\t}\n' +
              '\tif (process.platform === "win32") {\n' +
              '\t\tif (companyWinJunction(link, target)) return;\n' +
              '\t\tthrow new Error("dsh: win-junction-failed " + link + " -> " + target);\n' +
              '\t}\n' +
              '\ttry {\n' +
              '\t\tsymlinkSync(target, link, "junction");\n' +
              '\t} catch (error) {\n' +
              '\t\t/* v8 ignore next 4 */\n' +
              '\t\tif (error.code !== "EEXIST" || !lstatSync(link).isSymbolicLink() || !symlinkPointsTo(link, target)) throw error;\n' +
              '\t}\n' +
              '}\n',
          },
        ],
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
    // Permit an empty result only for a complete, single missing-root
    // diagnostic. Partial results and other failures retain classification.
    file: path.join('node_modules', '@deepseek-ai', 'dsh-tool-fs-search', 'lib', 'index.js'),
    mark: 'company-glob-missing-root-v2',
    append:
      '\n// --- company-glob-missing-root-v2 (company patch; see scripts/p-product-base/apply-kernel-patches.js) ---\n' +
      companyRgPathMissing.toString() + '\n',
    edits: [
      {
        name: 'rg-missing-root-empty',
        from:
          '\tif (outcome.exitCode !== 0 && outcome.exitCode !== 1) throw classifyRunFailure(toolName, outcome.exitCode, stderr.text, stderr.lossy);\n',
        to:
          '\tif (outcome.exitCode !== 0 && outcome.exitCode !== 1) {\n' +
          '\t\tif (outcome.exitCode === 2 && !stderr.lossy && !stdout.lossy && stdout.text === "" && companyRgPathMissing(stderr.text, argv)) return {\n' +
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
        variants: [
          {
            from:
              'import { link, mkdir, mkdtemp, open, readFile, readdir, realpath, rm, stat, truncate } from "node:fs/promises";\n',
            to:
              'import { link, mkdir, mkdtemp, open, readFile, readdir, realpath, rename, rm, stat, truncate } from "node:fs/promises";\n',
          },
          {
            // 0.1.3 added a session lock and with it the lstat import.
            from:
              'import { link, lstat, mkdir, mkdtemp, open, readFile, readdir, realpath, rm, stat, truncate } from "node:fs/promises";\n',
            to:
              'import { link, lstat, mkdir, mkdtemp, open, readFile, readdir, realpath, rename, rm, stat, truncate } from "node:fs/promises";\n',
          },
        ],
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
  {
    // 0.1.2 removed Session.events; community presets (tool-bootstrap et al.)
    // still read session.events.length and die with a TypeError on the first
    // assemble, which the UI reports as UNKNOWN. Alias it to snapshotEvents().
    // Skipped on 0.1.1, where Session still has its own events.
    file: path.join('node_modules', '@deepseek-ai', 'dsh-session', 'lib', 'index.js'),
    mark: 'company-session-events-alias-v1',
    minKernel: '0.1.2',
    append:
      '\n// --- company-session-events-alias-v1 (company patch; see scripts/p-product-base/apply-kernel-patches.js) ---\n',
    edits: [
      {
        name: 'session-events-getter',
        from:
          '\teventAt(seq) {\n' +
          '\t\treturn this.log[seq];\n' +
          '\t}\n',
        to:
          '\teventAt(seq) {\n' +
          '\t\treturn this.log[seq];\n' +
          '\t}\n' +
          '\tget events() {\n' +
          '\t\treturn this.snapshotEvents();\n' +
          '\t}\n',
      },
    ],
  },
];

const kernelRoot = resolveKernelRoot();
console.log('PATCH_KERNEL_ROOT=' + kernelRoot);
const KERNEL_VERSION = JSON.parse(fs.readFileSync(path.join(kernelRoot, 'package.json'), 'utf8')).version;
console.log('PATCH_KERNEL_VERSION=' + KERNEL_VERSION);

// Some patches only exist because a newer kernel removed or rewrote a
// surface. `minKernel` skips them on older pins with a loud line instead of
// an anchor failure. Prerelease tags are stripped: 0.1.2-rc.1 counts as the
// 0.1.2 line.
function kernelBelowMin(version, min) {
  const parts = (v) => String(v).split('-')[0].split('.').map((n) => parseInt(n, 10) || 0);
  const a = parts(version);
  const b = parts(min);
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] < b[i];
  }
  return false;
}

let applied = 0;
let skipped = 0;

if (onlyMarks.size) {
  for (const mark of onlyMarks) {
    if (!PATCHES.some((p) => p.mark === mark)) {
      console.error('PATCH_FAIL=unknown-mark|' + mark);
      process.exit(1);
    }
  }
}

for (const patch of PATCHES) {
  if (onlyMarks.size && !onlyMarks.has(patch.mark)) continue;
  if (patch.minKernel && kernelBelowMin(KERNEL_VERSION, patch.minKernel)) {
    console.log('PATCH_SKIP_KERNEL=' + patch.file + '|' + patch.mark + '|kernel=' + KERNEL_VERSION + '|needs>=' + patch.minKernel);
    skipped += 1;
    continue;
  }
  const target = path.join(kernelRoot, patch.file);
  if (!fs.existsSync(target)) {
    console.error('PATCH_FAIL=target-missing|' + target);
    process.exit(1);
  }
  let text = fs.readFileSync(target, 'utf8');

  if (patch.mark === MARK && text.includes('company-sandbox-local-unc-v1') && !text.includes(MARK)) {
    console.error('PATCH_FAIL=legacy-sandbox-patch|install the pinned kernel into a fresh prefix before applying v2');
    process.exit(1);
  }

  if (patch.mark === 'company-glob-missing-root-v2' && text.includes('company-glob-missing-root-v1')) {
    console.error('PATCH_FAIL=legacy-search-patch|install a fresh pinned prefix before applying v2');
    process.exit(1);
  }

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
    text = applyEdit(text, edit, patch.file);
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

if (onlyMarks.size) {
  console.log('PATCH_APPLIED=' + applied);
  console.log('PATCH_SKIPPED=' + skipped);
  console.log('KERNEL_PATCHES_OK=1');
  process.exit(applied + skipped > 0 ? 0 : 1);
}

const presetRel = resolvePresetRel('standard');
if (!presetRel) {
  console.error('PATCH_FAIL=preset-missing|' + presetCandidates('standard').join(' , '));
  process.exit(1);
}
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
// `web_fetch` is owned by the session preset; official 0.1.1 standard/code
// keep `fetch: false`, while 0.1.2 already ships `fetch: true` without the
// timeout. Pin the product prefix so dump-config session tools actually
// contain web_fetch, accepting either upstream default as the anchor.
function pinPresetFetch(name) {
  const presetRel = resolvePresetRel(name);
  if (!presetRel) {
    console.log('PRESET_FETCH_SKIP=' + name + '|missing');
    return;
  }
  const presetPath = path.join(kernelRoot, presetRel);
  const mark = 'company-preset-web-fetch-v1';
  const mark2 = 'company-preset-web-fetch-v2';
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
  const fromFalse =
    "- id: tool-web\n" +
    "  name: '@deepseek-ai/dsh-tool-web'\n" +
    "  config:\n" +
    "    fetch: false\n" +
    "    searchTimeoutMs: 60000\n";
  const fromTrue =
    "- id: tool-web\n" +
    "  name: '@deepseek-ai/dsh-tool-web'\n" +
    "  config:\n" +
    "    fetch: true\n" +
    "    searchTimeoutMs: 60000\n";
  const to = want + "# --- " + mark + " ---\n# --- " + mark2 + " ---\n";
  const from =
    text.split(fromFalse).length - 1 === 1
      ? fromFalse
      : text.split(fromTrue).length - 1 === 1 && !text.includes('fetchTimeoutMs: 90000')
        ? fromTrue
        : null;
  if (!from) {
    console.error('PATCH_FAIL=preset-fetch-anchor|' + presetRel + '|expected=1|got=0');
    process.exit(1);
  }
  fs.writeFileSync(presetPath, text.replace(from, to), 'utf8');
  console.log('PATCHED=' + presetRel + '|web-fetch');
  applied += 1;
}

pinPresetFetch('standard');
pinPresetFetch('code');

// HOST overlay agent-instructions does not cover the session loader.
// Official standard/code mount their own row; missing markers default to
// [.git] and walk this Mac from ~/company up to $HOME/AGENTS.md.
function pinPresetInstrRoot(name, presetRel) {
  const mark = 'company-preset-instr-root-v1';
  if (!presetRel || !fs.existsSync(path.join(kernelRoot, presetRel))) {
    console.log('PRESET_INSTR_SKIP=' + name + '|missing');
    return;
  }
  const presetPath = path.join(kernelRoot, presetRel);
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

pinPresetInstrRoot('standard', resolvePresetRel('standard'));
pinPresetInstrRoot('code', resolvePresetRel('code'));
pinPresetInstrRoot('company-think', path.join('config', 'agent-presets', 'company-think', 'agent.cordis.yml'));
pinPresetInstrRoot('company-think-eval', path.join('config', 'agent-presets', 'company-think-eval', 'agent.cordis.yml'));

console.log('PATCH_APPLIED=' + applied);
console.log('PATCH_SKIPPED=' + skipped);
console.log('KERNEL_PATCHES_OK=1');
