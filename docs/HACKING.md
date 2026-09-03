# Hacking

This is a coding tree on official DeepSeek Harness. Creator-mode skills in the official package teach **how** to inspect and patch; they are not a ban on changing the framework.

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

See `kernel.yml`. To bump: install a fresh prefix, run `patches/apply-kernel-patches.js`, fix anchors that fail, then change the pin.

## Chinese UI

Path and script names ASCII. Fonts: `"Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", "Noto Sans SC", sans-serif`.
