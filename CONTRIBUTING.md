# Contributing

PRs and Issues belong **in this repository**. Upstream [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) is MIT and does not take external pull requests; their Issues are closed.

You do not need a company network, a roster, or collaborator rights. Fork, pick an id from [BUGS.md](BUGS.md), open a **Task** issue, then PR.

## Lowest-cost ways to help (in order)

1. Run the [README](README.md) install on a **local** folder. File a **Bug** if setup or first `dsh --patch` fails. That is already useful.
2. Comment `taking C#` on an open Task (or open one) so two people do not duplicate it.
3. Send a PR that prints a new `*_OK=1` line. Marks in the patcher grepped by `prove-patches.js` are not enough if BUGS.md asked for behavior.

Kernel bugs that reproduce on **stock** `dsh` with no patch: also post in [upstream Discussions](https://github.com/deepseek-ai/deepseek-harness/discussions) and link both ways.

## Before a PR

1. `bash scripts/prove-scan.sh` → `SCAN_OK=1`.
   Run `node scripts/prove-unc.js` → `UNC_PROVE_OK=1` for sandbox path behavior (no kernel install or `KERNEL_PREFIX` needed).
2. If you touched patches or prove scripts: `node scripts/prove-patches.js` → `PATCH_PROVE_OK=1` (needs a gold prefix: `KERNEL_PREFIX`, or `~/.tdh-coding-prefix` after setup, or `~/dsh-kernel/0-1-1-rc-2`).
3. Paths and script names ASCII only. UI fonts if you touch CSS: `"Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", "Noto Sans SC", sans-serif`.
4. Do not add office IPs, auth keys, roster files, or a live `node_modules` dump.

CI on this repo runs the scan and (when npm can install the pin) the patch prove. A red X on your PR is the same bar.

## Patch rules

Kernel edits go through `patches/apply-kernel-patches.js` as **anchored** replacements. If an anchor is not unique, fail. Do not vendor a whole upstream file.

Never run the patcher against `~/.local`, `~/dsh-node-rc8`, or another live prefix. Setup uses `~/.tdh-coding-prefix`.

New marks need a unique `company-…-vN` string and a line in [BUGS.md](BUGS.md) (either “claim” or “patched”).

## What “done” is not

- A longer README with no `*_OK=1`.
- Hot-fixing a running `node_modules`.
- Opening a PR on `deepseek-ai/deepseek-harness` (they will not merge it).
- Company login, Tailscale, Caddy, or SMB chairs. Wrong tree.

## Plugins

Separate plugin repos can use the GitHub topic `dsh-plugin`. Keep the canonical hole list in [BUGS.md](BUGS.md) so it does not fork into Discord-only lore.

Layout and planes: [docs/HACKING.md](docs/HACKING.md).
