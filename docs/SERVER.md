# TDH server from this repo

Clone on a Windows machine, then run `pwsh -File scripts\setup-all.ps1` as Administrator. That finds git / node / python, pulls LFS, and starts the server. To wipe a previous install first: `pwsh -File scripts\wipe-tdh-server.ps1`.

That starts:

- download and login on `https://<this-pc>:8443/`
- people API on `127.0.0.1:4181`
- knowledge search on `127.0.0.1:4182`, reached from the LAN at `/company/knowledge` with a login token only (empty until the first night)
- task `TDH-Brain-Daily` at 00:15: reads the day's conversations and distils them into the brain (`server/brain/run-daily.ps1`)
- model gateway on `0.0.0.0:8450`

It does **not** upload or copy:

- company documents
- brain / knowledge text
- model subscription keys
- Tailscale auth keys
- office roster or office IPs

**默认管理员：账号 `tdh`，密码 `12345678`。** 安装脚本用这个账号登录（`LOGIN_PROVE_OK=1`），桌面快捷方式也用它。

Those stay on the machine that runs setup. Setup compiles `TDHarness.exe` for this LAN (`COMPILE_APPHOST_OK=1`), serves `/client/version.json`, and proves the AppHost login URL (`GUI_PROVE_OK=1`) before planting the desktop client. Put a model key in `D:\dsh\runtime\gateway.env` (copied from `server/gateway.env.example`). Restart the `Autostart-Gateway` task after editing.

Fake green: API login on the LAN host while `TDHarness.exe` still has another machine compiled into `Site.LoginUrl`. Setup now rebuilds that exe from `server/AppHost.cs` + this machine's `site.yml`.

Optional, not run by setup: `pwsh -File server\koubo\install.ps1` for the talking-head editing tool (needs Python 3.10–3.12 and Jianying on the machine that opens the drafts).

Both client packages (Windows, and Mac for Apple silicon and Intel) carry OpenCLI for browser work. Each person loads its Chrome extension once; the agent guides them through it. The Windows package also carries Windows-MCP (`windows-mcp/`, its own Python 3.14) for desktop apps; nothing to install on the PC.

Needs: Windows, Administrator, Python 3, Node 22+, Git LFS (`git lfs pull`).
