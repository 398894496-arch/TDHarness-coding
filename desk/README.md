# Desk plugins

The source of the desk's own plugins, the part of TDHarness that makes the upstream DeepSeek Harness desk a company desk: sign-in and the people / tasks / kernel pages (`company-shell`), web search and image / video through the company gateway, the browser bridge, desktop control, and a few small UI fixes. Plain ES modules, no build step: what is here is what the desks run.

| Plugin | What it does |
| --- | --- |
| `company-shell` | sidebar, sign-in, people, tasks, account and kernel pages, company knowledge and memory tools, model sync |
| `company-web-search` | `web_search` / `web_fetch` through the gateway |
| `company-grok-media` | image and video generation through the gateway, shown in the conversation |
| `company-open-browser` | opens links in the person's own browser |
| `dsh-bridge-browser` | the OpenCLI browser bridge and its extension check |
| `company-edit-pos`, `company-edit-pos-ui` | keeps the message being edited where it is |
| `company-no-add-key` | hides the add-a-key fields: keys live on the server |
| `grok-fast-mode` | the fast-mode switch for Grok |
| `hide-bottom-panel` | hides the bottom panel the company layout does not use |
| `image-send-durable` | images pasted into a message survive a reload |

**How it reaches the desks.** `client/CompanyDesk-{win,mac}.zip` are templates (kernel, Node, OpenCLI, Windows-MCP / Peekaboo, and an older copy of these plugins). Setup and `server/publish-site-update.ps1` replace the template's copy with this folder (`server/site-cs.py overlay-zip`, both places a pack keeps a plugin), write the site's address in, then apply `server/site-patches`. So a change here reaches every desk at the site's next publish; the 400 MB templates do not need rebuilding for it.

**Site specifics stay out.** Nothing in here names a company, a person, an address or a path of one site. A company's own nouns go in its handbook and synonym list; its brand goes in a site patch filling `SITE_BRAND_*` in `company-shell/lib/client.js` (without one the desk shows the product name). `scripts/prove-desk-source.py` (CI) checks that, that every file parses, that every site patch still finds its anchors here, and that the overlay works.

**History.** These files were first published here on 2026-10-11, taken from the templates as they shipped; the history before that is in the maintainer's private repository. Third-party plugins in the templates are not copied here: [dsh-artifact](https://github.com/Jannchie/dsh-artifact) and [DSH-better-sidebar](https://github.com/omdsh-dev/DSH-better-sidebar), both MIT.
