# Notice

This tree is a **coding fork layer** on top of [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (`@deepseek-ai/dsh`), which is MIT-licensed:

> Copyright (c) 2026 DeepSeek

Patches here are applied to a prefix you install yourself. They are not a replacement for the official package, and they are not an official DeepSeek product.

Upstream does not accept external pull requests. Kernel-shaped bugs can be reported in [upstream Discussions](https://github.com/deepseek-ai/deepseek-harness/discussions). Product work and PRs belong in this repository.

The repository name `TDHarness-coding` is a working title. It can change later. Do not bake `coding` into npm package names or app bundle ids.

## FFmpeg

The Windows client zip ships `ffmpeg.exe`, `ffprobe.exe` and their libraries under `CompanyDesk/ffmpeg/`, unmodified, from the BtbN build `ffmpeg-n8.1-latest-win64-lgpl-shared-8.1.zip` (https://github.com/BtbN/FFmpeg-Builds). That build is distributed under the GNU Lesser General Public License version 3; the full text is in `CompanyDesk/ffmpeg/LICENSE.txt` inside the zip, and the source is at https://ffmpeg.org/download.html (release 8.1). The desk runs these programs as separate executables and does not link against them.

## Vendor marks

The Grok, OpenAI and Claude marks on the desk's model settings page are taken
from `@lobehub/icons-static-svg` 1.95.1 (MIT License, Copyright (c) LobeHub,
https://github.com/lobehub/lobe-icons). The marks themselves are trademarks of
their owners and are shown only to name the vendor of each subscription.
