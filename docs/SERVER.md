# TDH server from this repo

Clone on a Windows machine, then run `powershell -ExecutionPolicy Bypass -File scripts\setup-all.ps1` as Administrator (PowerShell 7 `pwsh` works too). That finds git / node / python, pulls LFS, and starts the server. Running it again on a live server keeps the roster, passwords and model keys. To wipe a previous install first: `powershell -ExecutionPolicy Bypass -File scripts\wipe-tdh-server.ps1` (lists what it would remove; add `-Yes` to remove it, see [Uninstall](#upgrade-back-up-uninstall)).

That starts:

- download and login on `https://<this-pc>:8443/`
- people API on `127.0.0.1:4181`
- knowledge search on `127.0.0.1:4182`, reached from the LAN at `/company/knowledge` with a login token only (empty until the first night). Put company documents in `D:\dsh\company\_handbook\_company` (everyone) or `_handbook\<dept id>` (that department); `.md .txt .csv .docx .xlsx .pptx .pdf` are read, and old binary Office / WPS files (`.doc .xls .ppt .wps .et .dps`) once the venv below is in place; scanned PDF pages and pictures (`.png .jpg .jpeg .bmp .tif .webp`, 20 KB to 25 MB) go through OCR in the background once `server\install-ocr.ps1` has run (setup runs it; it needs internet for pip the first time, about 150 MB into `D:\dsh\ocr-venv`, and turns OCR on only after reading a test image correctly). The `status` route reports what was skipped and why, and the OCR queue. PDF text is kept in `D:\dsh\runtime\kb-cache` so a restart does not read every PDF again; the folder is safe to delete. Nothing to rebuild: the search notices new and changed files on the next question.
- task `TDH-Brain-Daily` at 00:15: reads the day's conversations and distils them into the brain (`server/brain/run-daily.ps1`)
- model gateway on port 8450, IPv4 and IPv6 (clients that resolve `<name>.local` often get the IPv6 link-local address first)

It does **not** upload or copy:

- company documents
- brain / knowledge text
- model subscription keys
- Tailscale auth keys
- office roster or office IPs

**默认管理员：账号 `tdh`，初始密码每次安装随机生成**：装机结束时显示（`DEFAULT_PASSWORD=`），也存在服务器的 `D:\dsh\runtime\caddy\seed-admin.txt`（只有管理员能读）。 安装脚本用它自检登录（`LOGIN_PROVE_OK=1`；密码已经改过时打印 `LOGIN_PROVE_SKIPPED=seed-password-changed`），桌面快捷方式也用它。

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

### Who the gateway answers

Desks reach the gateway over TLS: Caddy on the login port forwards `https://<this-pc>:8443/gw/...` to the gateway on `127.0.0.1:8450`, and desks trust this server's own Caddy root, which they carry in their signed pack (`company-ca.crt`). The gateway checks every request itself and trusts no address:

| Request | Needs |
| --- | --- |
| Model calls, vendor files, `/search`, `/fetch`, `/images`, `/videos` | A live login token: in `runtime\gw-tokens.json`, not revoked, and its person active on the roster. Otherwise `401` |
| `POST /channels` (add, replace or drop a key; channel settings) | The live token of an **admin**. Otherwise `401` / `403`, and `gateway.env` / `channels.json` are left alone |
| `/health` | Nothing |
| `GET /channels`, `/v1/company-models`, `/grok-quota`, `/grok-fast` | A live token too: they name custom upstreams and make the gateway probe vendors |
| Jobs on this PC (nightly brain job, deep search calling the model door) | The service token in `runtime\gw-service.token`, made by the gateway at start, readable by administrators only. It spends keys like a person; it cannot change them |
| A request straight from the LAN to 8450 (plaintext) | Refused (`403`, `gateway_plaintext`) once `runtime\company-ca.crt` exists, unless `gateway.env` has `GW_PLAIN_LAN=1` |

Coming from `127.0.0.1` is worth nothing: Caddy forwards every desk from there, and a proxy on this PC (Clash with "allow LAN") would make any LAN request look local. Every request needs its token.

Revoking a token or deactivating a person in 人员 takes effect on the next request; the gateway rereads both files when either changes. Every refusal prints a `GW_DENY` line in the gateway log, with the desk's own address when it came through Caddy. `node scripts/prove-gw-auth.js` proves all of the above against a stand-in vendor (`GW_AUTH_PROVE_OK=1`); `node scripts/prove-gw-tls.js` proves the TLS switch and the `/fetch` guard (`GW_TLS_PROVE_OK=1`).

**The TLS switch.** `server\export-ca.ps1` copies Caddy's root (made by `tls internal` on Caddy's first start) to `runtime\company-ca.crt`. That one file decides everything: the site patches move desks to `8443/gw` and pack the root, `TDHarness.exe` is built with the https gateway, and the gateway starts refusing plaintext from the LAN. `publish-site-update.ps1` exports it every time. A fresh install builds its packs before Caddy has ever run, so setup exports the root after the services are up and publishes once more. **Upgrading a live server:** desks already installed still talk plain 8450 until they take the update, so put `GW_PLAIN_LAN=1` in `gateway.env` first (setup does this itself when it sees desks were already out), publish with `-BumpMark`, and remove the line once every desk has updated. A new Caddy root (Caddy's data wiped) means publishing again.

**Ending the bridges.** The gateway records what `GW_ALLOW_TOKENLESS` and `GW_PLAIN_LAN` still let through, by desk address, in `runtime\gw-legacy.json`. `powershell -ExecutionPolicy Bypass -File server\gw-transition.ps1 -Status` shows it; `-Finish` removes both lines and the LAN firewall rule for 8450 (`tdh-lan-8450`), sets `GW_LISTEN=local` so the gateway listens on 127.0.0.1 only (even with the firewall off) and restarts it, and refuses while a bridge was used in the last 72 hours, or while the record itself is younger than that (it starts when a gateway of this version first runs; `-QuietHours`, or `-Force`). A fresh install closes that rule and sets `GW_LISTEN=local` itself once TLS is ready.

`/fetch` reads public pages only: the address as written, where its name really resolves, and every redirect hop are checked against private, loopback, link-local, CGNAT and multicast ranges.

**Desks installed before 2026.10.09.4** sent no token on web search and image/video generation (Windows) or on model calls (Mac). The fix is a site patch (`site-patches/patch_gw_token.py`), so after updating this repo on the server run `publish-site-update.ps1 -BumpMark` and have everyone accept the update on their next launch. Until a desk has it, those requests get `401`. To bridge that window, add `GW_ALLOW_TOKENLESS=1` to `gateway.env` (read on every request, no restart): a request with **no token at all** is let through again, a wrong or revoked token is still refused, and key changes stay admin-only. Remove the line once every desk is updated.

## Client updates are signed

Setup creates an Ed25519 key in `D:\dsh\runtime\pack-sign\`. Clients ship with its public half and refuse an update whose `version.json` signature or zip sha256 does not match. **Back up `pack-sign.key`.** Losing it means every installed desk refuses the next update until it is reinstalled. Never copy it off this machine otherwise.

To publish a client update on a site (fixes in `server\site-patches`, new build mark, recompiled exe and installer, resealed, signed):

```powershell
powershell -ExecutionPolicy Bypass -File server\publish-site-update.ps1 -BumpMark
```

Desks see the new mark on their next launch and offer the update. Each publish keeps the outgoing packs in `D:\dsh\client-history` (newest 4 per platform) and writes signed delta packs to `client-dist\delta\` (`server/pack-delta.py`); a desk on one of those versions downloads only the changed files, checks them against the signature and the product tree, and falls back to the full pack otherwise. The full download resumes where it stopped and retries up to 30 times, so a desk outside the office on a slow relayed link still finishes. Before publishing a Mac pack, run `bash scripts/prove-client-boot.sh` (needs the LFS packages): it boots the patched pack under an empty home and prints `CLIENT_BOOT_OK=1`. After changing the update scripts, `bash scripts/prove-delta.sh` checks delta, tampered delta, edited tree and missing delta (`DELTA_PROOF_OK=1`). The product tree check runs in the background on every launch and once after an update; results go to `tree-check.last.txt` in the desk's config folder.

## Accounts on first login

The login API heals the two things a remote desk needs before it can open: the person's own share account and the person's `emp-<login>` folder. Login names are matched case-insensitively and are 2 to 16 characters. Passwords are in `D:\dsh\runtime\caddy\PASSWORDS.txt`, one `login:pbkdf2_sha256$...` salted hash per line (a plain `login:password` line still works and becomes a hash at that person's next sign-in), compared in constant time. Sign-in is throttled: 5 failures for one login from one address, 20 from one address, or 30 for one login within 15 minutes refuse further tries from there (`429 too-many-attempts`) until the oldest ages out; a correct sign-in clears that person's count. Everyone can change their own password in Settings → 账号 → 修改密码 (the old one is required); **the seed admin should change the install-time password there right after install.**

### Who opens which folder

`server\secure-folders.ps1` sets NTFS rights on the company share from the roster and each person's own account, so the files agree with what the knowledge search already enforces, and nobody can write into the handbook that every agent trusts:

| Folder | Read | Change |
|---|---|---|
| share root, `_skills`, `_control`, `content`, `_handbook`, `_handbook\_company` | everyone | admins |
| `_handbook\<dept>` | that department | its director, admins |
| `_shared` (company memory) | everyone | admins, directors |
| `_office` | admins | admins |
| each person's folder (raw conversations `.dsh-desk`, task deliverables `tasks\`) and `content\emp-<login>` (personal memory) | the person, their department's director, admins | the person, admins |
| `D:\dsh\runtime` (keys, tokens, passwords), `D:\dsh\brain` (raw conversations) | SYSTEM, Administrators, each local administrator by name | same |

Reviews are not affected: a card is reviewed by an admin, the department's director or whoever issued it to themselves, and reviews read files through the server. The share hides folders a person cannot open (access-based enumeration). people-api runs it after every roster change and every sign-in that makes an account; setup runs it; the task `TDH-Secure-Folders` runs it at 00:05. The first change of each run saves the previous rights to `runtime\acl-backup-<time>.txt` (`icacls D:\dsh\company /restore <file>` undoes it). `server\prove-secure-folders.ps1` asks Windows, account by account, what each person can actually open and change, and fails on any difference from the table.

While someone's desk still mounts as `dshshare` (they have not signed in since their own account existed), `dshshare` stands in for them as themselves only: their own folder and what everyone reads, never an admin's or director's reach. Each person who signs in once is shut off from `dshshare` at once; when everyone has, `dshshare` has no rights left. Retiring it works like ending the gateway bridges: `server\smb-accounts.ps1 -Status` lists who has no own account yet and which desks were seen connected as `dshshare` (recorded on every run of `secure-folders.ps1`, in `runtime\dshshare-seen.json`), and `-Finish` gives it a password nobody has and switches it off, refusing while someone is still without an own account, a desk used it in the last 72 hours, or the record is younger than that (`-QuietHours`, `-Force`).

### Company share accounts

Each person mounts the company share with their own Windows account, `smb-<login>`, made at their first sign-in (password in `D:\dsh\runtime\smb-users\<login>.pass`, handed to the desk at login). 停用 switches that account off and closes its open connections, 恢复 turns it back on, 删除 deletes it. Folder rights follow these accounts and the roster (`server\secure-folders.ps1`, below).

Until this version every desk mounted as one shared account, `dshshare`, whose password is on every desk that ever signed in, so 停用 could not take the share away. Desks move to their own account at their next sign-in (no client update needed). Then retire the shared password:

```powershell
powershell -ExecutionPolicy Bypass -File server\smb-accounts.ps1 -Report        # who still has no own account, who is connected as what
powershell -ExecutionPolicy Bypass -File server\smb-accounts.ps1 -Reconcile     # switch off accounts of people who are not active
powershell -ExecutionPolicy Bypass -File server\smb-accounts.ps1 -RotateShared  # new dshshare password; refused while an active person has no own account
```

`dshshare` itself stays as the fallback for a login the server cannot make an account for.

Optional, not run by setup: `powershell -ExecutionPolicy Bypass -File server\koubo\install.ps1` for the talking-head editing tool (needs Python 3.10–3.12 and Jianying on the machine that opens the drafts).

Both client packages (Windows, and Mac for Apple silicon and Intel) carry OpenCLI for browser work. Each person loads its Chrome extension once; the agent guides them through it. The Windows package also carries Windows-MCP (`windows-mcp/`, its own Python 3.14) and the Mac package carries Peekaboo (`peekaboo/`) for desktop apps; nothing to install. On a Mac the person turns on Accessibility and Screen Recording once, guided by the agent.

Needs: Windows, Administrator, Python 3, Node 22+, Git LFS (`git lfs pull`).

## Upgrade, back up, uninstall

**Upgrade.** On the server, in the clone, as Administrator:

```powershell
git pull --ff-only
git lfs pull
powershell -ExecutionPolicy Bypass -File scripts\setup-all.ps1
powershell -ExecutionPolicy Bypass -File server\publish-site-update.ps1 -BumpMark
```

Setup is safe to run again: it keeps the roster, passwords, model keys, the update-signing key and the company share, and restarts the services on the new code. The last line republishes the clients with this version's site patches; desks offer the update on their next launch. Read the new [CHANGELOG](../CHANGELOG.md) sections first: a few releases ask for a one-off step (for example `server\install-ocr.ps1 -Restart` when OCR packages change). Keep the clone clean: `git pull --ff-only` refuses to run over files you edited in it, which is what you want; put local changes in a branch or a fork.

**Back up.** Everything a site cannot get back from this repository is under `D:\dsh`, plus Caddy's TLS root:

| Folder | What | If lost |
| --- | --- | --- |
| `runtime\pack-sign\` | update-signing key | every desk refuses the next update until it is reinstalled |
| `runtime\` (rest) | roster, password hashes, model keys and subscriptions, tokens, share-account passwords, TLS root, OCR config | people, keys and logins have to be set up again |
| `company\` | the company share: personal folders, raw conversations, deliverables, handbook, company memory | the company's files |
| `brain\` | the knowledge base (distilled pages, lessons) | rebuilt only partly, from what is still in the share |
| `C:\Windows\System32\config\systemprofile\AppData\Roaming\Caddy\` (outside `D:\dsh`) | the TLS root Caddy made, with its private key; desks trust this root | on a new PC desks refuse the new root until their clients are republished and updated |

`runtime` and `brain` are readable only by administrators: back them up as an administrator (or SYSTEM), for example with `robocopy D:\dsh <backup> /MIR /B /COPYALL /R:1 /W:1 /XD client-dist client-history ocr-venv` from an elevated prompt. `client-dist`, `client-history` and `ocr-venv` are rebuilt by setup and do not need a backup. Keep the backup off this PC and as private as the server itself: it holds the keys.

**Restore** onto a new PC: install as above, stop the services (`schtasks /End /TN Autostart-PeopleApi` and the other `Autostart-*` tasks), copy the backup over `D:\dsh` and Caddy's folder back to the same place, run setup again. Desks keep working if the new PC has the same name (the address is `<computername>.local`); otherwise the clients have to be reinstalled from the new download page.

**Uninstall.** `scripts\wipe-tdh-server.ps1` lists what it would remove; with `-Yes` it removes the services and nightly tasks, `D:\dsh` (company share, knowledge base, keys and all), the share, the share accounts and the TDH client folders on this PC. Back up first.

