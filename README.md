# TDHarness-coding

**当前版本 / Version: 2026.10.08.2** · [更新说明 / Changelog](CHANGELOG.md)

**A Windows machine can clone this repo and stand up a full TDH server.** That is the product path. Kernel-only coding setup is still below for people who only want the patched `dsh` CLI.

Whether the coding edition is what you want: **[docs/PRODUCT.md](docs/PRODUCT.md)**. Server install: **[docs/SERVER.md](docs/SERVER.md)**. Bugs: [BUGS.md](BUGS.md).

中文增页（不替代上文）：[项目讲解](docs/BRIEF.zh.md) · [寻找共建者](docs/WANTED.zh.md)

## Install a TDH server (Windows)

Needs Administrator, Python 3, Node 22+, Git LFS.

```powershell
git clone https://github.com/398894496-arch/TDHarness-coding.git
cd TDHarness-coding
git lfs pull
pwsh -File scripts\setup-all.ps1
```

**默认管理员：账号 `tdh`，密码 `12345678`。** 安装会用这个账号登录。打开桌面快捷方式后也用它。这是装机种子账号，不是仓库里的密钥。

Green: `SITE_INSTALL_OK=1`, `LOGIN_PROVE_OK=1`, `GUI_PROVE_OK=1`, `PLANT_CLIENT_OK=1`. Setup compiles `TDHarness.exe` for this LAN, writes `/client/version.json`, and plants the desktop shortcut. Put your own model key in `D:\dsh\runtime\gateway.env`, then restart task `Autostart-Gateway`.

This repo does **not** contain company documents, brain text, subscription keys, Tailscale auth, or an office roster. Those are local to whoever runs setup.

## Kernel-only (optional)

- Node 22+
- Your own DeepSeek (or OpenAI-compatible) API key
- A **local** folder as the workspace (not UNC / a network drive)

```bash
git clone https://github.com/398894496-arch/TDHarness-coding.git
cd TDHarness-coding
bash scripts/setup.sh
export PATH="$HOME/.tdh-coding-prefix/bin:$PATH"
export DEEPSEEK_API_KEY='your-key'
dsh --patch "$PWD/overlays/solo.yml"
```

Windows kernel: `pwsh -File scripts/setup.ps1`. This installs `@deepseek-ai/dsh` from `kernel.yml` into `~/.tdh-coding-prefix` and applies the coding patch subset. It does **not** start 8443 / 8450 / knowledge. Do not point it at a live `node_modules`. The company pins stay off unless `TDH_FULL_PATCHES=1`.

Green: `bash scripts/prove-scan.sh` → `SCAN_OK=1`. After setup: `node scripts/prove-patches.js` → `PATCH_PROVE_OK=1`. Local ChatGPT / Grok / Claude login and custom endpoints: [docs/MODELS.md](docs/MODELS.md) (`node scripts/prove-models.js` → `MODELS_PROVE_OK=1`).

## What the running desk does

On Windows, `scripts/setup-all.ps1` installs this desk on the LAN: login, the seed admin, the gateway, and the desktop shortcut. The optional kernel-only `setup.sh` does not start that stack. Feature write-up: [docs/PRODUCT.md](docs/PRODUCT.md#what-the-running-desk-does). 中文：[docs/PRODUCT.zh.md](docs/PRODUCT.zh.md).

Models are not baked into the clone. In Settings, a subscription lists the models that login can call, and an API key is typed in that provider's model editor. The composer shows the models saved there. Put a gateway key in `D:\dsh\runtime\gateway.env` after install. Do not commit it.

| Session | Colleagues |
| --- | --- |
| ![Session](docs/screenshots/01-session.jpg) | ![Colleagues](docs/screenshots/02-colleagues.jpg) |
| **Personnel** | **Tasks** |
| ![Personnel](docs/screenshots/03-personnel.jpg) | ![Tasks](docs/screenshots/04-tasks.jpg) |

- **Session:** 会话 / 任务, 个人 and 团队 workspaces, model picker, Full access, files.
- **Colleagues:** who is online, role, last login, 7-day local cost estimate (not the vendor bill).
- **Personnel:** department, promote/demote, deactivate, revoke gateway token. Seed admin cannot be deactivated.
- **Tasks:** cards with state and owner (待审批 / 进行中); opening one starts a conversation pinned to that card. Deliverables go on the company disk, and only **提交验收** counts as done, not saying so in chat.

The screenshots use made-up people and tasks.

Also on the server and in the client (October 2026):

- **Knowledge base, filled every night.** Task `TDH-Brain-Daily` (00:15) reads the day's conversations where the desk keeps them, writes an evidence layer and one distilled page per person per day through the gateway, and collects corrections. The desk searches it through `/company/knowledge` (`127.0.0.1:4182`), and only with the login token a person got at sign-in: a revoked token or a disabled person gets nothing, a name typed into a header is ignored, and each search is logged (who, how many hits, not the question). Everyone on the roster sees the whole brain for now.
- **Web search through the gateway.** Chinese queries go to domestic engines first (Bing China, 360) with Exa alongside; GitHub, Bilibili and YouTube have their own channels. A query starting with `深搜 ` is answered by Grok's own web search with sources; it finishes in the background and is picked up by asking the same query again.
- **Browser work.** The Windows client ships OpenCLI with its Chrome extension in `opencli/`. The first time the agent needs a browser it checks the bridge, and if the extension is not loaded it walks the person through loading it, one step at a time.
- **Desktop apps (Windows and Mac).** The Windows client ships [Windows-MCP](https://github.com/CursorTouch/Windows-MCP) 0.8.7 with its own Python in `windows-mcp/`, so the agent can read windows and click, type, scroll, drag and press shortcuts in desktop software such as Jianying (CapCut China). Registry and PowerShell tools are left out, and exporting, overwriting, deleting or sending waits for the person's yes. Jianying draws its own controls, so the agent works from screenshots there: cutting stays in the draft files the editing tool writes, and the app is used for its own online features, checking and export. The Mac client ships [Peekaboo](https://github.com/openclaw/Peekaboo) 4.9.0 (signed and notarized, Apple silicon and Intel) in `peekaboo/` for the same work; its own-AI and browser tools are hidden. On first use the agent checks permissions and walks the person through turning on Accessibility and Screen Recording in System Settings.
- **Long conversations.** Context is compacted automatically at 80% of the model's window (400K of Grok's 500K) and again if the provider reports the prompt too long. `/compact` does it by hand.
- **Talking-head editing (optional).** `pwsh -File server\koubo\install.ps1` installs a tool that turns a recording into a Jianying (CapCut China) draft: alignment, transcription that tells the presenter from an off-screen voice, cuts, stabilisation, subtitles and layouts. The agent follows `SKILL.md` beside it.

Both client packages carry kernel 0.2.1-alpha.1. The Mac package runs on Apple silicon and Intel; it does not ship ffmpeg (`brew install ffmpeg` if the agent should watch videos). `kernel.yml` pins the kernel for the kernel-only path below, not for the desk.

## Open work

C1–C9 are closed in **[BUGS.md](BUGS.md)** (sandbox, secrets, junctions, search errors, local model login). Pick a remaining hole from that file, or file a Bug.

Fork + PR. Open a **Task** issue with the id first. [CONTRIBUTING.md](CONTRIBUTING.md). Same list in Chinese: [寻找共建者](docs/WANTED.zh.md). Upstream door (no PRs): [docs/UPSTREAM.md](docs/UPSTREAM.md).
