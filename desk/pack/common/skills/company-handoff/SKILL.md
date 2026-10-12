---
name: company-handoff
description: Split ticket, hands, and acceptance.
whenToUse: 下达, 验收, Hands vs Manager.
disable-model-invocation: true
---

# company-handoff

三角色已经拆开。对话里的「做完了」不算完成。

1. 工单文件进 `ticket-flow` / `bin/exec-job`，正文不进 argv。
2. 手只写工单允许的路径。轨迹不是权威。
3. 验收听本地 CI 回执，不听手的自称。
4. 员工桌默认仍是官方 `standard`。不要把 Manager 设成 8443 日常档。
5. 官方 `standard` 里的 `subagent` / `subagent_fork` / `workflow` / `ralph` / `goal` 能用。禁止的是 **`subagent-codex` 预设**和改正在跑的官方预设，不是禁止委派。
