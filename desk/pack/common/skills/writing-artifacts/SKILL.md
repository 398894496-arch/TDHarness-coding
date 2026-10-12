---
name: writing-artifacts
description: Self-contained HTML for the sidebar canvas.
whenToUse: artifact, HTML, 图, 画布.
disable-model-invocation: true
---

# writing-artifacts

用 **`artifact` 工具**写 HTML。教学已进 AGENTS。人打 `/writing-artifacts` 才灌这篇。不要 `read` 本文件当加载。

产物在桌子的产物库（`$DSH_HOME/artifacts`，右侧「图」），不是工作区里的 `artifacts/` 文件夹。打开就是可改的预览，改完点保存。不要再切源码框。

- 一整份 HTML，CSS/JS 写进文件里。iframe 没有外网。
- 要 `<title>`，`body` 写明背景和字色。
- 报告就写文章，不要套一层 App 壳。
- 改同一份就再 `artifact` 同一 `path`。
