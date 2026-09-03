# Contributing

PRs and Issues are welcome **in this repository**.

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) is MIT and does not accept external pull requests. Their GitHub Issues are closed. For a bug that reproduces on stock `@deepseek-ai/dsh` with no patch and no overlay, also post in [upstream Discussions](https://github.com/deepseek-ai/deepseek-harness/discussions) and link this repo.

## Before a PR

1. `bash scripts/prove-scan.sh` must print `SCAN_OK=1`.
2. `node scripts/prove-patches.js` must print `PATCH_PROVE_OK=1` (needs a gold prefix: `KERNEL_PREFIX` or `~/dsh-kernel/0-1-1-rc-2`).
3. Paths and script names ASCII only. UI fonts if you touch CSS: `"Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", "Noto Sans SC", sans-serif`.
4. Do not add office IPs, auth keys, roster files, or a live `node_modules` dump.

## Patch rules

Kernel edits go through `patches/apply-kernel-patches.js` as anchored replacements. If an anchor is not unique, fail. Do not vendor a whole upstream file.

Never run the patcher against `~/.local` or another live prefix.

## Plugins

Separate plugin repos can use the GitHub topic `dsh-plugin`. Keep the canonical bug list in [BUGS.md](BUGS.md) / Issues here.
