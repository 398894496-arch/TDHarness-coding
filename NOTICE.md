# Notice

This tree is a **coding fork layer** on top of [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (`@deepseek-ai/dsh`), which is MIT-licensed:

> Copyright (c) 2026 DeepSeek

Patches here are applied to a prefix you install yourself. They are not a replacement for the official package, and they are not an official DeepSeek product.

Upstream does not accept external pull requests. Kernel-shaped bugs can be reported in [upstream Discussions](https://github.com/deepseek-ai/deepseek-harness/discussions). Product work and PRs belong in this repository.

The repository name `TDHarness-coding` is a working title. It can change later. Do not bake `coding` into npm package names or app bundle ids.

## What ships as binaries, and where it comes from

| File | What | Version / SHA-256 | License |
| --- | --- | --- | --- |
| `server/caddy.exe` (Git LFS) | Caddy web server: download page, login, TLS | `caddy version` reports v2.11.4; SHA-256 `3bd070148b059884a40360c6ef648ade172b7f0cc9636a9af951653aac3a85ee` | Apache-2.0, https://github.com/caddyserver/caddy (you may replace it with your own download of the same version) |
| `client/CompanyDesk-win.zip` (Git LFS) | the Windows desk template setup turns into this site's installer | SHA-256 `d2ed90a351b7311eb7b0ccce8202ba3a1bcdcf32d5347c6b7d9b5f448ad2511d` | see the list below |
| `client/CompanyDesk-mac.zip` (Git LFS) | the macOS desk template | SHA-256 `0458081bc5551aa6b95bff4a99f7236f4fd1ad3b03d188ddae00e20e1be943d0` | see the list below |

The two desk templates are built by the maintainer from the pinned kernel, the desk plugins (`plugins/company-*`, readable JavaScript inside the templates; their history is kept in the maintainer's private repository, not here yet) and the parts below; CI does not rebuild them from source yet. Setup applies `server/site-patches` to them on the server, so what a site's desks run is the template plus the patches in this repository. Inside each, `NOTICE.txt` lists the parts and licenses and `BUILD.json` lists a build identifier and the SHA-256 of every file (the desk uses it to offer updates and to check its own files on launch; it names the server, nothing about people).

Parts of the desk templates: Node.js 22 (MIT); DeepSeek Harness `@deepseek-ai/dsh` (MIT); OpenCLI `@jackwener/opencli` 1.8.8 and its Chrome extension (Apache-2.0, https://github.com/jackwener/opencli); Noto Sans CJK SC (SIL OFL 1.1). Windows: [Windows-MCP](https://github.com/CursorTouch/Windows-MCP) 0.8.7 (MIT) with an embedded Python (PSF License), FFmpeg (below), Microsoft Edge WebView2 SDK DLLs (redistributed under Microsoft's terms for WebView2 apps). macOS: [Peekaboo](https://github.com/openclaw/Peekaboo) 4.9.0 (MIT).

## FFmpeg

The Windows client zip ships `ffmpeg.exe`, `ffprobe.exe` and their libraries under `CompanyDesk/ffmpeg/`, unmodified, from the BtbN build `ffmpeg-n8.1-latest-win64-lgpl-shared-8.1.zip` (https://github.com/BtbN/FFmpeg-Builds). That build is distributed under the GNU Lesser General Public License version 3; the full text is in `CompanyDesk/ffmpeg/LICENSE.txt` inside the zip, and the source is at https://ffmpeg.org/download.html (release 8.1). The desk runs these programs as separate executables and does not link against them.

## pdf.js

The knowledge search reads PDF text with Mozilla pdf.js (`pdfjs-dist` 4.10.38, legacy build, Apache License 2.0, Copyright Mozilla Foundation, https://github.com/mozilla/pdf.js). `server/vendor/pdfjs/` holds `pdf.mjs`, `pdf.worker.mjs` and the packed CMaps, unmodified, with the license text.

## OCR

`server/install-ocr.ps1` installs, with pip into its own venv on the server (not shipped in this repository), RapidOCR `rapidocr-onnxruntime` 1.4.4 (Apache License 2.0, PaddleOCR models, https://github.com/RapidAI/RapidOCR), ONNX Runtime (MIT), pypdfium2 (Apache-2.0 / BSD-3-Clause, PDFium), olefile (BSD-2-Clause) and xlrd (BSD-3-Clause) for old Office files, and their dependencies, at the versions pinned in `server/ocr-requirements.txt`.

## Word list for the knowledge search

`server/kb-lexicon.txt` lists general Chinese two-character words by frequency, derived from jieba 0.42.1's `dict.txt` (MIT, https://github.com/fxsjy/jieba), as published in DSH-KRouter (MIT). The knowledge search uses it to tell a question's specific words from generic ones.

## Vendor marks

The Grok, OpenAI and Claude marks on the desk's model settings page are taken
from `@lobehub/icons-static-svg` 1.95.1 (MIT License, Copyright (c) LobeHub,
https://github.com/lobehub/lobe-icons). The marks themselves are trademarks of
their owners and are shown only to name the vendor of each subscription.
