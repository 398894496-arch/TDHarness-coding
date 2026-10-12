# Desk source

The source of the desk's own parts: everything in a desk pack that this project wrote. Plain files, no build step: what is here is what the desks run.

**Plugins** (`plugins/`), the part that makes the upstream DeepSeek Harness desk a company desk:

| Plugin | What it does |
| --- | --- |
| `company-shell` | sidebar, sign-in, people, tasks, account and kernel pages, company knowledge and memory tools, model sync |
| `company-web-search` | `web_search` / `web_fetch` through the gateway |
| `company-grok-media` | image and video generation through the gateway, shown in the conversation |
| `company-open-browser` | opens links in the person's own browser |
| `dsh-bridge-browser` | the browser bridge: [dsh-browser](https://github.com/omdsh-dev/dsh-browser)'s `packages/browser/bridge-browser` at `122de0e`, built (MIT, `LICENSE` in the folder), plus `ensure-extension.js` (ours: installs the side-panel extension) |
| `company-edit-pos`, `company-edit-pos-ui` | keeps the message being edited where it is |
| `company-no-add-key` | hides the add-a-key fields: keys live on the server |
| `grok-fast-mode` | the fast-mode switch for Grok |
| `hide-bottom-panel` | hides the bottom panel the company layout does not use |
| `image-send-durable` | images pasted into a message survive a reload |

**Pack files** (`pack/`), at the pack's root, `common/` in both packs, `win/` and `mac/` in one:

| Files | What they do |
| --- | --- |
| `start.ps1`, `start-app.ps1`, `CompanyDesk.vbs` / `start.command` | start the desk: share, sign-in, local runtime, window |
| `sync-desk-home.*`, `sync-skills.js` | copy the desk's home and the company skills into place before the window opens |
| `desk-lease.js` | one person, one desk at a time; moves the person's conversations with them (`node desk-lease.js selftest`) |
| `tree-check.js`, `tree-restore.*`, `pack-update-check.js` | check the desk's own files against `BUILD.json` on launch, repair, offer updates |
| `win-client-mount.ps1`, `win-junction-shim.cjs` / `mac-*.js`, `mac-mount-company.sh` | the company share and the Mac login |
| `skills/` | the company skills the agent sees (a site's own `_skills` on the share wins when it has any) |
| `home/settings.yaml`, `home/profiles/web/*` | the desk profile: persona, tools, the desktop-control server |
| `mac/presets/` | the Mac agent preset |
| `NOTICE.txt` | the parts and licenses, shown in the pack |

**How it reaches the desks.** `client/CompanyDesk-{win,mac}.zip` are templates: kernel, Node, OpenCLI, Windows-MCP / Peekaboo, the third-party plugins below, and an older copy of everything here. Setup and `server/publish-site-update.ps1` put this folder into the pack (`server/site-cs.py overlay-zip`): each plugin replaces the template's copy in both places a pack keeps it, each pack file replaces or adds its file, the skills folder is replaced whole. Then they write the site's address in, apply `server/site-patches` and seal `BUILD.json`. A change here reaches every desk at the site's next publish; the 400 MB templates do not need rebuilding for it. `scripts/prove-client-boot.sh` builds a Mac pack that way and boots it.

**Site specifics stay out.** Nothing in here names a company, a person, an address or a path of one site. A company's own nouns go in its handbook and synonym list, its skills in its share's `_skills`, its brand in a site patch filling `SITE_BRAND_*` in `company-shell/lib/client.js` (without one the desk shows the product name). `scripts/prove-desk-source.py` (CI) checks that, that every file parses, that every site patch still finds its anchors here, and that the overlay works for both packs.

**Not here.** The desk programs: Windows `TDHarness.exe` is compiled on the server from `server/AppHost.cs`; the Mac launcher `TDHarness` is a compiled Swift program whose source is still only in the maintainer's private repository. Third-party plugins and the extension in the templates: [dsh-artifact](https://github.com/Jannchie/dsh-artifact) 0.7.0, [DSH-better-sidebar](https://github.com/omdsh-dev/DSH-better-sidebar) 0.24.1 and the dsh-browser Chrome side-panel extension (all MIT).

**History.** First published here on 2026-10-11, taken from the templates as they shipped; the history before that is in the maintainer's private repository. Files kept per platform where the templates differ: most by nature (start scripts, `overlay.yml`, `company-desktop`, `tree-check.js`'s file list). One by drift: the Mac `desk-lease.js` has a later fix (`company-lease-catalog-follows-pin-v1`: the workspace catalogue only moves to the local copy when the conversations are actually pinned there) that the Windows copy does not; it ships as the templates had it until it is tested on a Windows desk.
