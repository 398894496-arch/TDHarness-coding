"""NOTICE.txt at the top of each client pack (idempotent): what is inside and under which license.

The packs carried a 2026-09 text (kernel 0.1.1-rc.2, "8450 only", CompanyDesk.exe) that no
longer matched what ships; anyone opening a pack to check it read the wrong thing.
"""
MARK = "@@notice-v2"

TEXT = """TDHarness desk (TDH)  """ + MARK + """
Self-hosted AI workbench for a company LAN. Source: https://github.com/398894496-arch/TDHarness-coding (MIT)

This package was compiled for one company's server. It holds no model keys or subscriptions.
The agent runs on this computer with the signed-in person's rights. Model calls, web search and
image or video generation go only through the server this package was installed from; browser
work uses this computer's own browser.

Third-party software in this package:
- Node.js 22: MIT (node/LICENSE)
- DeepSeek Harness kernel @deepseek-ai/dsh: MIT (version in prefix/.../@deepseek-ai/dsh/package.json)
- OpenCLI @jackwener/opencli and its Chrome extension: Apache-2.0 (opencli/node_modules/@jackwener/opencli/LICENSE)
- Noto Sans CJK SC: SIL Open Font License 1.1 (fonts/)
- Windows: Windows-MCP 0.8.7, MIT (windows-mcp/Lib/site-packages/windows_mcp-0.8.7.dist-info/licenses/LICENSE.md),
  with Python under the PSF License (windows-mcp/LICENSE.txt); FFmpeg, LGPL-3.0 (ffmpeg/LICENSE.txt);
  Microsoft Edge WebView2 SDK DLLs, redistributed by Microsoft's terms for WebView2 apps
- macOS: Peekaboo 4.9.0, MIT (peekaboo/LICENSE)

BUILD.json holds a build identifier and the SHA-256 of every file in this package. The desk compares
the identifier with the server's signed version.json to offer updates, and checks its own files
against the list on every launch. It names the server it was built for and nothing about people.

中文：本安装包为某一家公司的服务器编译，不含任何模型钥匙。AI 在这台电脑上、以登录者本人的权限干活；
模型调用、联网搜索、生图生视频只经过安装来源的那台服务器，浏览器操作用这台电脑自己的浏览器。
BUILD.json 是构建标识和每个文件的 SHA-256，用于提示更新和每次启动时自检，不含任何个人信息。
"""


def patch_bytes(data: bytes) -> tuple[bytes, str]:
    if MARK.encode() in data:
        return data, "already"
    crlf = b"\r\n" in data
    text = TEXT.replace("\n", "\r\n") if crlf else TEXT
    return text.encode("utf-8"), "patched-notice"
