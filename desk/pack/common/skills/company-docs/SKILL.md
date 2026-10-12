---
name: company-docs
description: Read current official docs before guessing APIs or vendor behavior. Use when the user says latest, official, or a versioned tool changed.
whenToUse: official docs, API drift, 最新, 官方文档.
disable-model-invocation: true
---

# company-docs

先查正在生效的页，再改配置或写代码。员工不要碰创造模式、不要 `dsh plugin`、不要 `--dump-config`。

1. 公开文档：`web_search` / `web_fetch` → 8450。不要为此开浏览器或 Playwright。
2. 公司怎么规定：`company_knowledge` `route=search`。合同和装修说明以知识口 / 种植的 handbook 为准，不要去翻本机仓库路径（格子里没有 `三底座合同.md`）。
3. 不要为了「最新插件」去装 `dsh-web-ui-all`、auth、或 ChatGPT OAuth。
