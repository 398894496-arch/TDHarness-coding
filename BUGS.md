# Known bugs

This tree is usable, not mature. Report new ones as Issues here. Kernel-only bugs (reproducible on stock `@deepseek-ai/dsh` with no overlay) can also go to [upstream Discussions](https://github.com/deepseek-ai/deepseek-harness/discussions) — link back to the Issue.

Do not put office IPs, roster names, or auth keys in Issues.

## Open in this tree (patches exist, still bite if you skip setup)

### 1. Windows `win-junction-failed` when cwd is UNC

**Symptom:** desk exits with `Error: dsh: win-junction-failed …`.

**Cause:** `dsh-app-boot` uses `cmd mklink /J`. `cmd.exe` cannot use a UNC path as its current directory. If the process cwd is `\\server\share\...`, mklink returns 1.

**Fix in this tree:** `company-win-junction-mklink-v4` sets `cwd` to `%SystemRoot%`. The same `cwd` is in `runtime/win-junction-shim.cjs` for hosts that `--require` the shim.

**Repro:** on Windows, `cd \\server\share\folder` then start a desk that creates a junction.

**Upstream-shaped:** yes.

### 2. macOS App Translocation / EROFS

**Symptom:** `EROFS` / `Read-only file system` writing into the `.app` bundle. Path contains `AppTranslocation`.

**Cause:** opening a quarantined app from Downloads or a DMG runs a read-only copy. Writing `desk-bridge.json` or bundled presets then fails.

**Fix in this tree:** `runtime/mac-no-translocate.sh` — refuse that path and tell the user to drag the app into `/Applications`.

**Repro:** download a `.app`, open it from Downloads without copying to Applications.

**Upstream-shaped:** yes, if the official Mac pack writes into the bundle.

### 3. Login / network failures shown as the wrong error

**Symptom:** timeout, TLS, or “not on the expected network” displayed as a password error (or a generic “cannot reach company net”).

**Cause:** the company login shell mapped every `WebException` / failed POST to one string. This coding tree does not ship that login shell. If you add a login UI, do not collapse all failures into “wrong password”.

**Upstream-shaped:** only if you reproduce it on stock dsh.

### 4. Silent Tailscale `up` does not leave a personal account

**Symptom:** GUI shows Connected on a personal tailnet; the agent still cannot reach a private office login.

**Cause:** `tailscale up --auth-key …` without `--reset` can stay on the previous account. This is a **shell** bug, not a dsh kernel bug. Do not file it upstream.

**Workaround:** sign out of Tailscale, then `up --auth-key … --accept-routes --reset`.

### 5. Official symlink `EPERM` on Windows without Developer Mode

**Symptom:** `fs.symlinkSync(..., "junction")` fails with EPERM on some Node 22 builds.

**Fix in this tree:** `company-win-junction-mklink-v3` uses `cmd mklink /J` (v4 adds the SystemRoot cwd). Also `runtime/win-junction-shim.cjs`.

**Upstream-shaped:** yes.

## Not bugs

- Using a **local** workspace instead of SMB. The sandbox patch refuses network workspaces on purpose.
- Having to re-apply patches after `npm install` / a kernel bump. Anchors that no longer match fail hard (`PATCH_FAIL=anchor-not-unique`). That is the upgrade gate.
- Official dsh closing GitHub Issues and refusing external PRs. Contribute here.
