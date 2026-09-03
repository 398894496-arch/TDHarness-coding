# TDHarness-coding

**Get running in five minutes.** Whether this is the product you want is in **[docs/PRODUCT.md](docs/PRODUCT.md)** (coding edition: usable, not mature). Bugs: [BUGS.md](BUGS.md).

## You need

- Node 22+
- Your own DeepSeek (or OpenAI-compatible) API key
- A **local** folder as the workspace (not UNC / a network drive)

## Install

```bash
git clone https://github.com/398894496-arch/TDHarness-coding.git
cd TDHarness-coding
bash scripts/setup.sh
export PATH="$HOME/.tdh-coding-prefix/bin:$PATH"
export DEEPSEEK_API_KEY='your-key'
dsh --patch "$PWD/overlays/solo.yml"
```

Windows: `pwsh -File scripts/setup.ps1`. Setup installs `@deepseek-ai/dsh@0.1.1-rc.2` into `~/.tdh-coding-prefix` and applies patches. Do not point it at a live `node_modules`.

Green: `bash scripts/prove-scan.sh` → `SCAN_OK=1`. If you have a gold prefix: `node scripts/prove-patches.js` → `PATCH_PROVE_OK=1`.

Contribute with a fork + pull request. [CONTRIBUTING.md](CONTRIBUTING.md).
