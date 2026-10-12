---
name: company-tools
description: Hands on this complete agent desk. Use when picking a tool.
whenToUse: 用哪个工具, plugin add, skill.
disable-model-invocation: true
---

# company-tools

这台桌是完整 Agent（官方 `standard`）。对标 Codex / Claude / Cursor。不要把个人 `~/.agents` 当目录。
有 `pwsh` 就用 `pwsh`，有 `bash` 就用 `bash`。不要按 Mac 或 Win 猜壳。路径用登录下发的工作区（Win 是 UNC `\\{{TDH_HOST}}\dsh-company\...`，Mac 是 `$HOME/company/...`）。禁止猜 `D:\dsh` 当 cwd。

## 模型工具面（会话里能调的，有就用）

- 读改文件：`read` / `write` / `edit` / `glob` / `grep`。沙箱是当前工作区。已有文件改不动时不要教「先删再写」；那是产品要修的 UNC 覆盖，不是用法。
- 命令：有 `pwsh` 用 `pwsh`，有 `bash` 用 `bash`。能力全开：格子或本机可 `npm install`、代装 OpenCLI。不要改 overlay / 沙盒 / `dsh plugin` / `.dsh` 规则 / `cordis_*`。共享区只读。
- 查网：`web_search` / `web_fetch`，走公司 8450。`web_fetch` 已开。`company-docs` 拿整页走它。站点分路见 `company-web`。不要 Playwright。
- 开网页 / 点选：OpenCLI。`ego_*` / `browser_*` 已换掉。没有 `opencli` 就代装（见 `company-web`），不要找旧点选手。
- 公司知识：`company_knowledge`。`route=status` 看 `account` / `role` / `dept`。不要 curl 8443，不要自己报账号。
- 看图：`read_image`。生图 / 生视频：`generate_image` / `generate_video`，走 8450。文件写到 `artifacts/`。盘快满时这两项会先失败，先腾本地盘。
- 产物页：`artifact`。说明见 `writing-artifacts`。
- 并行 / 长任务：官方 `subagent` / `subagent_fork` / `workflow` / `ralph` / `goal`。问人用 `ask_user_question`。禁止的是 `subagent-codex` 预设，不是委派本身。
- 工单：没有 `mailbox` 工具。等人从侧栏「任务」下达，或自己点「+」给自己开卡。对话「做完了」不算。
- 方法：手册打开即用。do not call skill。不要 `read` 格子 `_skills`。
- 右侧栏终端：`sidebar_open` / `terminal_*`。公司标准打开。拖文件、自建 skill、额外插件员工自己装，不要当成公司缺手。

短记忆走盘上 `$personal/_memory` + `company_knowledge`。没有官方 `memory` / `memory_recall`（没装 memento），用公司盘那套即可。

## 只有 UI、没有同名 tool 的

| 插件 | 实际是什么 |
|---|---|
| better-sidebar 面板本身 | 给人看的右侧工作台。模型侧的名字是上面那组 `sidebar_open` / `terminal_*`，没有 `better_sidebar` |
| 公司「任务」tab | mailbox / 工单格子 |
| permission-rules | 路径/工具拒绝。不是登录门，也不是 tool |

## 公司边界（不是能力收口）

`deepseek-harness-auth`、`dsh-web-ui-all`、任何 `*codex-oauth*` / ChatGPT 订阅、Cloudreve、口播/抖音/HyperFrames 插件。模型只打 `http://{{TDH_HOST}}:8450/v1`。
