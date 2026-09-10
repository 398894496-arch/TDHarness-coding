# Bugs and open work

This tree is **usable, not mature**. Pick an item below, open a **Task** issue with that id in the title, then send a fork + PR. Do not paste office IPs, passwords, Tailscale keys, or roster names.

Kernel-only bugs (stock `@deepseek-ai/dsh`, no patch, no overlay) can also go to [upstream Discussions](https://github.com/deepseek-ai/deepseek-harness/discussions). Link the Discussion from the Issue here.

How to land a change: [CONTRIBUTING.md](CONTRIBUTING.md). What the patches are for: [docs/PRODUCT.md](docs/PRODUCT.md).

---

## Claim these

Each row is work that is **not done**. “Done” means the green line in that section, not a comment.

### C2b. Linux CIFS mount points

Windows drive probing does not detect Linux CIFS mount points. A path such as `/mnt/team` is still a POSIX path to these helpers. This remains separate from C2; open a child Task before taking it. C2 also does not resolve directory junctions or eliminate a drive-remapping race after the check.

### C3. Security review of two privilege-shaped patches

**Why it is a hole:** these edits were made so a **company share** would stop hard-crashing. They still apply on a **coding** prefix whose overlay is a local folder.

1. `company-skill-get-custom-trusted-v1` / `company-skill-custom-trusted-v1` — `customSkillDirs` get `trustedHost: true` and `get()` reads them like bundled skills (Node fs, not the workspace sandbox).
2. `company-fs-unc-acl-v1` — skip copying a DACL on UNC; also **return** on `ACCESS_DENIED` / `EACCES` even when the path was not classified as UNC.

This is **not** “the agent is sandboxed.” Review whether (1) can be pointed at a path the user did not intend, and whether (2) on a local NTFS disk drops ACL copy on a real access-denied.

**Files:** those marks in `patches/apply-kernel-patches.js`. Write findings in the PR, not in a private chat.

**Done when:** a written verdict in the PR (keep / narrow / split coding vs share) plus a test or a refuse that matches the verdict. “Looks fine” with no path is not done.

**Skill:** Windows ACL, dsh sandbox, adversarial reading. No need to “fix everything” in one PR.

### C4. Coding setup still pins company skill roots

**Closed (option a):** `setup.sh` / `setup.ps1` apply only the coding subset (`--only` now takes a comma-separated mark list), so `__DESK_SKILLS__`, custom trustedHost, `web_fetch` and `.company-root` no longer touch the official presets on a coding install. The subset uses `company-sandbox-local-drive-v2` (not the retired `unc-v1` name) plus junction / glob / session / goal / `company-session-events-alias-v1`. Unknown `--only` marks fail before any edit. `TDH_FULL_PATCHES=1` keeps the old full-pin behavior for the company desk tree.

**Why it was a hole:** `scripts/setup.sh` applied the **full** patcher. That rewrote `standard` / `code` presets with `__DESK_SKILLS__`, `customSkillDirs`, `.company-root`, and `web_fetch: true`. `overlays/solo.yml` does not define those dirs. Company-only preset names (`company-think`) are skipped if missing, but **standard/code still changed**.

**Files:** `patches/apply-kernel-patches.js` (preset pins at the bottom), `overlays/solo.yml`, `scripts/setup.sh`.

**Done when:** either (a) coding setup applies a documented **subset** of marks (sandbox + junction + glob + session rename, etc.) and skips `__DESK_SKILLS__` / custom trustedHost, **or** (b) solo overlay and README state exactly which placeholders must be replaced before first run, and setup fails if they are still literal `__DESK_SKILLS__`.

**Skill:** dsh presets, `--dump-config`. Repro: setup + `dsh --patch overlays/solo.yml --dump-config` and show `skill-filesystem` / `tool-web` / `projectRootMarkers`.

### C5. Kernel bump dry-run

**Closed:** `node scripts/prove-bump.js <version>` installs the given tag into a throwaway prefix, applies the patch set, and prints one `BUMP_MARK=` line per landed mark; a moved anchor surfaces as the patcher's `PATCH_FAIL=anchor-not-unique` plus `BUMP_PROVE_OK=0`. Verified green on the 0.1.1-rc.2 pin, and 0.1.2-rc.1 correctly names the `resume-already-armed-noop` anchor that moved (fixed by the 0.1.2-compat PR).

**Why it was a hole:** the upgrade gate is “anchor not unique → hard fail.” There was no script that installs a **newer** `@deepseek-ai/dsh` into a throwaway prefix and prints which marks still apply.

**Files:** new `scripts/prove-bump.sh` (or `.js`) taking a version argument. Must refuse `~/.local` and `~/dsh-node-rc8` like the patcher.

**Done when:** `bash scripts/prove-bump.sh 0.1.1-rc.2` is green on the current pin, and pointing it at a missing/newer tag either applies or exits with `PATCH_FAIL=anchor-not-unique|…` per mark, without writing a live prefix.

**Skill:** npm prefixes, reading patcher stdout.

### C6. Secret scan is office needles only

**Why it is a hole:** `scripts/prove-scan.sh` greps a fixed office-fingerprint list (see that file). A new key format or a personal `.env` committed by a contributor can pass `SCAN_OK=1`.

**Files:** `scripts/prove-scan.sh`, `.github/workflows/prove.yml`. Adding gitleaks/trufflehog **in addition to** the office needles is fine. Do not remove the office needles.

**Done when:** CI fails on a dummy vendor token / GitHub PAT / cloud key in a tracked file, and still fails if someone re-introduces any needle already listed in `prove-scan.sh`.

**Skill:** CI, secret scanning. No dsh prefix required.

### C7. Windows junction: cmd cwd is SystemRoot (integration)

**Why it is a hole:** v4 sets `cwd` to `%SystemRoot%` so `mklink /J` works when the process cwd is UNC. prove-patches only greps `SystemRoot` in `dsh-app-boot`. Nobody runs `mklink` in CI.

**Files:** `runtime/win-junction-shim.cjs`, junction marks in the patcher. A small `scripts/prove-junction.ps1` that creates a temp dir, `--require` the shim (or calls the same spawn), and checks the junction.

**Done when:** the script prints `JUNCTION_PROVE_OK=1` on Windows without Developer Mode. Document that GitHub-hosted Windows runners may lack the share case; that is OK if the script still proves **local** cwd + mklink.

**Skill:** Windows, cmd, NTFS junctions.

### C8. Missing search root → empty matches can hide real IO errors

**Why it is a hole:** `company-glob-missing-root-v1` maps rg exit 2 + “IO error / os error 2” to `noMatches: true` so a broken junction does not kill the turn. A real permission or parse error that happens to look like “file not found” would also go quiet.

**Files:** that mark in `patches/apply-kernel-patches.js`.

**Done when:** tests (or a documented rg stderr matrix) show which stderr strings become empty vs `SEARCH_FAILED`. Tighten the matcher if it is too broad; do not revert to “any rg 2 kills the turn” without a replacement.

**Skill:** rg on Windows/macOS, reading `dsh-tool-fs-search`.

---

## Completed contributor work

### C2. Refuse mapped and SUBST drive roots before ACL grants

`company-sandbox-local-drive-v2` distinguishes local Win32 namespaced paths (`\\?\C:\...`) from UNC paths, then queries Windows drive type and DOS device mapping before the first original operation in `materializeAclGrant`. Network and DOS-alias roots fail with `COMPANY_WORKSPACE_NOT_LOCAL`. Missing drives, failed/blocked probes, timeouts, and malformed responses fail with `COMPANY_WORKSPACE_PROBE_FAILED`; they are never assumed local.

**Green:** `node scripts/prove-windows-drives.js` → `WINDOWS_DRIVE_UNIT_OK=1`; on Windows it also creates/removes an unused temporary SUBST mapping and prints `WINDOWS_DRIVE_PROVE_OK=1`. It exercises the actual patcher's fixture; `prove-patches.js` also checks the patched pinned kernel method. Network-drive API responses are covered deterministically. Set `TDH_TEST_MAPPED_ROOT` to an existing mapped drive root for optional real network-drive coverage; the test does not create or remove that mapping. The default test reports this coverage as skipped.

**Runtime:** Windows PowerShell 5.1 with `Add-Type` must be available. The bounded, hidden probe uses `QueryDosDeviceW` and `GetDriveTypeW`, without WMI or localized command parsing. It runs synchronously on grant entry, before the kernel's own grant cache. A successful `local` classification is cached per drive letter for 30 seconds so a burst of sandboxed calls pays one PowerShell start rather than one per call; refusals and probe failures are never cached, so a corrected drive takes effect on the next call. **Limit:** a remap inside that 30-second window is not observed, and the check is a precheck rather than protection against concurrent remapping or proof of NTFS confinement. Install a fresh pinned prefix when moving from the old v1 patch; the patcher explicitly rejects v1-only prefixes.

### C1. Behavior tests for the sandbox path check

`patches/lib/network-path.js` is the single source for the helpers embedded by the patcher and exercised by `scripts/prove-unc.js`. The proof rejects backslash/forward-slash UNC roots, allows local Windows/POSIX roots, applies the actual patch to a minimal fixture, and verifies refusal before grant operations. Negative controls detect a disabled predicate and a disconnected precheck.

**Green:** `node scripts/prove-unc.js` → `UNC_PROVE_OK=1`, without `KERNEL_PREFIX`. CI runs this on Linux and Windows with Node 22. `scripts/prove-patches.js` additionally exercises the method from the patched pinned kernel (`UNC_KERNEL_PROVE_OK=1`). This proves path refusal and call ordering, not real NTFS ACL behavior; mapped drives and the ACL review remain C2/C3.

---

## Patched, still bites if you skip setup

These already have marks in `patches/apply-kernel-patches.js`. File a bug if they still happen **after** `SETUP_OK=1`. Do not “fix” them by vendoring a whole upstream file.

| Id | Symptom | Mark / shim |
| --- | --- | --- |
| P1 | `dsh: win-junction-failed` when process cwd is UNC | `company-win-junction-mklink-v4` + `runtime/win-junction-shim.cjs` |
| P2 | `EPERM` on `fs.symlinkSync(..., "junction")` without Developer Mode | `company-win-junction-mklink-v3` |
| P3 | Edit/write on SMB dies on `SetFileSecurityW` / `ReplaceFileW` | `company-fs-unc-acl-v1`, `company-fs-unc-replace-v1` |
| P4 | New session `ENOTSUP` / `link` on smbfs | `company-session-smbfs-rename-v1` |
| P5 | App Translocation `EROFS` writing into a `.app` | `runtime/mac-no-translocate.sh` (CLI tree does not ship a DMG) |
| P6 | Goal resume of an already-armed goal throws `GOAL_INVALID_TRANSITION` | `company-goal-resume-armed-v1` |
| P7 | On 0.1.2, presets reading `session.events.length` (tool-bootstrap et al.) TypeError on first assemble; UI says UNKNOWN | `company-session-events-alias-v1` |

---

## Not bugs in this tree

- Local workspace instead of SMB. The sandbox patch **refuses** a network path as the sandbox root on purpose. See [docs/PRODUCT.md](docs/PRODUCT.md).
- Re-applying patches after `npm install` / a kernel bump. A missing anchor is a hard fail. That is the upgrade gate (see C5).
- Official dsh closing GitHub Issues and refusing external PRs. Contribute **here**.
- Company login copy that maps every network failure to “wrong password.” This repo does not ship that shell.
- Tailscale `up` without `--reset` staying on a personal tailnet. Shell bug, not kernel. Do not file it upstream or here as a dsh patch.
