---
name: company-web
description: How this complete agent splits public pages and OpenCLI click.
whenToUse: 公开网, 打开网址, 浏览器.
disable-model-invocation: true
---

# company-web

完整 Agent 的网和点选怎么分工。点选已换成 OpenCLI。不要调 `ego_*` / `browser_*`。不要加 Playwright。

## 1. 公司知识

手册、纠错、部门规定、公司是谁 → 先 `company-knowledge` 一次 `route=search`。`not-found` 再 `web_search` 同一批名字。不要一上来打开天眼查 / 企查查，不要对 brain 全库 `rg`。公开 GitHub / npm / Remotion 不要走公司知识。

## 2. 公开网页（`web_search` / `web_fetch`）

模型工具名只有 `web_search` / `web_fetch`。不要另发明工具名，不要在员工机跑 agent-reach / Exa / mcporter。

- 查公开事实、文档、当前版本：`web_search` 一次，`queries` 只放一条。默认 Exa（和 agent-reach 同一扇）。摘要够用就回答，不要再搜、不要开浏览器。
- 只要缺一个数字才 `web_fetch` 那一条 URL。不要 `web_fetch` 搜页。不要开 `ego_*`。仓库详情 `web_fetch https://api.github.com/repos/<owner>/<name>`。
- 出网只打公司 `8450/search` 和 `8450/fetch`。Cookie 不上 8450。引擎在办公 Win 上跑。

默认楼梯 **Exa → 空就 Bing**。问 GitHub 时 **GitHub API → Bing**。B站 / YouTube 问到再走专用 API。Grok 只要请求体点名才打。官方 DeepSeek 搜默认关。

## 3. 站点用规（哪只手）

| 要做的事 | 用手 | 不要 |
|---|---|---|
| 公开文档、官网、无 cookie 的页 | `web_search` / `web_fetch` → 8450 | 不要为此开浏览器 |
| 公司 `8443` 登录 / 下载 / 知识门 | 客户端登录窗、`/client/`、`company_knowledge` | 不要点选 8443 |
| 点已开的日常网页、走登录态流程 | OpenCLI（`opencli browser`） | 不要调 `ego_*` / `browser_*` |
| 工具表没有 OpenCLI / `opencli` 不在 PATH | HOST 工具 `opencli` `action=ensure` | 不要找旧点选手，不要装 Playwright |

## 4. 代装 OpenCLI

员工机还没有这只手时，调 HOST 工具 `opencli`，不要只丢 npm 命令给人。不要改 overlay。不要把 OpenCLI 打进 zip。

1. `opencli` `action=ensure`：格子里没有就 `npm install @jackwener/opencli`，有则直接用（`OPENCLI_BIN` 可覆盖）
2. `opencli` `action=doctor`（格子里等同 `opencli doctor`）
3. Chrome 扩展不能静默装：打开 `https://chromewebstore.google.com/detail/opencli/ildkmabpimmkaediidaifkhjpohdnifk`，请人点一次「添加」
4. 关桌，开新会话。之后用 `opencli browser`（bash / 侧栏终端）

公开搜仍然只走 8450，不要用 OpenCLI 当搜索引擎。被挡的 `ego_*` / `browser_*` 会回 `click-retired`，下一步是 `opencli` `action=ensure`。

## 公司边界

- 员工桌装 `*codex-oauth*` / ChatGPT 搜、Playwright MCP 全家桶、`dsh-web-ui-all`
- 用 bash 调 `mcporter` / `agent-reach` 当公司搜索
- 把官方 `web-search-deepseek` 重新打开，或让客户端直打上游搜索域名
- 把员工 Cookie 送到办公 Win 或 8450
- 再调 `ego_*` / `browser_*`（已换掉）
