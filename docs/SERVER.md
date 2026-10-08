# TDH server from this repo

Clone on a Windows machine, then run `powershell -ExecutionPolicy Bypass -File scripts\setup-all.ps1` as Administrator (PowerShell 7 `pwsh` works too). That finds git / node / python, pulls LFS, and starts the server. Running it again on a live server keeps the roster, passwords and model keys. To wipe a previous install first: `powershell -ExecutionPolicy Bypass -File scripts\wipe-tdh-server.ps1`.

That starts:

- download and login on `https://<this-pc>:8443/`
- people API on `127.0.0.1:4181`
- knowledge search on `127.0.0.1:4182`, reached from the LAN at `/company/knowledge` with a login token only (empty until the first night)
- task `TDH-Brain-Daily` at 00:15: reads the day's conversations and distils them into the brain (`server/brain/run-daily.ps1`)
- model gateway on port 8450, IPv4 and IPv6 (clients that resolve `<name>.local` often get the IPv6 link-local address first)

It does **not** upload or copy:

- company documents
- brain / knowledge text
- model subscription keys
- Tailscale auth keys
- office roster or office IPs

**默认管理员：账号 `tdh`，密码 `12345678`。** 安装脚本用这个账号登录（`LOGIN_PROVE_OK=1`），桌面快捷方式也用它。

Those stay on the machine that runs setup. Setup compiles `TDHarness.exe` for this LAN (`COMPILE_APPHOST_OK=1`), serves `/client/version.json`, and proves the AppHost login URL (`GUI_PROVE_OK=1`) before planting the desktop client. Put a model key in `D:\dsh\runtime\gateway.env` (copied from `server/gateway.env.example`). Restart the `Autostart-Gateway` task after editing.

Fake green: API login on the LAN host while `TDHarness.exe` still has another machine compiled into `Site.LoginUrl`. Setup now rebuilds that exe from `server/AppHost.cs` + this machine's `site.yml`.

## Site address

Setup bakes the site address into every client it builds. The default is this PC's mDNS name, `<computername>.local` (for a computer named `TDH`: `https://tdh.local:8443/`), so a network change or a new DHCP lease does not break installed desks. Pass `-HostName <ip>` to `setup-server.ps1` only when clients sit on another subnet or VLAN: mDNS does not cross routers.

- Port 8443 also answers plain http and redirects to https, so `tdh.local:8443` typed without `https://` works.
- A desk running Clash (or another proxy) in TUN / fake-ip mode resolves `.local` to `198.18.x.x`. Add `+.local` to its fake-ip filter or turn TUN off. The client says this in the login box instead of a bare "连不上公司网".
- Renamed the computer? Run `powershell -ExecutionPolicy Bypass -File server\retarget-site.ps1` once: it moves `site.yml`, Caddy, both client zips, `TDHarness.exe` and the signature to the new name. Desks installed under the old name must reinstall from the new URL.

## Models: keys stay on this machine

Subscriptions and keys live only on this server. Desks reach models through the gateway on 8450 with a per-person gateway token (revocable from 人员) and never hold a vendor key; the kernel's direct vendor route is off on desks.

| What | Where it goes | Models it serves |
| --- | --- | --- |
| OpenAI API key | `OPENAI_API_KEY` | `gpt-*`, `o1`/`o3`/`o4*`, `chatgpt-*` |
| Anthropic API key | `ANTHROPIC_API_KEY` (Anthropic's OpenAI-compatible endpoint) | `claude-*` |
| DeepSeek API key | `DEEPSEEK_API_KEY` | `deepseek-*` |
| xAI API key | `XAI_API_KEY` | `grok-*` |
| Kimi / Zhipu API key | `KIMI_API_KEY` / `GLM_API_KEY` | `kimi-*`, `moonshot-*` / `glm-*` |
| Any OpenAI-compatible endpoint | Settings → 模型 → custom; stored as `KEY_<ID>` with its base URL and models in `channels.json` | the models you list |
| Grok subscription (SuperGrok / X Premium) | OAuth file `D:\dsh\runtime\oauth\xai-account.json`; the gateway renews it, and it wins over `XAI_API_KEY` | `grok-*`, plus the weekly quota in Settings and the Grok image / video tools |

The admin adds keys in Settings → 模型; that writes `gateway.env` on the server. [server/gateway.env.example](../server/gateway.env.example) lists every line.

The Grok OAuth file comes from signing in to xAI's Grok CLI login with a tool such as [CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI) on any computer, then copying the `xai-*.json` it writes to the path above. Remove it from that tool afterwards: the refresh token rotates, and two places renewing the same login knock each other out. Whether one person's subscription may serve a team is between you and xAI.

ChatGPT Plus/Pro and Claude Pro/Max are personal plans and are not relayed to a team here. Use OpenAI and Anthropic API keys, which are meant for teams and programs.

Every desk lists exactly the models this server can reach (fetched from `/v1/company-models` at login), so the picker never offers one the gateway would refuse. New sessions start on `DEFAULT_MODEL` / `DEFAULT_EFFORT` from `gateway.env`; without it, on the first available model (subscription first). People can still switch per session.

## Client updates are signed

Setup creates an Ed25519 key in `D:\dsh\runtime\pack-sign\`. Clients ship with its public half and refuse an update whose `version.json` signature or zip sha256 does not match. **Back up `pack-sign.key`.** Losing it means every installed desk refuses the next update until it is reinstalled. Never copy it off this machine otherwise.

To publish a client update on a site (fixes in `server\site-patches`, new build mark, recompiled exe and installer, resealed, signed):

```powershell
powershell -ExecutionPolicy Bypass -File server\publish-site-update.ps1 -BumpMark
```

Desks see the new mark on their next launch and offer the update. The product tree check runs in the background on every launch and once after an update; results go to `tree-check.last.txt` in the desk's config folder.

## Accounts on first login

The login API heals the two things a remote desk needs before it can open: the `dshshare` Windows account that every desk mounts the company share with, and the person's `emp-<login>` folder. Login names are matched case-insensitively. Passwords are in `D:\dsh\runtime\caddy\PASSWORDS.txt`, one `login:password` per line, read on every login: change the seed admin's `12345678` there after install (Settings has no password page yet).

Optional, not run by setup: `powershell -ExecutionPolicy Bypass -File server\koubo\install.ps1` for the talking-head editing tool (needs Python 3.10–3.12 and Jianying on the machine that opens the drafts).

Both client packages (Windows, and Mac for Apple silicon and Intel) carry OpenCLI for browser work. Each person loads its Chrome extension once; the agent guides them through it. The Windows package also carries Windows-MCP (`windows-mcp/`, its own Python 3.14) and the Mac package carries Peekaboo (`peekaboo/`) for desktop apps; nothing to install. On a Mac the person turns on Accessibility and Screen Recording once, guided by the agent.

Needs: Windows, Administrator, Python 3, Node 22+, Git LFS (`git lfs pull`).
