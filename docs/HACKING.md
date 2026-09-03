# Hacking

This is a coding tree on official DeepSeek Harness. Creator-mode skills in the official package teach **how** to inspect and patch; they are not a ban on changing the framework.

Open holes to pick up: [BUGS.md](../BUGS.md). Land rules: [CONTRIBUTING.md](../CONTRIBUTING.md).

## Planes

| Plane | What belongs there |
|---|---|
| HOST | registry, persistence, sandbox approval, model routing, jobs |
| PRESET | tools, persona, prompt, compaction (one session) |
| CLIENT Slot | UI. Inspect before write. Do not guess slot names. |

Do not replace whole `root` / `sidebar` / `conversation` unless you know you are shadowing shipped UI.

## Official channels first

- Persistent change: `--patch` / `dsh plugin --profile web add`
- Prototype only: `cordis_define` (gone on restart)

If a plugin or the framework is wrong, patch it in this tree and re-apply onto a **new** prefix. Do not hot-fix a running `node_modules`.

## Kernel pin

See `kernel.yml`. To bump: install a fresh prefix, run `patches/apply-kernel-patches.js`, fix anchors that fail, then change the pin. A dry-run script for a newer tag is [BUGS.md](../BUGS.md) item **C5**.

## Marks in `apply-kernel-patches.js`

| Mark | Package file | One line |
| --- | --- | --- |
| `company-sandbox-local-unc-v1` | `dsh-sandbox-local` | Refuse UNC as `workspace-write` root; diagnose grant fail |
| `company-skill-custom-trusted-v1` | `dsh-skill-filesystem` | `customSkillDirs` get `trustedHost` |
| `company-skill-get-custom-trusted-v1` | same | `get()` reads custom like bundled |
| `company-skill-root-eacces-v1` | same | EACCES/EPERM on one root → `[]`, do not drop the provider |
| `company-fs-unc-acl-v1` | `dsh-fs-local` | Skip DACL copy on UNC; ACCESS_DENIED inherit |
| `company-fs-unc-replace-v1` | same | Skip `ReplaceFileW` on UNC, rename instead |
| `company-goal-resume-armed-v1` | `dsh-goal` | Resume of already-armed goal is a no-op |
| `company-win-junction-mklink-v3` | `dsh-app-boot` | `mklink /J` instead of `symlink` junction |
| `company-win-junction-mklink-v4` | same | `mklink` cwd = `SystemRoot` |
| `company-glob-missing-root-v1` | `dsh-tool-fs-search` | rg missing root → no matches |
| `company-session-smbfs-rename-v1` | `dsh-session-persistence-jsonl` | `link` ENOTSUP → `rename`; swallow dir sync ENOTSUP |
| `company-preset-skills-v1` | preset `standard` | `__DESK_SKILLS__` / custom dirs (see **C4**) |
| `company-preset-web-fetch-v2` | `standard` / `code` | `web_fetch` on in the session preset |
| `company-preset-instr-root-v1` | `standard` / `code` (+ company presets if present) | `projectRootMarkers: [.company-root]` |

Shims (not anchored into npm): `runtime/win-junction-shim.cjs`, `runtime/mac-no-translocate.sh`.

## Chinese UI

Path and script names ASCII. Fonts: `"Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", "Noto Sans SC", sans-serif`.
