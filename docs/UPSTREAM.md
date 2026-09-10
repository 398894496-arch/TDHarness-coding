# Upstream (DeepSeek Harness)

Official [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) does **not** take external PRs. Issues are closed. The only door is [Discussions](https://github.com/deepseek-ai/deepseek-harness/discussions).

This file is extra. Product PRs stay in **this** repo.

## Three different posts (do not mix)

| Kind | Category | What to put |
| --- | --- | --- |
| Kernel bug on **stock** `@deepseek-ai/dsh` (no patch, no overlay) | General, title `[bug] …` | One bug per thread. Repro. Version. OS. |
| This coding tree | General (not Show Your Plugins) | Link the repo. Say it is a **patch tree**, not a `dsh-plugin`. |
| Company desk / roster / Tailscale / Caddy | — | Do not post. |

## Search before opening

Related threads already exist. Prefer a comment there:

| Our mark | Upstream already | Action |
| --- | --- | --- |
| `mklink /J` / junction EPERM | [#2094](https://github.com/deepseek-ai/deepseek-harness/discussions/2094) | Comment: UNC as `cmd` cwd still fails; Developer Mode still required for `fs.symlinkSync(..., "junction")` |
| SMB `SetFileSecurityW` / `ReplaceFileW` | [#3919](https://github.com/deepseek-ai/deepseek-harness/discussions/3919) | Comment: UNC share, Win32 5 |
| Session `link` ENOTSUP | [#3884](https://github.com/deepseek-ai/deepseek-harness/discussions/3884), [#4981](https://github.com/deepseek-ai/deepseek-harness/discussions/4981) | Comment: macOS smbfs, same hard-link publish |
| Mapped drive as workspace | [#3749](https://github.com/deepseek-ai/deepseek-harness/discussions/3749) | Read first; our C2 is the sandbox ACL side |

Open a **new** General thread only if stock dsh still reproduces **and** the existing thread is a different failure (e.g. #2094 is “second boot does not see its own junction”, not “cwd is UNC”).

## Template

```
**dsh:** 0.1.2-rc.1 (stock, no overlay)
**OS:** Windows 11 / macOS …
**Repro:** (shortest steps, local paths only)
**Expected:**
**Actual:** (error code / stderr)
**Workaround we use:** https://github.com/398894496-arch/TDHarness-coding  mark `company-…-vN`
```

Posted 2026-09-03 as `398894496-arch` (do not duplicate):

- Comment [2094](https://github.com/deepseek-ai/deepseek-harness/discussions/2094#discussioncomment-18267957)
- Comment [3919](https://github.com/deepseek-ai/deepseek-harness/discussions/3919#discussioncomment-18267959)
- Comment [3884](https://github.com/deepseek-ai/deepseek-harness/discussions/3884#discussioncomment-18267960)
- Showcase [5531](https://github.com/deepseek-ai/deepseek-harness/discussions/5531)

Discord / Feishu were not posted (no bot). Drop those URLs by hand if needed.

