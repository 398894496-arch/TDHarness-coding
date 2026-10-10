# TDHarness-coding

**当前版本 / Version: 2026.10.10.2** · [更新说明 / Changelog](CHANGELOG.md)

**TDH (TDHarness) is a self-hosted AI workbench for a company LAN.** One Windows server holds the model keys and subscriptions, the company share and the roster; employees run a desktop client (Windows or Mac) that talks only to that server. It is built on [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (`dsh`), patched for a company setting. 中文：一台 Windows 服务器管模型钥匙、公司盘和花名册，员工电脑装桌面客户端，只连这台服务器。

## Delivery is a one-click install / 交付就是一键安装

| Who | What they do | What they get |
| --- | --- | --- |
| **The server** (one Windows PC, once) | `git clone`, then **one command**: `scripts\setup-all.ps1` | Login, seed admin, roster, model gateway, knowledge base and its nightly job, the download page, and both desktop clients compiled for this LAN. Green: `SITE_INSTALL_OK=1` |
| **Employees on Windows** | Open `https://<computername>.local:8443/`, click 下载 Windows 版, run `TDHarness-Setup.exe` | Installs into the user's TDH folder with a desktop shortcut, then sign in with a roster account |
| **Employees on Mac** | Same page, 下载 macOS 版, unzip, drag TDHarness to Applications | Same desk (Apple silicon and Intel) |
| **Updates** | Admin runs `server\publish-site-update.ps1` | Desks offer the update on their next launch; signed, delta when possible, resumable |

中文：服务器端克隆后**一条命令**装完整套服务；员工打开服务器的下载页，Windows 点一下下载 `TDHarness-Setup.exe` 双击安装，Mac 下载解压拖进「应用程序」。之后的更新由服务器发布，客户端下次打开时提示更新。员工不碰补丁、Node 或命令行；服务器只需事先装好 Git（含 LFS）、Node 22+、Python 3，再以管理员身份跑那一条命令。

**Why there is no Setup.exe on the Releases page.** Each site's installer carries that server's address and that server's own update-signing key, so setup compiles it on the server. A generic download would not know where to sign in or whose updates to trust. 中文：安装包里写着这台服务器的地址和它自己的更新签名钥匙，所以由装机脚本在服务器上现场编译，不放通用下载。

**What "patch tree" means here.** It describes the *source*, not the delivery: the upstream kernel `@deepseek-ai/dsh` is pinned in [kernel.yml](kernel.yml) and installed from npm, and this repo's patches are applied on top during setup, instead of keeping a vendored fork of upstream. 中文：「补丁树」只说明源码怎么挂在上游内核上（锁版本、装机时打补丁、不复制上游代码），不是交付形态。

The optional kernel-only path further down is for people who only want the patched `dsh` CLI; it does not start any of the above.

Whether the coding edition is what you want: **[docs/PRODUCT.md](docs/PRODUCT.md)**. Server install: **[docs/SERVER.md](docs/SERVER.md)**. Bugs: [BUGS.md](BUGS.md).

中文增页（不替代上文）：[项目讲解](docs/BRIEF.zh.md) · [寻找共建者](docs/WANTED.zh.md)

## Install a TDH server (Windows)

Needs Windows 10/11 or Windows Server, Administrator, Python 3, Node 22+, Git with Git LFS. The built-in Windows PowerShell is enough (PowerShell 7 `pwsh` also works).

```powershell
git clone https://github.com/398894496-arch/TDHarness-coding.git
cd TDHarness-coding
git lfs pull
powershell -ExecutionPolicy Bypass -File scripts\setup-all.ps1
```

**默认管理员：账号 `tdh`，密码 `12345678`。** 安装会用这个账号登录。打开桌面快捷方式后也用它。这是装机种子账号，不是仓库里的密钥。**装完请马上改掉**：设置 → 账号 → 修改密码。重跑安装不会覆盖已有的账号和密码。

**Employees** download the client from `https://<computername>.local:8443/` (Windows or Mac; the browser warns about the self-signed certificate once) and sign in with the account an admin created in Settings → 人员.

The site address defaults to this PC's `<computername>.local`; add `-HostName <ip>` only for clients on another subnet. Client updates are signed with a key setup creates on this PC: back it up ([docs/SERVER.md](docs/SERVER.md#client-updates-are-signed)).

Green: `SITE_INSTALL_OK=1`, `LOGIN_PROVE_OK=1`, `GUI_PROVE_OK=1`, `PLANT_CLIENT_OK=1`. Setup compiles `TDHarness.exe` for this LAN, writes `/client/version.json`, and plants the desktop shortcut. Then add a model key or subscription: Settings → 模型 as the admin, or edit `D:\dsh\runtime\gateway.env`. The gateway reads it on every request, no restart; desks pick up a hand-edited file within 10 minutes.

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

Windows kernel: `powershell -ExecutionPolicy Bypass -File scripts\setup.ps1`. This installs `@deepseek-ai/dsh` from `kernel.yml` into `~/.tdh-coding-prefix` and applies the coding patch subset. It does **not** start 8443 / 8450 / knowledge. Do not point it at a live `node_modules`. The company pins stay off unless `TDH_FULL_PATCHES=1`.

Green: `bash scripts/prove-scan.sh` → `SCAN_OK=1`. After setup: `node scripts/prove-patches.js` → `PATCH_PROVE_OK=1`. Local ChatGPT / Grok / Claude login and custom endpoints: [docs/MODELS.md](docs/MODELS.md) (`node scripts/prove-models.js` → `MODELS_PROVE_OK=1`).

## What the running desk does

On Windows, `scripts/setup-all.ps1` installs this desk on the LAN: login, the seed admin, the gateway, and the desktop shortcut. The optional kernel-only `setup.sh` does not start that stack. Feature write-up: [docs/PRODUCT.md](docs/PRODUCT.md#what-the-running-desk-does). 中文：[docs/PRODUCT.zh.md](docs/PRODUCT.zh.md).

**Models.** Keys and subscriptions live only on the server and never go to the desks. An admin adds them in Settings → 模型, which writes `D:\dsh\runtime\gateway.env` on the server (see [server/gateway.env.example](server/gateway.env.example)): API keys for OpenAI, Anthropic, DeepSeek, xAI, Kimi, Zhipu GLM, or any OpenAI-compatible endpoint; a Grok subscription is the OAuth file `D:\dsh\runtime\oauth\xai-account.json`. The gateway on 8450 routes each model to its vendor; desks reach it over TLS through Caddy (`8443/gw`, trusting this server's own root) and it answers only a live per-person login token (only an admin's token can change keys; details in [docs/SERVER.md](docs/SERVER.md#who-the-gateway-answers)), and every desk lists exactly the models the server can reach (synced at login) with the site default `DEFAULT_MODEL`. ChatGPT and Claude consumer subscriptions are personal plans and are not relayed to a team; use their API keys. Details: [docs/SERVER.md](docs/SERVER.md#models-keys-stay-on-this-machine). Do not commit keys.

| Session | Colleagues |
| --- | --- |
| ![Session](docs/screenshots/01-session.jpg) | ![Colleagues](docs/screenshots/02-colleagues.jpg) |
| **Personnel** | **Tasks** |
| ![Personnel](docs/screenshots/03-personnel.jpg) | ![Tasks](docs/screenshots/04-tasks.jpg) |

- **Session:** 会话 / 任务, 个人 and 团队 workspaces, model picker, Full access, files.
- **Colleagues:** who is online, role, last login, 7-day local cost estimate (not the vendor bill).
- **Personnel:** department, promote/demote, force a fresh sign-in, deactivate, remove. 强制重新登录 only makes the person sign in again. Deactivating cuts the person off from sign-in, models, web search, image/video generation, the knowledge base and the company share (their own share account is switched off) on the next request. A deactivated account can then be removed for good: off the roster, its password gone, its login never handed out again; the personal folder stays on the company share. Seed admin cannot be deactivated or removed.
- **Tasks:** cards with state and owner (待审批 / 进行中); opening one starts a conversation pinned to that card. Deliverables go on the company disk, and only **提交验收** counts as done, not saying so in chat.

The screenshots use made-up people and tasks.

Also on the server and in the client (October 2026):

- **Knowledge base, filled every night.** Task `TDH-Brain-Daily` (00:15) reads the day's conversations where the desk keeps them, writes an evidence layer and one distilled page per person per day through the gateway, and collects corrections. The desk searches it through `/company/knowledge` (`127.0.0.1:4182`), and only with the login token a person got at sign-in: a revoked token or a disabled person gets nothing, a name typed into a header is ignored, and each search is logged (who, how many hits, not the question). Everyone on the roster sees the whole brain for now.
- **Web search through the gateway.** Chinese queries go to domestic engines first (Bing China, 360) with Exa alongside; GitHub, Bilibili and YouTube have their own channels. A query starting with `深搜 ` is answered by Grok's own web search with sources; it finishes in the background and is picked up by asking the same query again.
- **Browser work.** The Windows client ships OpenCLI with its Chrome extension in `opencli/`. The first time the agent needs a browser it checks the bridge, and if the extension is not loaded it walks the person through loading it, one step at a time.
- **Generated images and videos in the conversation.** A file the agent hands over shows right in the conversation: an image as a picture (click to open it large), a video as a player, and every handed-over file has a download button that saves it to the person's computer. The side panel's file view has the same download button.
- **Desktop apps (Windows and Mac).** The Windows client ships [Windows-MCP](https://github.com/CursorTouch/Windows-MCP) 0.8.7 with its own Python in `windows-mcp/`, so the agent can read windows and click, type, scroll, drag and press shortcuts in desktop software such as Jianying (CapCut China). Registry and PowerShell tools are left out, and exporting, overwriting, deleting or sending waits for the person's yes. Jianying draws its own controls, so the agent works from screenshots there: cutting stays in the draft files the editing tool writes, and the app is used for its own online features, checking and export. The Mac client ships [Peekaboo](https://github.com/openclaw/Peekaboo) 4.9.0 (signed and notarized, Apple silicon and Intel) in `peekaboo/` for the same work; its own-AI and browser tools are hidden. On first use the agent checks permissions and walks the person through turning on Accessibility and Screen Recording in System Settings.
- **Long conversations.** Context is compacted automatically at 80% of the model's window (400K of Grok's 500K) and again if the provider reports the prompt too long. `/compact` does it by hand.
- **Talking-head editing (optional).** `powershell -ExecutionPolicy Bypass -File server\koubo\install.ps1` installs a tool that turns a recording into a Jianying (CapCut China) draft: alignment, transcription that tells the presenter from an off-screen voice, cuts, stabilisation, subtitles and layouts. The agent follows `SKILL.md` beside it.

Both client packages carry kernel 0.2.1-alpha.1. The Mac package runs on Apple silicon and Intel; it does not ship ffmpeg (`brew install ffmpeg` if the agent should watch videos). `kernel.yml` pins the kernel for the kernel-only path below, not for the desk.

## Open work

Every listed item (C1–C9, C2b) is closed in **[BUGS.md](BUGS.md)** (sandbox, secrets, junctions, Linux CIFS, search errors, local model login). Nothing is open to claim right now: file a Bug, or open a Task issue with a proposal and its green line.

Fork + PR. Open a **Task** issue with the id first. [CONTRIBUTING.md](CONTRIBUTING.md). Same list in Chinese: [寻找共建者](docs/WANTED.zh.md). Upstream door (no PRs): [docs/UPSTREAM.md](docs/UPSTREAM.md).
