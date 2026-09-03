# TDHarness-coding

Small team: clone, pin official `dsh`, apply patches, put in your API key, start a desk. **Usable. Not a mature product.**

Product detail: [docs/PRODUCT.md](docs/PRODUCT.md). Known issues: [BUGS.md](BUGS.md).


Upstream: [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) (MIT). They do not take external PRs. Work happens here. Vanilla kernel bugs can also go to [upstream Discussions](https://github.com/deepseek-ai/deepseek-harness/discussions).

中文：**三五个人装上能干活，但不是成熟产品。** 已知坑见 [BUGS.md](BUGS.md)。

## Requirements

- Node 22+
- A DeepSeek (or OpenAI-compatible) API key
- macOS, Windows, or Linux
- A **local** folder as the agent workspace (network/UNC workspaces are intentionally refused by the sandbox patch)

## Install

```bash
git clone https://github.com/398894496-arch/TDHarness-coding.git
cd TDHarness-coding
bash scripts/setup.sh
```

Windows (PowerShell):

```powershell
git clone https://github.com/398894496-arch/TDHarness-coding.git
cd TDHarness-coding
pwsh -File scripts/setup.ps1
```

Then:

```bash
export PATH="$HOME/.tdh-coding-prefix/bin:$PATH"
export DEEPSEEK_API_KEY='your-key'
# optional: export DEEPSEEK_BASE_URL='https://api.deepseek.com/v1'
dsh --patch "$PWD/overlays/solo.yml"
```

`setup` installs `@deepseek-ai/dsh@0.1.1-rc.2` into `~/.tdh-coding-prefix` and applies [patches/apply-kernel-patches.js](patches/apply-kernel-patches.js). It refuses well-known live trees (`~/.local`, `~/dsh-node-rc8`). Never point the patcher at a running `node_modules`.

## What this is / is not

| Is | Is not |
|---|---|
| Coding tree you can patch and PR | A finished client or SLA |
| Official `dsh` + our kernel patches | A substitute for the official install |
| Solo overlay (local workspace, your key) | Office login, Tailscale, SMB chairs, Caddy |
| Issues on **this** repo | Upstream GitHub Issues (they are closed) |

## Prove

```bash
bash scripts/prove-scan.sh     # no office IPs / keys in this tree
node scripts/prove-patches.js  # apply onto a throwaway copy of a gold prefix
```

Green: `SCAN_OK=1` and `PATCH_PROVE_OK=1`.

## Contribute

PRs and Issues on this repo. See [CONTRIBUTING.md](CONTRIBUTING.md) and [docs/HACKING.md](docs/HACKING.md). Plugins you publish separately can use the `dsh-plugin` topic; keep the bug list here so it does not fork into Discord-only lore.
